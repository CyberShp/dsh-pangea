import { repositoryOperation } from './repositories/operations.js'
import { inspectSource, readRepositorySettings, compareSnapshot } from './repositories/git-source.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, lstat, writeFile, open, unlink } from 'node:fs/promises'
import path from 'node:path'
import { writeTaskStoreFile } from './task-store.js'
import { caseIdentity } from './case-review-projection.js'
import { caseContentHash } from './case-review-store.js'
import { withGitLongPaths, disabledHooksPath, shellQuote } from './repositories/git-environment.js'
import { protectedBranchReason } from './repositories/branch-policy.js'
import {
  DEFAULT_INTRANET_COMMIT_REGEX, DEFAULT_REGEX_TIMEOUT_MS, extractRemoteHookRegex,
  normalizeCommitConfig, resolveCommitMessage, setBacktrackingMatcherRunner, validateRawCommitMessage,
} from './fault-injection-candidates.js'
import { runInNewContext } from 'node:vm'

setBacktrackingMatcherRunner((v8Regex, text, timeoutMs = DEFAULT_REGEX_TIMEOUT_MS) => {
  const budget = Math.max(1, Math.ceil(timeoutMs))
  try {
    return Boolean(runInNewContext('re.test(text)', { re: v8Regex, text }, { timeout: budget }))
  } catch (error) {
    if (error?.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' || /timed out/i.test(String(error?.message || ''))) {
      throw new Error(`本地预检正则执行超过 ${budget}ms 超时护栏，已中止`)
    }
    throw error
  }
})

const REMOTE_PUSH_REJECTED_PATTERN = /(?:!\s*\[(?:(?:remote\s+)?rejected|远程拒绝|被拒绝)\]|(?:pre-receive|update)\s+hook\s+declined)/i
const isRemotePushRejected = error => REMOTE_PUSH_REJECTED_PATTERN.test(String(error?.stderr || error?.message || error || ''))

const execute = promisify(execFile)
const activeStates = new Set(['preparing', 'generating', 'pushing'])
const hash = value => createHash('sha256').update(value).digest('hex')
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
const serviceError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const inside = (root, file) => { const r = path.relative(root, file); return r && r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r) }
const cleanError = error => {
  const message = String(error?.stderr || error?.message || error).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@')
  return message.length <= 6000 ? message : `${message.slice(0, 2900)}\n…错误输出过长，中间已省略…\n${message.slice(-2900)}`
}

export async function injectionGit(cwd, args, signal) {
  // Resolve outside the Git error mapping: a temp-file failure is not "Git missing".
  const hooksPath = await disabledHooksPath()
  try {
    // Keep the process cwd short on Windows; Git handles the long repository path via -C.
    const result = await withGitLongPaths(env => execute('git', ['-c', `core.hooksPath=${hooksPath}`, '-c', 'core.longpaths=true', '-C', path.resolve(cwd), ...args], {
      signal, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
      env: { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_LFS_SKIP_SMUDGE: '1' },
    }), { signal, cwd })
    return result.stdout.trimEnd()
  } catch (error) {
    if (error.code === 'ENOENT') throw serviceError('生成和推送打桩代码需要 Git，请安装 Git 或将其加入 PATH；普通分析不受影响')
    if (signal?.aborted) throw signal.reason ?? error
    throw serviceError(cleanError(error), 422)
  }
}

// Host-side record of a generation checkout. Only differences from this baseline
// are attributed to the generator; anything already present right after checkout
// (local Git/LFS configuration, line-ending normalization) is not.
export async function workspaceSnapshot(git, checkout, signal) {
  const output = await git(checkout, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], signal)
  const fields = output.split('\0'), entries = []
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]
    if (!field) continue
    const status = field.slice(0, 2), file = field.slice(3)
    // Porcelain -z emits the original path of a rename/copy as a separate field.
    if (/[RC]/.test(status)) index++
    let sha256
    try {
      const target = path.join(checkout, file), stat = await lstat(target)
      sha256 = stat.isFile() ? hash(await readFile(target)) : stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'other'
    } catch (error) { if (error.code !== 'ENOENT') throw error; sha256 = 'missing' }
    entries.push({ status, path: file, sha256 })
  }
  return entries
}

// Absent from the baseline: untracked paths are new files, tracked paths were
// modified or deleted relative to the checked-out commit.
const entryChange = status => status.includes('?') || status.includes('A') ? 'added' : status.includes('D') ? 'deleted' : 'changed'
export function workspaceChanges(baseline = [], current = []) {
  const before = new Map(baseline.map(entry => [entry.path, entry])), after = new Map(current.map(entry => [entry.path, entry]))
  const changes = []
  for (const [file, entry] of after) {
    const previous = before.get(file)
    if (!previous || previous.status !== entry.status || previous.sha256 !== entry.sha256) changes.push({ path: file, status: entry.status, change: previous ? 'changed' : entryChange(entry.status) })
  }
  for (const [file, entry] of before) if (!after.has(file)) changes.push({ path: file, status: entry.status, change: 'reverted' })
  return changes
}
const describeChanges = changes => changes.slice(0, 8).map(item => `${item.change === 'added' ? '新增' : item.change === 'reverted' ? '还原' : item.change === 'deleted' ? '删除' : '修改'} ${JSON.stringify(item.path)}`).join('；') + (changes.length > 8 ? `；另有 ${changes.length - 8} 项` : '')

// The agent supplies the behavior and exact replacement. The host only checks
// file boundaries and matching bytes; it never decides whether a fault is useful.
export async function applyInjectionEdits(repositoryRoot, edits) {
  const root = await realpath(repositoryRoot)
  const staged = new Map()
  for (const edit of edits) {
    const name = edit?.path
    if (typeof name !== 'string' || !name || /[\\\x00-\x1f:]/.test(name) || path.posix.isAbsolute(name)
      || name.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) throw serviceError('修改文件路径必须在所选仓库内')
    const file = path.resolve(root, name)
    if (!inside(root, file)) throw serviceError('修改文件路径越出所选仓库')
    let parent = path.dirname(file)
    while (parent !== root) {
      try { if (!(await lstat(parent)).isDirectory() || !inside(root, await realpath(parent))) throw serviceError(`目录越界或不是普通目录：${name}`); break }
      catch (error) { if (error.code !== 'ENOENT') throw error; parent = path.dirname(parent) }
    }
    if (!staged.has(name)) {
      try {
        if (!(await lstat(file)).isFile() || !inside(root, await realpath(file))) throw serviceError(`仅支持仓库内普通文件：${name}`)
        const bytes = await readFile(file)
        if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) throw serviceError(`文件不是 UTF-8 文本：${name}`)
        staged.set(name, bytes.toString('utf8'))
      } catch (error) { if (error.code !== 'ENOENT') throw error; staged.set(name, null) }
    }
    const current = staged.get(name)
    if (edit.before === null) {
      if (current !== null || typeof edit.after !== 'string') throw serviceError(`新文件已存在或内容无效：${name}`)
      staged.set(name, edit.after)
    } else {
      if (typeof current !== 'string' || typeof edit.before !== 'string' || !edit.before || typeof edit.after !== 'string') throw serviceError(`替换缺少原文或新内容：${name}`)
      // Normalize only matching line endings, preserving the file's own style.
      const eol = current.includes('\r\n') ? '\r\n' : '\n'
      const before = edit.before.replace(/\r?\n/g, eol), after = edit.after.replace(/\r?\n/g, eol)
      const at = current.indexOf(before)
      if (at < 0 || current.indexOf(before, at + 1) >= 0) throw serviceError(`原文未唯一匹配：${name}；请重新生成此修改`)
      staged.set(name, current.slice(0, at) + after + current.slice(at + before.length))
    }
  }
  // Validate every replacement before touching any file in this repository.
  for (const [name, content] of staged) { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content, 'utf8') }
  return [...staged.keys()]
}

// Replace every repeated value >= 80 chars with a pointer to its first occurrence.
// Lossless: the first copy is kept verbatim and each repeat names where it is.
const REPEAT_MIN_LENGTH = 80
export function dedupeRepeatedValues(root) {
  const seen = new Map()
  const visit = (node, at) => {
    const key = typeof node === 'string' ? `s:${node}` : node && typeof node === 'object' ? `j:${JSON.stringify(node)}` : null
    if (key && key.length - 2 >= REPEAT_MIN_LENGTH) {
      if (seen.has(key)) return { $same_as: seen.get(key) }
      seen.set(key, at)
    }
    if (Array.isArray(node)) return node.map((item, index) => visit(item, `${at}[${index}]`))
    if (node && typeof node === 'object') return Object.fromEntries(Object.entries(node).map(([name, value]) => [name, visit(value, `${at}.${name}`)]))
    return node
  }
  return visit(root, '$')
}

const posixPath = value => typeof value === 'string' ? value.replaceAll('\\', '/') : value

function stringIds(values) {
  const result = []
  for (const item of Array.isArray(values) ? values : []) {
    if (typeof item === 'string' && item.trim()) result.push(item.trim())
    else if (item && typeof item === 'object') {
      const candidate = item.coverage_id ?? item.gap_id ?? item.risk_id ?? item.flow_id ?? item.id
      if (typeof candidate === 'string' && candidate.trim()) result.push(candidate.trim())
    }
  }
  return result
}

export function extractAnalysisContext(run, selectedCases = []) {
  const details = run?.details ?? {}
  const riskIds = new Set(), coverageIds = new Set(), flowIds = new Set(), caseIds = new Set()
  for (const item of selectedCases) {
    const body = item?.source_record?.body ?? {}
    for (const id of [item?.case_key, item?.case_id, item?.test_case_id, body?.case_id]) if (typeof id === 'string' && id) caseIds.add(id)
    for (const id of [...stringIds(item?.linked_risk_ids), ...stringIds(item?.risk_refs), ...stringIds(body?.risk_refs), ...stringIds(body?.linked_risk_ids)]) riskIds.add(id)
    for (const id of [...stringIds(item?.coverage_refs), ...stringIds(item?.linked_gap_ids), ...stringIds(body?.coverage_refs), ...stringIds(body?.linked_gap_ids)]) coverageIds.add(id)
    for (const id of [...stringIds(item?.flow_refs), ...stringIds(body?.flow_refs)]) flowIds.add(id)
  }
  const risks = (Array.isArray(details.risks) ? details.risks : [])
    .filter(r => r?.risk_id && riskIds.has(r.risk_id))
    .slice(0, 16)
    .map(r => ({
      risk_id: r.risk_id,
      title: r.title ?? '',
      trigger: r.trigger ?? r.reproduction ?? '',
      system_result: r.system_result ?? r.system_outcome ?? '',
      external_observation: r.external_observation ?? r.observation ?? '',
      ...(Array.isArray(r.source_evidence) && r.source_evidence.length ? { source_evidence: r.source_evidence } : {}),
      evidence: (Array.isArray(r.evidence) ? r.evidence : []).slice(0, 10).map(e => ({
        location: e?.location ?? '',
        observation: e?.observation ?? e?.narrative ?? '',
      })).filter(e => e.location || e.observation),
    }))
  const rawGaps = Array.isArray(details.coverage_gaps) ? details.coverage_gaps : (Array.isArray(run?.coverage?.gaps) ? run.coverage.gaps : [])
  const coverage_gaps = rawGaps
    .filter(g => (g?.coverage_id && coverageIds.has(g.coverage_id)) || (g?.gap_id && coverageIds.has(g.gap_id)))
    .slice(0, 20)
    .map(g => ({
      coverage_id: g.coverage_id ?? g.gap_id,
      repo_id: g.repo_id ?? null,
      path: g.path ?? g.file ?? '',
      symbol: g.symbol ?? g.function_name ?? '',
      line: g.line ?? g.lines ?? g.line_range ?? null,
      summary: g.summary ?? g.description ?? g.reason ?? '',
      ...(Array.isArray(g.source_evidence) && g.source_evidence.length ? { source_evidence: g.source_evidence } : {}),
    }))
  const flows = (Array.isArray(details.business_flows) ? details.business_flows : [])
    .filter(f => (f?.flow_id && flowIds.has(f.flow_id))
      || (Array.isArray(f?.paths) && f.paths.some(p => Array.isArray(p?.case_ids) && p.case_ids.some(cid => caseIds.has(cid)))))
    .slice(0, 8)
    .map(f => ({
      flow_id: f.flow_id ?? '',
      title: f.title ?? '',
      paths: (Array.isArray(f.paths) ? f.paths : []).slice(0, 8).map(p => ({
        path_id: p?.path_id ?? '',
        title: p?.title ?? '',
        node_ids: Array.isArray(p?.node_ids) ? p.node_ids : [],
      })),
    }))
  if (!risks.length && !coverage_gaps.length && !flows.length) return null
  return {
    ...(risks.length ? { risks } : {}),
    ...(coverage_gaps.length ? { coverage_gaps } : {}),
    ...(flows.length ? { flows } : {}),
  }
}

const SOURCE_EXT = /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$/i
const TEST_DIR_NAME = /^(?:tests?|ut|llt|unittests?|unit_tests?)$/i
const TEST_FILE_NAME = /(?:^|_|-)(?:test|tests|ut|llt)\.(?:c|cc|cpp|cxx)$|test.*\.(?:cc|cpp|cxx)$/i
const MACRO_LINE = /^\s*#\s*(?:if|ifdef|ifndef|elif|define)\b.*\b\w*(?:SIMU|FAULT|INJECT|MOCK|STUB|ASAN|SANITIZE|TIMEOUT)\w*/i
const FAULT_DEF_TOKEN = /(?:(?:^|[\s"'(])-D|(?<![-\w]))([A-Za-z_][A-Za-z0-9_]*(?:SIMU|FAULT|INJECT|MOCK|STUB)[A-Za-z0-9_]*)\b/g

function parseRepoLocationSpec(raw, repoId) {
  if (typeof raw !== 'string') return null
  let text = raw.trim()
  if (!text) return null
  const firstColon = text.indexOf(':')
  if (firstColon > 0 && !text.slice(0, firstColon).includes('/') && !text.slice(0, firstColon).includes('\\')) {
    const prefix = text.slice(0, firstColon)
    if (prefix !== repoId && !/\.[A-Za-z0-9]+$/.test(prefix)) return null
    if (prefix === repoId) text = text.slice(firstColon + 1)
  }
  const rangeMatch = text.match(/:(\d+)(?:-(\d+))?(?::.*)?$/)
  const start = rangeMatch ? Number(rangeMatch[1]) : null
  const end = rangeMatch ? Number(rangeMatch[2] || rangeMatch[1]) : null
  text = text.replace(/:\d+(?:-\d+)?(?::.*)?$/, '').replaceAll('\\', '/').replace(/^\.\/+/, '')
  if (!text || text.startsWith('/') || text.split('/').some(part => !part || part === '.' || part === '..')) return null
  return { path: text, start: start && start > 0 ? start : null, end: end && end >= (start || 1) ? end : start }
}

function parseRepoLocation(raw, repoId) {
  return parseRepoLocationSpec(raw, repoId)?.path ?? null
}

const C_CONTROL_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'sizeof', 'typeof', 'alignof', 'defined', 'catch', 'TEST', 'TEST_F', 'TEST_P'])

function extractCleanSymbol(raw) {
  if (typeof raw !== 'string') return null
  const stripped = raw.trim().replace(/\s*\([^)]*\).*$/, '')
  const match = stripped.match(/([A-Za-z_][A-Za-z0-9_]{2,})$/)
  return match && !C_CONTROL_KEYWORDS.has(match[1]) ? match[1] : null
}

export function collectTargetEvidenceSpecs(repoId, cases = [], analysisContext = null) {
  const paths = new Set(), rangesByPath = new Map(), symbols = new Set()
  const addRange = (relPath, start, end) => {
    if (!relPath) return
    paths.add(relPath)
    if (!Number.isInteger(start) || start <= 0) return
    const finish = Number.isInteger(end) && end >= start ? end : start
    if (!rangesByPath.has(relPath)) rangesByPath.set(relPath, [])
    rangesByPath.get(relPath).push([start, finish])
  }
  const add = value => {
    const spec = parseRepoLocationSpec(value, repoId)
    if (spec) addRange(spec.path, spec.start, spec.end)
  }
  const addSym = value => {
    const sym = extractCleanSymbol(value)
    if (sym) symbols.add(sym)
  }
  for (const item of cases) {
    const body = item?.source_record?.body ?? {}
    for (const ref of [...(Array.isArray(item?.source_evidence) ? item.source_evidence : []), ...(Array.isArray(body?.source_evidence) ? body.source_evidence : [])]) add(ref)
    for (const ev of Array.isArray(item?.evidence) ? item.evidence : []) add(ev?.location)
    const points = item?.instrumentation?.points ?? body?.instrumentation?.points ?? []
    for (const pt of Array.isArray(points) ? points : []) {
      if (!pt?.repo_id || pt.repo_id === repoId) { add(pt?.path); addSym(pt?.symbol) }
    }
  }
  for (const risk of analysisContext?.risks ?? []) {
    for (const ref of Array.isArray(risk?.source_evidence) ? risk.source_evidence : []) add(ref)
    for (const ev of risk.evidence ?? []) add(ev?.location)
  }
  for (const gap of analysisContext?.coverage_gaps ?? []) {
    for (const ref of Array.isArray(gap?.source_evidence) ? gap.source_evidence : []) add(ref)
    if (!gap.repo_id || gap.repo_id === repoId) {
      const rel = parseRepoLocation(gap.path, repoId)
      const lineText = gap.line != null ? String(gap.line).trim() : ''
      const m = lineText.match(/^(\d+)(?:-(\d+))?$/)
      addRange(rel, m ? Number(m[1]) : null, m ? Number(m[2] || m[1]) : null)
      addSym(gap.symbol)
    }
  }
  return { paths: [...paths], rangesByPath, symbols: [...symbols] }
}

export function collectTargetSourcePaths(repoId, cases = [], analysisContext = null) {
  return collectTargetEvidenceSpecs(repoId, cases, analysisContext).paths
}

function mergeLineWindows(rawRanges, totalLines, padBefore = 8, padAfter = 18) {
  if (!Array.isArray(rawRanges) || !rawRanges.length) {
    return totalLines <= 120 ? [[1, Math.min(totalLines, 80)]] : []
  }
  const expanded = rawRanges
    .map(([s, e]) => [Math.max(1, s - padBefore), Math.min(totalLines, Math.max(s, e) + padAfter)])
    .filter(([s, e]) => s <= e)
    .sort((a, b) => a[0] - b[0])
  const merged = []
  for (const [s, e] of expanded) {
    const prev = merged.at(-1)
    if (prev && s <= prev[1] + 4) prev[1] = Math.max(prev[1], e)
    else merged.push([s, e])
  }
  return merged.slice(0, 3)
}

async function readBoundedText(root, relPath, maxBytes = 262144) {
  const full = path.resolve(root, relPath)
  if (full !== root && !inside(root, full)) return null
  try {
    const st = await lstat(full)
    if (!st.isFile() || st.size > maxBytes) return null
    return await readFile(full, 'utf8')
  } catch { return null }
}

export async function inspectRepositoryHarness(repositoryRoot, repoId, targetPaths = [], rangesByPath = new Map(), hintSymbols = []) {
  const root = await realpath(repositoryRoot)
  const moduleFiles = [], conditionalMacros = [], cmakeRules = [], testDirectories = [], targetSnippets = [], existingSymbolTests = []
  let sampleTestSnippet = null
  const targetSymbols = new Set((Array.isArray(hintSymbols) ? hintSymbols : []).map(extractCleanSymbol).filter(Boolean))
  const seenMacroLocs = new Set(), candidateDirs = new Set(['.']), moduleDirs = new Set()
  for (const rel of targetPaths.slice(0, 8)) {
    let dir = path.posix.dirname(rel)
    if (dir && dir !== '.') moduleDirs.add(dir)
    while (dir && dir !== '.') {
      candidateDirs.add(dir)
      const parent = path.posix.dirname(dir)
      dir = parent === dir ? '.' : parent
    }
  }
  const moduleSourceTexts = []
  for (const dir of [...moduleDirs].slice(0, 4)) {
    const fullDir = path.resolve(root, dir)
    if (!inside(root, fullDir)) continue
    let entries = []
    try { entries = await readdir(fullDir, { withFileTypes: true }) } catch { continue }
    const files = entries.filter(e => e.isFile() && SOURCE_EXT.test(e.name)).map(e => e.name).sort()
    if (files.length) moduleFiles.push({ directory: dir, files: files.slice(0, 25) })
    const parentDir = path.posix.dirname(dir)
    for (const incName of ['include', 'inc']) {
      const incRel = parentDir && parentDir !== '.' ? `${parentDir}/${incName}` : incName
      try {
        const incFull = path.resolve(root, incRel)
        if (inside(root, incFull)) {
          const incEntries = await readdir(incFull, { withFileTypes: true })
          for (const entry of incEntries.filter(e => e.isFile() && SOURCE_EXT.test(e.name)).slice(0, 10)) {
            const text = await readBoundedText(root, `${incRel}/${entry.name}`)
            if (text) moduleSourceTexts.push({ rel: `${incRel}/${entry.name}`, text })
          }
        }
      } catch {}
    }
    for (const name of files.slice(0, 16)) {
      const rel = `${dir}/${name}`
      const text = await readBoundedText(root, rel)
      if (text) moduleSourceTexts.push({ rel, text })
    }
  }
  for (const rel of targetPaths.slice(0, 8)) {
    if (!moduleSourceTexts.some(item => item.rel === rel)) {
      const text = await readBoundedText(root, rel)
      if (text) moduleSourceTexts.unshift({ rel, text })
    }
  }
  let snippetLinesBudget = 140
  for (const rel of targetPaths.slice(0, 4)) {
    const found = moduleSourceTexts.find(item => item.rel === rel)
    if (!found?.text) continue
    const lines = found.text.split(/\r?\n/)
    const rawRanges = rangesByPath instanceof Map ? rangesByPath.get(rel) : null
    const scanWindows = mergeLineWindows(rawRanges, lines.length, 36, 12)
    for (const [scanStart, scanEnd] of scanWindows) {
      for (let idx = scanStart - 1; idx < scanEnd && targetSymbols.size < 10; idx++) {
        const line = lines[idx]
        if (!line || /^\s*(?:#|\/\/|\/\*|\*)/.test(line)) continue
        const fnMatch = line.match(/^(?:[A-Za-z_][\w\s*:]*?\s+\**)([A-Za-z_][A-Za-z0-9_]{2,})\s*\(/)
        if (!fnMatch || C_CONTROL_KEYWORDS.has(fnMatch[1])) continue
        const headSlice = lines.slice(idx, Math.min(lines.length, idx + 4)).join(' ')
        const braceIdx = headSlice.indexOf('{'), semiIdx = headSlice.indexOf(';')
        if (braceIdx >= 0 && (semiIdx < 0 || braceIdx < semiIdx)) targetSymbols.add(fnMatch[1])
      }
    }
    if (snippetLinesBudget <= 0) continue
    const windows = mergeLineWindows(rawRanges, lines.length)
    for (const [start, rawEnd] of windows) {
      if (snippetLinesBudget <= 0) break
      const end = Math.min(rawEnd, start + snippetLinesBudget - 1, start + 69)
      const numbered = lines.slice(start - 1, end).map((line, idx) => `${start + idx}: ${line.slice(0, 220)}`).join('\n')
      targetSnippets.push({ path: rel, start_line: start, end_line: end, total_lines: lines.length, content: numbered })
      snippetLinesBudget -= (end - start + 1)
    }
  }
  for (const { rel, text } of moduleSourceTexts) {
    const lines = text.split(/\r?\n/)
    let blockRemaining = 0
    for (let index = 0; index < lines.length && conditionalMacros.length < 32; index++) {
      const line = lines[index]
      const matched = MACRO_LINE.test(line)
      const isDirective = /^\s*#\s*(?:define|else|elif|endif)\b/.test(line)
      if (!matched && !(blockRemaining > 0 && isDirective)) {
        if (blockRemaining > 0) blockRemaining -= 1
        continue
      }
      if (matched && /^\s*#\s*(?:if|ifdef|ifndef)\b/.test(line)) blockRemaining = 8
      else if (/^\s*#\s*endif\b/.test(line)) blockRemaining = 0
      else if (blockRemaining > 0) blockRemaining -= 1
      const loc = `${rel}:${index + 1}`
      if (seenMacroLocs.has(loc)) continue
      seenMacroLocs.add(loc)
      conditionalMacros.push({ location: loc, code: line.trim().slice(0, 180) })
    }
  }
  // Discover nearby test subtrees along the ancestor chain without full-repo traversal.
  const queue = [...candidateDirs]
  const visitedDirs = new Set()
  const nearbyTestTexts = []
  while (queue.length && visitedDirs.size < 60) {
    const relDir = queue.shift()
    if (visitedDirs.has(relDir)) continue
    visitedDirs.add(relDir)
    const fullDir = relDir === '.' ? root : path.resolve(root, relDir)
    if (relDir !== '.' && !inside(root, fullDir)) continue
    let entries = []
    try { entries = await readdir(fullDir, { withFileTypes: true }) } catch { continue }
    const fileNames = entries.filter(e => e.isFile()).map(e => e.name).sort()
    if (fileNames.includes('CMakeLists.txt') && cmakeRules.length < 16) {
      const cmakeRel = relDir === '.' ? 'CMakeLists.txt' : `${relDir}/CMakeLists.txt`
      const cmakeText = await readBoundedText(root, cmakeRel)
      if (cmakeText) {
        const hasGlob = /\bfile\s*\(\s*GLOB(?:_RECURSE)?\b/i.test(cmakeText)
        const configureDepends = hasGlob && /\bfile\s*\(\s*GLOB(?:_RECURSE)?[\s\S]{0,240}?CONFIGURE_DEPENDS\b/i.test(cmakeText)
        const hasAux = /\baux_source_directory\s*\(/i.test(cmakeText)
        const hasTarget = /\badd_(?:executable|library)\s*\(/i.test(cmakeText)
        const defs = new Set()
        for (const match of cmakeText.matchAll(FAULT_DEF_TOKEN)) defs.add(match[1])
        cmakeRules.push({
          path: cmakeRel,
          directory: relDir,
          source_collection: hasGlob ? 'file_glob' : hasAux ? 'aux_source_directory' : hasTarget ? 'explicit_list' : 'other',
          ...(hasGlob ? { configure_depends: configureDepends } : {}),
          ctest_or_gtest: /\b(?:enable_testing|add_test|gtest_discover_tests|GTest|gtest)\b/i.test(cmakeText),
          ...(defs.size ? { fault_definitions: [...defs] } : {}),
        })
      }
    }
    const testFiles = fileNames.filter(name => TEST_FILE_NAME.test(name) || (TEST_DIR_NAME.test(path.posix.basename(relDir)) && /\.(?:c|cc|cpp|cxx)$/i.test(name)))
    if (testFiles.length && testDirectories.length < 10) {
      const sampleRel = relDir === '.' ? testFiles[0] : `${relDir}/${testFiles[0]}`
      const sampleText = await readBoundedText(root, sampleRel, 65536)
      const isGtest = Boolean(sampleText && /\bgtest\b|TEST(?:_F|_P)?\s*\(/.test(sampleText))
      testDirectories.push({
        directory: relDir,
        framework: isGtest ? 'gtest' : 'native',
        sample_files: testFiles.slice(0, 8),
      })
      if (!sampleTestSnippet && sampleText) {
        const sampleLines = sampleText.split(/\r?\n/)
        const take = Math.min(sampleLines.length, 40)
        sampleTestSnippet = {
          path: sampleRel,
          total_lines: sampleLines.length,
          content: sampleLines.slice(0, take).map((line, idx) => `${idx + 1}: ${line.slice(0, 220)}`).join('\n'),
        }
      }
      if (sampleText && nearbyTestTexts.length < 12) nearbyTestTexts.push({ rel: sampleRel, text: sampleText })
      for (const extraName of testFiles.slice(1, 6)) {
        if (nearbyTestTexts.length >= 12) break
        const extraRel = relDir === '.' ? extraName : `${relDir}/${extraName}`
        const extraText = await readBoundedText(root, extraRel, 65536)
        if (extraText) nearbyTestTexts.push({ rel: extraRel, text: extraText })
      }
    }
    for (const sub of entries) {
      if (!sub.isDirectory() || sub.name.startsWith('.')) continue
      const childRel = relDir === '.' ? sub.name : `${relDir}/${sub.name}`
      const depth = childRel.split('/').length
      if (TEST_DIR_NAME.test(sub.name) || (TEST_DIR_NAME.test(path.posix.basename(relDir)) && depth <= 6)) queue.push(childRel)
    }
  }
  if (targetSymbols.size && nearbyTestTexts.length) {
    const escaped = [...targetSymbols].map(sym => sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    const symbolRegex = new RegExp(`\\b(${escaped.join('|')})\\b`)
    for (const { rel, text } of nearbyTestTexts) {
      if (existingSymbolTests.length >= 12) break
      const lines = text.split(/\r?\n/)
      for (let idx = 0; idx < lines.length && existingSymbolTests.length < 12; idx++) {
        const line = lines[idx]
        if (!line || /^\s*(?:\/\/|\/\*|\*|#\s*include\b)/.test(line)) continue
        const m = symbolRegex.exec(line)
        if (m) existingSymbolTests.push({ symbol: m[1], path: rel, line: idx + 1, code: line.trim().slice(0, 180) })
      }
    }
  }
  const allFaultDefs = new Map()
  for (const rule of cmakeRules) {
    for (const macro of rule.fault_definitions ?? []) {
      if (!allFaultDefs.has(macro)) allFaultDefs.set(macro, [])
      allFaultDefs.get(macro).push(rule.path)
    }
  }
  const faultMacros = [...allFaultDefs.entries()].map(([name, definedIn]) => {
    const token = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    const usageCount = moduleSourceTexts.filter(item => token.test(item.text)).length
    return { name, defined_in: definedIn, module_usage_count: usageCount }
  })
  if (!moduleFiles.length && !conditionalMacros.length && !cmakeRules.length && !testDirectories.length && !faultMacros.length && !targetSnippets.length && !existingSymbolTests.length) return null
  return {
    ...(targetPaths.length ? { target_files: targetPaths.slice(0, 8) } : {}),
    ...(targetSnippets.length ? { target_snippets: targetSnippets } : {}),
    ...(moduleFiles.length ? { module_files: moduleFiles } : {}),
    ...(conditionalMacros.length ? { conditional_macros: conditionalMacros } : {}),
    ...(testDirectories.length ? { test_directories: testDirectories } : {}),
    ...(sampleTestSnippet ? { sample_test_snippet: sampleTestSnippet } : {}),
    ...(existingSymbolTests.length ? { existing_symbol_tests: existingSymbolTests } : {}),
    ...(cmakeRules.length ? { cmake_rules: cmakeRules } : {}),
    ...(faultMacros.length ? { fault_macros: faultMacros } : {}),
  }
}

// What the generator reads. The full task record repeats each selected case in
// its projection, source_record and evidence copies and carries host bookkeeping
// (status, model, pipeline, verification) the generator never needs.
export function compactGenerationInput(record, analysisSource) {
  const sources = new Map((record.source_repositories ?? []).map(repo => [repo.repo_id, repo]))
  const comparison = value => value && value.available !== false ? {
    changed_count: value.changed_count ?? 0, files: value.files ?? [], eol_only_count: value.eol_only_count ?? 0, lfs_equivalent_count: value.lfs_equivalent_count ?? 0,
  } : null
  return dedupeRepeatedValues({
    task_id: record.id, run_id: record.run_id, case_keys: record.case_keys,
    instructions: record.instructions || '',
    analysis_source: analysisSource,
    ...(record.analysis_context ? { analysis_context: record.analysis_context } : {}),
    repositories: record.repositories.map(repo => ({
      repo_id: repo.repo_id, path: repo.path, base_commit: repo.base_commit, analysis_commit: repo.analysis_commit ?? null,
      personal_branch: repo.branch, outgoing_count: repo.outgoing_count ?? 0,
      analysis_snapshot_comparison: comparison(sources.get(repo.repo_id)?.comparison),
      ...(repo.harness ? { harness: repo.harness } : {}),
    })),
    cases: (record.cases ?? []).map(({ content_hash, ...item }) => item),
  })
}

const INLINE_INPUT_MAX_CHARS = 40000

export function injectionPrompt({ record, inputPath, outputPath, compactInput = '', referencePath = null, referenceError = '' }) {
  const posixInput = posixPath(inputPath), posixOutput = posixPath(outputPath), posixRef = referencePath ? posixPath(referencePath) : null
  const inlined = typeof compactInput === 'string' && compactInput.length > 0 && compactInput.length <= INLINE_INPUT_MAX_CHARS
  return [
    '你正在执行独立的 PANGEA 用例打桩代码生成任务。不要创建分析 Run，也不要调用 Graph bind/settle/work-finish。',
    inlined
      ? `任务输入 JSON 已直接内联在本文末 <task_input_json> 中（无需首轮再调用 read 读取 ${posixInput}；若后续发生上下文压缩丢失细节，可重新读取 ${posixInput}）。其中 cases 是已选用例，analysis_context 是关联风险/覆盖率缺口/流程证据，repositories 含源码副本及宿主预扫描的 harness 事实。输入中 {"$same_as": "<路径>"} 表示该处内容与所指路径（$ 为输入根）的值完全相同，已去重以缩短输入。`
      : `先读取任务输入 JSON：${posixInput}。其中 cases 是已选用例，analysis_context 是关联风险/覆盖率缺口/流程证据，repositories 含本次独立源码副本、固定提交及宿主预扫描的 harness 事实。输入中 {"$same_as": "<路径>"} 表示该处内容与所指路径（$ 为输入根）的值完全相同，已去重以缩短输入。`,
    '宿主已确认的事实，无需再用工具探测：源码副本是宿主刚检出的干净固定提交（不必运行 git status/log 确认）；宿主写入 edits 时按每个文件现有的 CRLF/LF 风格换行，before/after 用 \\n 即可，不必检查换行符；Git、构建与推送均由宿主完成。',
    ...(posixRef ? [`参考结果：${posixRef} 是本任务上一次生成的完整结果 JSON。优先复用其中仍然成立的桩点设计、profiles 与 edits，只针对当前源码重新定位 before 原文并修正失效或被指出的问题；不要从零重新调查。与当前源码冲突时以源码为准。${referenceError ? `上一次未完成的原因：${referenceError}` : ''}`] : []),
    '探索步数预算严格受限（<= 10 次只读工具调用）：repositories[].harness.target_snippets 已预附带目标源码区间的带行号原文，sample_test_snippet 与 existing_symbol_tests 已预附带同目录测试头部样板及目标函数既有测试调用定位；若预切片上下文已足够唯一定位 edits[].before 与测试签名，无需重复 read 同一文件，仅按需补读缺失头文件或调用点后旋即构造并落盘输出 JSON；禁止用 bash 执行 ls/find 遍历目录，禁止研究全仓构建脚本。',
    '若 repositories[].harness 给出了 C/C++ 单元测试环境（test_directories 含 gtest/native 或 cmake_rules/fault_macros）：① 若 fault_macros 显示某测试编译宏（如 -D*_SIMU_FAULT）的 module_usage_count=0，说明当前模块无现成注入消费点，直接在目标函数对应的 #ifdef <测试宏> 保护下植入默认关闭的最小控制桩，不要全仓搜寻既有框架；② 按 Option A 在 test_directories 配套新增（before=null）或补充 gtest 用例文件，在同一测试目标内依次覆盖“桩默认关闭正常路径 → 启用桩命中目标超时/错误分支 → 复位后恢复正常”，同进程测试优先通过受控开关函数/原子计数或环境变量触发，阻塞等待必须有界且时长直接复用源码超时宏或兼容 harness.conditional_macros 中的 ASAN/非 ASAN 阈值（严禁写死小于 ASAN 超时阈值的短常数）；③ 若对应 cmake_rules 为 file_glob，无需修改构建文件，若 configure_depends=false 则在 steps 中先执行 cmake 重新生成以纳入新测试文件，运行 gtest 时指定 --gtest_filter 并校验实际执行用例数 >= 1（防止匹配 0 条用例时仍返回 0）。',
    '只在这些仓库内调查需要的实现与既有调测入口。核对所选用例引用的 analysis_source 冻结片段与本次源码副本，分析基线与本次基线不同则重新定位；只比较相关位置，差异对注入方案的影响写入 summary，不重做全仓分析。',
    '不要修改或推送源码仓库，不运行构建或安装命令。唯一交付是下述 JSON 文件；宿主负责精确写入、提交和推送。',
    '源码副本是只读输入，包括拟新增文件的位置：禁止用 write/edit/apply_patch 或 shell 直接在 repositories 中创建或修改文件，也不要先写源文件再把它读回生成 edits。新增模块的完整源码放进 edits[].after 字符串，before=null；已有文件修改用 before/after 字符串描述。',
    '防单步超长输出截断：edits[].before 只截取当前文件中唯一匹配的最短 1~5 行原文，严禁整函数大段复制；不要在思考或回复正文中预先默写整份源码或完整 JSON。可直接用 write 工具写入目标 JSON，或在输出文件的父目录写简短脚本生成目标 JSON。交付前确认输出文件存在、JSON 可解析且 edits 非空，然后立即结束；聊天里的代码块不能代替磁盘交付。',
    '本任务不搭建模拟 HTTP/数据库/容器栈，不启动后台服务，不执行 profiles 中的部署或业务操作。自检限定为 JSON 合同、原文替换唯一性及源码语法；真实构建与端到端实测由宿主后续执行，不能把模拟结果写成实测结论。',
    '先完成调用路径与副作用判断，再生成实际可编译的修改。故障注入制造原因，保留原有错误处理和恢复逻辑，不直接篡改预期结果。',
    '同包多个桩默认关闭，具有独立启停方式。限定目标对象/调用阶段/次数，记录实际命中，次数配置为零或负数时明确禁用。优先复用真实已有调测入口；没有时实现符合项目语言与构建方式的最小控制入口，并把必要源文件/构建接入一起纳入 edits。',
    '逐用例说明按真实执行顺序组织：关闭全部桩验证正常基线 → 启用目标桩执行并检查实际命中及故障后状态 → 关闭桩或耗尽次数后验证恢复（若开关仅启动时读取则写明重启顺序与需重建状态；分轮/组合桩写明触发顺序，基线准备不得提前消耗一次性桩）。同一分支上已有兼容桩点须复用；不能落地的部分写入 limitations，不能编造命令或宣称已编译/实测。',
    '逐步核对观测断言：不得断言目录只剩业务文件；时间戳考虑实际精度并结合内容/计数验证恢复；区分命令退出码与业务返回值。',
    '安全合同 v2（包括参考旧结果和复用结果）：每个 points 元素增加 trigger_scope:{current_input:string,excluded_inputs:[string]}，明确真实调用链上当前请求/当前操作的来源与匹配表达式。禁止用完整 SQL 参数、序列化历史、日志或持久化上下文的全文匹配代替当前输入；历史里含标记而当前输入不含时不得命中、不得消耗次数。不能可靠隔离当前输入时停止该方案，不能扩大命中范围。',
    '每个 profile 增加 safety:{setup:[string],negative_steps:[string],negative_point_ids:[id],cleanup:[string],cleanup_verify:[string]}。这些数组均须非空、可执行，negative_point_ids 覆盖本 profile 全部桩点。setup 先保存原控制状态（包括文件原本不存在及原始字节）和本轮独占资源标识；negative_steps 在全新未消耗的次数预算下验证非目标历史/上下文不触发、计数不变，然后 steps 验证目标确实命中、重试和撤桩恢复。不要通过先耗尽次数制造负向通过。',
    '宿主按 setup → negative_steps → steps 顺序执行，并在同一 profile 的独立 shell 中安装 EXIT/INT/TERM 清理。cleanup 必须独立幂等、容忍 setup 只执行一部分和未定义变量，恢复原控制状态、只清理本轮创建且确属本轮的测试数据/服务；cleanup_verify 独立验证精确恢复与资源清理。不要覆盖宿主 trap、使用 exec 替换宿主或在后台留下未等待的业务命令；Python/其他子进程也须以 try/finally 处理自身资源。清理所需状态不可只存于已退出的子进程内存。保留证据日志；SIGKILL/断电等不可捕获退出明确列入 limitations。',
    '资源清理必须覆盖本轮登录创建的认证会话/令牌，而不只是 HTTP 连接与业务数据；在 finally/cleanup 撤销或删除仅本轮拥有的认证会话，并独立查询确认不再有效。创建远端业务对象前先持久化本轮唯一 ID/所有权凭据，成功响应到达后先登记资源再做结果断言，以便请求已成功但断言失败/超时也能回收；禁止按用户或时间范围批量删除不属于本轮的数据。含认证信息的状态文件须限制访问且不得写进证据日志。',
    '清理不能把快照损坏/丢失等同于原状态不存在；原本存在而备份缺失时必须保留现状并报错，不得擅自删除控制文件或宣称恢复成功。清理某资源失败后仍应尝试其它资源，最终汇总失败并非零退出；验证不能吞错。',
    '恢复备份必须验证完整性：用明确存在标记、严格类型与严格解码（Python base64.b64decode(..., validate=True)），必要时核对原字节哈希。备份缺失或解码损坏不能跳过检查后打印成功，也不能把非法编码宽松解码成空字节并覆盖现状；无法证明原状态时清理与独立核验均须非零。每项资源恢复使用独立异常边界，读取/解码/写入控制备份失败仍须继续撤销本轮认证资源与清理业务数据，最后汇总失败。',
    '空文件（零字节/空 base64 字符串）是合法的原始快照，必须与字段不存在、备份损坏分开判定，不能用字符串 truthiness 判断备份是否存在。覆盖正常存在、原本不存在、原本为空三种恢复基线。登录等资源分配调用前持久化本轮唯一所有权标识；获得凭据后立即落盘，先于任何后续身份探测或断言。后续探测失败或调用结果未知时，也要能按本轮唯一标识回收并核验；不能把“尚未登记 token”当作“未创建会话”而报告成功。',
    '核对运行时库的真实数据形状：数据库驱动默认 tuple 行不能直接 dict(row)，需显式字典行工厂或按列名转换；不能仅凭语法检查推断运行成功。控制开关与次数必须严格校验类型，字符串 false 等非布尔值不能因 truthy 被当作启用；异常或不完整控制数据默认禁用。',
    'JSON 结构：{summary:string, points:[{id,case_keys:[string],repo_id,path,symbol,action,trigger,trigger_scope:{current_input:string,excluded_inputs:[string]},times,enable,disable,observe,cleanup,depends_on:[id],exclusive_with:[id]}], profiles:[{case_key,point_ids:[id],safety:{setup:[string],negative_steps:[string],negative_point_ids:[id],cleanup:[string],cleanup_verify:[string]},steps:[string]}], edits:[{repo_id,path,before:string|null,after:string}], limitations:[string]}。',
    'case_key 必须逐字使用输入的 case_key。points/profiles 是业务说明；edits 才是实际修改。before 为当前文件中唯一出现的原文，after 为替换内容；新增文件 before=null。path 为仓库相对路径。不要包含 .git 文件，不删除文件。',
    'profiles 必须与输入 case_keys 一一对应：总数相同、case_key 集合相同且每个 case_key 只出现一次；同一用例的多轮场景合并在同一个 profile.steps 中，steps 数组每个元素都必须是非空的可执行命令或 # 注释行（禁止放入空字符串 "" 或纯空白元素，分节请用 # 注释），给出能直接执行的启用、关闭及命中检查方法，变量先定义后使用，不用伪命令或“同上”。',
    '宿主会将同一 profile.steps 按顺序原样拼入头部带 set -euo pipefail 的单个 bash 脚本执行，并需兼容 macOS 默认 bash 3.2（UTF-8/C.UTF-8）：禁止 declare -A、mapfile/readarray、|&、${var,,} 等 Bash 4+ 语法；变量紧邻中文或非 ASCII 标点时必须写作 ${VAR}；严禁把缺少末尾换行的数据交给 read（如 curl 应用 code=$(curl -sS -o "$body_file" -w \'%{http_code}\' ...) 分离响应体与状态码，或用 read -r var || [[ -n "$var" ]]）；pipefail 下“无匹配”断言用 ! grep -q；内嵌 Python 用 True/False/None，SQL 聚合遵守 GROUP BY，关键断言失败须非零退出。',
    `把完整 JSON 写入 ${posixOutput}，写完结束。任务 ID：${record.id}。`,
    ...(inlined ? [`<task_input_json>\n${compactInput}\n</task_input_json>`] : []),
  ].join('\n')
}

export function normalizeInjectionResult(value) {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value.profiles)) {
    for (const profile of value.profiles) {
      if (profile && Array.isArray(profile.steps)) {
        // Strip empty/whitespace separator lines while keeping non-string items
        // intact so checkInjectionResult still rejects malformed element types.
        profile.steps = profile.steps.filter(step => typeof step !== 'string' || step.trim().length > 0)
      }
    }
  }
  if (Array.isArray(value.limitations)) {
    value.limitations = value.limitations.filter(item => typeof item !== 'string' || item.trim().length > 0)
  }
  return value
}

export function checkInjectionResult(value, record) {
  normalizeInjectionResult(value)
  if (!value || !Array.isArray(value.edits) || !value.edits.length) throw serviceError('Agent 未提供实际代码修改；本轮未形成修改，可重新生成')
  if (!Array.isArray(value.points) || !value.points.length || !Array.isArray(value.profiles)) throw serviceError('生成结果缺少桩点或逐用例执行说明')
  if (record.generation_contract_version >= 2) {
    const commands = items => Array.isArray(items) && items.length > 0
      && items.every(item => typeof item === 'string' && item.trim())
      && items.some(item => item.split('\n').some(line => line.trim() && !line.trim().startsWith('#')))
    for (const point of value.points) {
      const scope = point?.trigger_scope
      if (!scope || typeof scope.current_input !== 'string' || !scope.current_input.trim()
        || !Array.isArray(scope.excluded_inputs) || !scope.excluded_inputs.length
        || scope.excluded_inputs.some(item => typeof item !== 'string' || !item.trim())) {
        throw serviceError(`桩点 ${point?.id || '?'} 缺少当前输入来源与历史/非目标输入排除范围，请重新生成`)
      }
    }
    for (const profile of value.profiles) {
      const safety = profile?.safety
      if (!safety || ['setup', 'negative_steps', 'cleanup', 'cleanup_verify'].some(key => !commands(safety[key]))
        || !Array.isArray(safety.negative_point_ids) || !Array.isArray(profile.point_ids)
        || profile.point_ids.some(id => !safety.negative_point_ids.includes(id))
        || safety.negative_point_ids.some(id => !profile.point_ids.includes(id))) {
        throw serviceError(`用例 ${profile?.case_key || '?'} 缺少触发范围负向验证、退出清理或恢复检查，请重新生成`)
      }
    }
  }
  const repoIds = new Set(record.repositories.map(repo => repo.repo_id)), pointIds = new Set()
  for (const point of value.points) {
    if (!point || typeof point.id !== 'string' || !point.id || pointIds.has(point.id) || !repoIds.has(point.repo_id)) throw serviceError('生成结果包含重复桩点编号或未选择的仓库')
    pointIds.add(point.id)
  }
  for (const key of record.case_keys) {
    const profiles = value.profiles.filter(profile => profile?.case_key === key)
    if (profiles.length !== 1 || !Array.isArray(profiles[0].steps) || !profiles[0].steps.length
      || profiles[0].steps.some(step => typeof step !== 'string' || !step.trim())
      || !Array.isArray(profiles[0].point_ids) || !profiles[0].point_ids.length
      || profiles[0].point_ids.some(point => !pointIds.has(point))) throw serviceError(`用例 ${key} 缺少可读取的桩点引用或执行说明`)
  }
  if (value.edits.some(edit => !edit || !repoIds.has(edit.repo_id))) throw serviceError('代码修改引用了未选择的仓库')
  for (const edit of value.edits) {
    if (typeof edit.before === 'string' && edit.before === edit.after) throw serviceError(`代码修改前后内容相同：${edit.path}`)
  }
  const editedByRepo = new Map()
  for (const edit of value.edits) {
    if (!editedByRepo.has(edit.repo_id)) editedByRepo.set(edit.repo_id, new Set())
    editedByRepo.get(edit.repo_id).add(posixPath(edit.path))
  }
  for (const edit of value.edits) {
    if (edit.before !== null || !/\.(?:c|cc|cpp|cxx)$/i.test(edit.path || '')) continue
    const repo = record.repositories.find(item => item.repo_id === edit.repo_id)
    const rules = repo?.harness?.cmake_rules
    if (!Array.isArray(rules) || !rules.length) continue
    const normalized = posixPath(edit.path)
    const covering = rules
      .filter(rule => rule.directory === '.' || normalized.startsWith(`${rule.directory}/`))
      .sort((a, b) => b.directory.length - a.directory.length)[0]
    if (covering?.source_collection === 'explicit_list' && !editedByRepo.get(edit.repo_id)?.has(covering.path)) {
      throw serviceError(`新增源文件 ${normalized} 所在目录使用显式构建列表（${covering.path}），请在 edits 中同步接入构建文件`)
    }
  }
  return value
}

export class FaultInjectionService {
  constructor({ generate, git = injectionGit, validateModel } = {}) { this.validateModel = validateModel; this.generate = generate; this.git = git; this.active = new Map(); this.queues = new Map(); this.branchQueues = new Map() }
  key(dataRoot, runId, taskId) { return JSON.stringify([path.resolve(dataRoot), runId, taskId]) }
  async directory(dataRoot, runId, taskId) {
    if (!id(runId) || (taskId != null && !id(taskId))) throw serviceError('打桩任务或 Run 标识无效')
    const root = await realpath(dataRoot)
    const base = path.join(root, '.pangea', 'fault-injection', runId, ...(taskId ? [taskId] : []))
    await mkdir(base, { recursive: true })
    if (!inside(root, await realpath(base))) throw serviceError('打桩任务目录越出数据目录')
    return base
  }
  async save(directory, record) {
    record.updated_at = new Date().toISOString()
    await writeTaskStoreFile(path.join(directory, 'task.json'), JSON.stringify(record, null, 2) + '\n')
  }
  async resolveSavedResultFile(directory) {
    const genDir = path.join(directory, 'generation')
    const resultFile = path.join(genDir, 'result.json')
    const authoredFile = path.join(genDir, 'authored-result.json')
    const statSafe = async file => {
      try { const st = await lstat(file); return st.isFile() && st.size > 0 ? st : null }
      catch (error) { if (error.code === 'ENOENT') return null; throw error }
    }
    const [rStat, aStat] = await Promise.all([statSafe(resultFile), statSafe(authoredFile)])
    if (rStat && aStat) return aStat.mtimeMs > rStat.mtimeMs ? authoredFile : resultFile
    if (rStat) return resultFile
    if (aStat) return authoredFile
    return null
  }
  async read(dataRoot, runId, taskId) {
    const directory = await this.directory(dataRoot, runId, taskId)
    // Tasks written before result_saved existed (or aborted right after result.json
    // landed on disk) still expose their saved result for revalidate / reuse.
    const withSavedResult = async value => {
      if (!value.result_saved) {
        if (await this.resolveSavedResultFile(directory)) value.result_saved = true
      }
      if (value.commit_config && typeof value.commit_config === 'object' && value.commit_config.mode === 'default' && !value.commit_config.explicit_default_mode) {
        const upgraded = { ...value.commit_config }
        delete upgraded.mode
        if (!upgraded.pattern) delete upgraded.pattern
        value.commit_config = normalizeCommitConfig(upgraded)
      }
      return value
    }
    let record = await withSavedResult(JSON.parse(await readFile(path.join(directory, 'task.json'), 'utf8')))
    if (record.id !== taskId || record.run_id !== runId) throw serviceError('打桩任务身份不匹配')
    if (activeStates.has(record.status) && !this.active.has(this.key(dataRoot, runId, taskId))) {
      // Completion publishes its terminal record before removing the operation.
      // Our first asynchronous read may have observed the preceding generation.
      record = await withSavedResult(JSON.parse(await readFile(path.join(directory, 'task.json'), 'utf8')))
      if (record.id !== taskId || record.run_id !== runId) throw serviceError('打桩任务身份不匹配')
      if (activeStates.has(record.status) && !this.active.has(this.key(dataRoot, runId, taskId))) return { ...record, status: 'interrupted', error: '上次操作已中断；可重新生成，已提交的修改仍保留' }
    }
    const operation = this.active.get(this.key(dataRoot, runId, taskId))
    // A terminal file can be visible before branch-lock cleanup finishes. Keep
    // HTTP callers in the active state until mutations can actually be accepted.
    if (operation && !activeStates.has(record.status)) return { ...record, status: operation.status }
    return record
  }
  async list(dataRoot, runId) {
    const directory = await this.directory(dataRoot, runId)
    const records = []
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (!item.isDirectory() || !id(item.name)) continue
      try { records.push(await this.read(dataRoot, runId, item.name)) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
    return records.sort((a, b) => b.created_at.localeCompare(a.created_at))
  }
  async configurePipeline(dataRoot, runId, taskId, value) {
    const url = String(value || '').trim()
    if (url) {
      let parsed
      try { parsed = new URL(url) } catch { throw serviceError('请输入完整的构建流水线 HTTP/HTTPS 地址') }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw serviceError('流水线地址需使用 HTTP/HTTPS，且不能包含账号密码')
    }
    const save = async () => {
      let task
      if (taskId) {
        task = await this.read(dataRoot, runId, taskId)
        task.pipeline_url = url
        await this.save(await this.directory(dataRoot, runId, taskId), task)
      }
      await writeTaskStoreFile(path.join(await this.directory(dataRoot, runId), 'pipeline.json'), JSON.stringify({ pipeline_url: url }))
      return { pipeline_url: url, task }
    }
    return taskId ? this.exclusive(dataRoot, runId, taskId, save) : save()
  }
  async commitDefaultsPath(dataRoot) {
    const root = await realpath(dataRoot)
    const dir = path.join(root, '.pangea', 'fault-injection')
    await mkdir(dir, { recursive: true })
    if (!inside(root, await realpath(dir))) throw serviceError('打桩任务目录越出数据目录')
    return path.join(dir, 'commit-defaults.json')
  }
  async readCommitDefaults(dataRoot) {
    try {
      const parsed = JSON.parse(await readFile(await this.commitDefaultsPath(dataRoot), 'utf8'))
      if (parsed && typeof parsed === 'object' && parsed.mode === 'default' && !parsed.explicit_default_mode) {
        delete parsed.mode
        if (!parsed.pattern) delete parsed.pattern
      }
      return normalizeCommitConfig(parsed)
    } catch (error) {
      if (error.code === 'ENOENT') return normalizeCommitConfig({})
      throw error
    }
  }
  async saveCommitDefaults(dataRoot, config) {
    const normalized = normalizeCommitConfig(config, await this.readCommitDefaults(dataRoot))
    const reusable = {
      mode: normalized.mode,
      ...(normalized.explicit_default_mode ? { explicit_default_mode: true } : {}),
      template: normalized.template,
      issue: normalized.issue,
      author: normalized.author,
      reviewer: normalized.reviewer,
      pattern: normalized.pattern,
    }
    await writeTaskStoreFile(await this.commitDefaultsPath(dataRoot), JSON.stringify(reusable, null, 2) + '\n')
    return normalized
  }
  async defaults(dataRoot, run) {
    const progressFile = path.join(dataRoot, 'runs', run.run_id, 'progress.json')
    let progress = {}
    try { progress = JSON.parse(await readFile(progressFile, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    let contract = {}
    try { contract = JSON.parse(await readFile(path.join(dataRoot, 'runs', run.run_id, 'inputs', 'task-contract.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const repos = run.source_snapshot?.repositories?.length ? run.source_snapshot.repositories : (run.repositories ?? []).map(repo_id => ({ repo_id }))
    let pipeline = {}
    try { pipeline = JSON.parse(await readFile(path.join(await this.directory(dataRoot, run.run_id), 'pipeline.json'), 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
    const commit_config = await this.readCommitDefaults(dataRoot)
    const repositories = []
    for (const repo of repos) {
      const settings = await readRepositorySettings(dataRoot, repo.repo_id)
      const sourcePath = settings.git_path || path.join(dataRoot, 'repositories', repo.repo_id)
      let source
      try { source = await inspectSource(sourcePath) } catch (error) { source = { kind: 'unavailable', error: error.message } }
      const baseline = settings.personal_branch ? `refs/heads/${settings.personal_branch}` : 'HEAD'
      let comparison = { available: false, changed_count: 0, files: [] }
      if (source.kind === 'git') {
        try { comparison = await compareSnapshot(sourcePath, baseline, path.join(dataRoot, 'runs', run.run_id, 'inputs', 'source', repo.repo_id)) }
        catch (error) { comparison = { available: false, error: error.message } }
      }
      repositories.push({ repo_id: repo.repo_id, source_path: sourcePath, base_ref: baseline, personal_branch: settings.personal_branch || '', remote_branch: settings.remote_branch || settings.personal_branch || '', remote: settings.remote || 'origin',
        analysis_commit: repo.git?.commit ?? repo.git?.head ?? null, source, comparison, linked: Boolean(settings.git_path), project_pipeline_configured: Object.hasOwn(settings, 'pipeline_url'), pipeline_url: settings.pipeline_url || '' })
    }
    const projectPipeline = repositories.find(repo => repo.project_pipeline_configured)
    return { pipeline_url: projectPipeline ? projectPipeline.pipeline_url : pipeline.pipeline_url || '',
      provider_id: contract.model_settings?.provider ?? progress.model_settings?.provider ?? '', agent_model: contract.model_id ?? progress.model_id ?? '', commit_config, repositories }
  }

  async previewBaseline(dataRoot, run, input) {
    const defaults = await this.defaults(dataRoot, run)
    const known = new Set(defaults.repositories.map(repo => repo.repo_id))
    const repositories = []
    for (const repo of input.repositories || defaults.repositories) {
      if (!known.has(repo.repo_id)) throw serviceError('请选择当前分析的源码仓库')
      const source = await inspectSource(repo.source_path)
      if (source.kind !== 'git') throw serviceError(source.error || `${repo.repo_id} 是普通目录，请先关联 Git 仓库`)
      const ref = String(repo.base_ref || 'HEAD')
      if (ref.startsWith('-') || /[\x00-\x20]/.test(ref)) throw serviceError('源码基线无效')
      const base_ref = await this.git(source.path, ['rev-parse', '--verify', `${ref}^{commit}`])
      const comparison = await compareSnapshot(source.path, base_ref, path.join(dataRoot, 'runs', run.run_id, 'inputs', 'source', repo.repo_id))
      repositories.push({ ...repo, source, base_ref, comparison })
    }
    return repositories
  }
  async start({ dataRoot, run, input, cwd }, { requireReceipt = true } = {}) {
    const keys = input.case_keys
    const cases = run.details?.test_cases ?? []
    if (!Array.isArray(keys) || !keys.length || new Set(keys).size !== keys.length) throw serviceError('请选择需要打桩的用例')
    const selected = keys.map(key => {
      const matches = cases.filter(item => caseIdentity(item) === key)
      if (matches.length !== 1) throw serviceError(`用例不存在或身份重复：${key}`)
      return { ...matches[0], case_key: key, content_hash: caseContentHash(matches[0]) }
    })
    const defaults = await this.defaults(dataRoot, run)
    const repositories = input.repositories ?? defaults.repositories
    const known = new Map(defaults.repositories.map(repo => [repo.repo_id, repo]))
    if (!Array.isArray(repositories) || !repositories.length || new Set(repositories.map(repo => repo.repo_id)).size !== repositories.length
      || repositories.some(repo => !known.has(repo.repo_id))) throw serviceError('请选择当前 Run 的源码仓库')
    const selectedRepositories = repositories.map(repo => {
      if (typeof repo.repo_id !== 'string' || !repo.repo_id || /[\\/:\x00-\x1f]/.test(repo.repo_id) || ['.', '..'].includes(repo.repo_id)) throw serviceError('仓库标识无效')
      const configured = known.get(repo.repo_id)
      if (!configured.personal_branch) throw serviceError(`${repo.repo_id}：请先在项目配置选择个人开发分支`)
      const forbidden = protectedBranchReason(configured.personal_branch) || protectedBranchReason(configured.remote_branch)
      if (forbidden) throw serviceError(`${repo.repo_id}：${forbidden}。请在项目配置改选个人开发分支`)
      return { ...configured }
    })
    // A saved result of an earlier task in this Run: either applied as-is (reuse,
    // no model call) or handed to the generator as a starting point (reference).
    const savedResult = async (taskId, label) => {
      if (taskId == null || taskId === '') return null
      if (!id(taskId)) throw serviceError(`${label}任务标识无效`)
      const file = await this.resolveSavedResultFile(await this.directory(dataRoot, run.run_id, taskId))
      if (!file) throw serviceError(`${label}任务没有已保存的生成结果，请重新生成`)
      return { task_id: taskId, file, sha256: hash(await readFile(file)) }
    }
    const reused = await savedResult(input.reuse_task_id, '复用')
    const reference = reused ? null : await savedResult(input.reference_task_id, '参考')
    const providerId = input.provider_id || defaults.provider_id
    let model = input.agent_model ?? defaults.agent_model
    // Reuse never starts the generator, so an unavailable model must not block it.
    if (this.validateModel && !reused) {
      try { model = await this.validateModel({ providerId, model, cwd, catalogId: input.agent_catalog_id, requireReceipt }) }
      catch (error) { throw serviceError(error.message) }
    }
    if (!providerId || !model) throw serviceError('请选择打桩执行器和模型')
    let commitConfig = null
    if (input.commit_config && typeof input.commit_config === 'object') {
      const normalizedCommit = normalizeCommitConfig(input.commit_config, defaults.commit_config)
      const precheck = resolveCommitMessage(normalizedCommit, { id: 'pending', name: input.name || selected[0]?.title || '' }, { allowPendingSummary: true })
      if (!precheck.ok) throw serviceError(precheck.error)
      commitConfig = await this.saveCommitDefaults(dataRoot, normalizedCommit)
    } else if (defaults.commit_config) {
      const precheck = resolveCommitMessage(defaults.commit_config, { id: 'pending', name: input.name || selected[0]?.title || '' }, { allowPendingSummary: true })
      if (precheck.ok) commitConfig = defaults.commit_config
    }
    const pipeline = await this.configurePipeline(dataRoot, run.run_id, null, input.pipeline_url ?? defaults.pipeline_url)
    const taskId = randomUUID(), directory = await this.directory(dataRoot, run.run_id, taskId)
    const record = { schema_version: 2, generation_contract_version: 2, id: taskId, run_id: run.run_id, status: 'preparing', created_at: new Date().toISOString(),
      name: String(input.name || selected[0].title || '打桩任务').slice(0, 100), pipeline_url: pipeline.pipeline_url, branch: [...new Set(selectedRepositories.map(repo => repo.personal_branch))].join('、'), case_keys: keys, cases: selected,
      analysis_context: run.analysis_context ?? extractAnalysisContext(run, selected), repositories: [], source_repositories: selectedRepositories,
      provider_id: providerId, agent_model: model, agent_catalog_id: input.agent_catalog_id || null,
      baseline_acknowledged: input.baseline_acknowledged === true, instructions: String(input.instructions || ''),
      ...(commitConfig ? { commit_config: commitConfig } : {}),
      result: null, generation_complete: false, verification: [], build: {}, error: null,
      reused_from: reused, reference_from: reference ? { ...reference, error: String(input.reference_error || '').slice(0, 1500) } : null, telemetry: null, notices: [] }
    if (!record.provider_id || !record.agent_model) throw serviceError('请选择打桩执行器和模型，可复用本次分析的设置')
    const controller = new AbortController(), key = this.key(dataRoot, run.run_id, taskId)
    const operation = { controller, done: null, status: 'generating' }
    this.active.set(key, operation)
    const published = this.save(directory, record)
    operation.done = published.then(() => this.prepareAndGenerate({ dataRoot, directory, record, cwd, signal: controller.signal }))
      .catch(async error => { record.failure_phase = record.status; record.status = controller.signal.aborted ? 'cancelled' : 'failed'; record.error = cleanError(error); await this.save(directory, record) })
      .finally(() => this.active.delete(key))
    await published
    return record
  }
  async prepareAndGenerate({ dataRoot, directory, record, cwd, signal }) {
    for (const source of record.source_repositories) {
      await repositoryOperation(dataRoot, source.repo_id, async operationSignal => {
      const signal = operationSignal
      signal.throwIfAborted()
      const sourcePath = await realpath(source.source_path)
      const top = await this.git(sourcePath, ['rev-parse', '--show-toplevel'], signal)
      if (await realpath(top) !== sourcePath) throw serviceError(`请指定 Git 仓库根目录：${source.repo_id}`)
      const branch = source.personal_branch
      const remoteBranch = source.remote_branch || branch
      await this.git(sourcePath, ['check-ref-format', '--branch', remoteBranch], signal)
      await this.git(sourcePath, ['check-ref-format', '--branch', branch], signal)
      const baseCommit = await this.git(sourcePath, ['rev-parse', '--verify', `refs/heads/${branch}^{commit}`], signal)
      const comparison = await compareSnapshot(sourcePath, baseCommit, path.join(dataRoot, 'runs', record.run_id, 'inputs', 'source', source.repo_id))
      const dirty = Boolean(await this.git(sourcePath, ['status', '--porcelain'], signal))
      // Differences are supplied to the generator for relocation against the target
      // checkout. A dirty original or a linked repository is not itself a conflict.
      source.comparison = comparison
      source.working_tree_dirty = dirty
      const remote = String(source.remote || 'origin')
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw serviceError('远端名称无效')
      const remoteUrl = await this.git(sourcePath, ['remote', 'get-url', '--push', remote], signal)
      const checkout = path.join(directory, 'repositories', source.repo_id)
      await mkdir(path.dirname(checkout), { recursive: true })
      await this.git(directory, ['clone', '--no-hardlinks', '--no-checkout', '--', sourcePath, checkout], signal)
      // Clone does not carry local user config; preserve attribution when set.
      for (const setting of ['user.name', 'user.email']) {
        try { const value = await this.git(sourcePath, ['config', '--get', setting], signal); if (value) await this.git(checkout, ['config', setting, value], signal) }
        catch (error) { if (signal.aborted) throw error }
      }
      await this.git(checkout, ['remote', 'set-url', 'origin', remoteUrl], signal)
      // Fetch exactly the configured existing branch. Missing remote branches are not created.
      await this.git(checkout, ['fetch', '--no-tags', 'origin', `refs/heads/${remoteBranch}`], signal)
      const remoteHead = await this.git(checkout, ['rev-parse', 'FETCH_HEAD'], signal)
      const ancestor = await this.git(checkout, ['merge-base', baseCommit, remoteHead], signal)
      if (ancestor !== baseCommit && ancestor !== remoteHead) throw serviceError(`${source.repo_id}：个人分支与远端已分叉，请先处理冲突`)
      const target = ancestor === baseCommit ? remoteHead : baseCommit
      const ahead = Number(await this.git(checkout, ['rev-list', '--count', `${remoteHead}..${target}`], signal))
      await this.git(checkout, ['checkout', '--detach', target], signal)
      source.comparison = await compareSnapshot(checkout, target, path.join(dataRoot, 'runs', record.run_id, 'inputs', 'source', source.repo_id))
      // Anything present now was produced by the host checkout, not by the generator.
      const baseline = await workspaceSnapshot(this.git, checkout, signal)
      const { paths: targetPaths, rangesByPath, symbols: hintSymbols } = collectTargetEvidenceSpecs(source.repo_id, record.cases, record.analysis_context)
      const harness = await inspectRepositoryHarness(checkout, source.repo_id, targetPaths, rangesByPath, hintSymbols)
      record.repositories.push({ repo_id: source.repo_id, path: checkout, source_path: sourcePath,
        base_commit: target, source_head: baseCommit, remote_head: remoteHead, remote_url: remoteUrl,
        outgoing_count: ahead, analysis_commit: source.analysis_commit,
        has_remote: true, branch, remote_branch: remoteBranch, commit: null, pushed: false,
        workspace_baseline: baseline,
        baseline_unstaged: baseline.filter(entry => entry.status !== '??' && entry.status[1] !== ' ').map(entry => entry.path),
        ...(harness ? { harness } : {}) })
      await this.save(directory, record)
      }, { wait: true, signal })
    }
    signal.throwIfAborted()
    const scratchDirectory = path.join(directory, 'generation')
    await mkdir(scratchDirectory, { recursive: true })
    const inputPath = path.join(scratchDirectory, 'input.json'), outputPath = path.join(scratchDirectory, 'result.json')
    const analysisSource = path.join(dataRoot, 'runs', record.run_id, 'inputs', 'source')
    const fullInput = JSON.stringify({ ...record, analysis_source: analysisSource }, null, 2)
    const compactInput = JSON.stringify(compactGenerationInput(record, analysisSource), null, 1)
    await writeFile(inputPath, compactInput)
    record.input_stats = { full_bytes: Buffer.byteLength(fullInput), compact_bytes: Buffer.byteLength(compactInput) }
    record.status = 'generating'; await this.save(directory, record)
    let generated
    if (record.reused_from) {
      // Apply an earlier task's saved result to this fresh checkout; no model call.
      const bytes = await readFile(record.reused_from.file)
      if (hash(bytes) !== record.reused_from.sha256) throw serviceError('复用的生成结果在创建任务后被修改，请重新选择')
      generated = JSON.parse(bytes.toString('utf8'))
      await writeFile(outputPath, bytes)
    } else {
      if (typeof this.generate !== 'function') throw serviceError('打桩执行器未接入')
      let referencePath = null
      if (record.reference_from) {
        referencePath = path.join(scratchDirectory, 'reference-result.json')
        await writeFile(referencePath, await readFile(record.reference_from.file))
      }
      const result = await this.generate({ record, cwd, scratchDirectory, inputPath, outputPath, signal,
        prompt: injectionPrompt({ record, inputPath, outputPath, compactInput, referencePath, referenceError: record.reference_from?.error }) + `\n用户补充说明：${record.instructions || '无'}`,
        onStarted: async session => { record.agent_session = session; await this.save(directory, record) },
        onTelemetry: async telemetry => { record.telemetry = telemetry; await this.save(directory, record) } })
      signal.throwIfAborted()
      generated = result ?? JSON.parse(await readFile(outputPath, 'utf8'))
    }
    await this.applyAndStageResult({ directory, scratchDirectory, record, generated, signal, isRevalidate: false })
  }
  async applyAndStageResult({ directory, scratchDirectory, record, generated, signal, isRevalidate = false }) {
    normalizeInjectionResult(generated)
    await mkdir(scratchDirectory, { recursive: true })
    // Keep the authored result available even if its transport shape is broken.
    await writeFile(path.join(scratchDirectory, 'authored-result.json'), JSON.stringify(generated, null, 2))
    record.result_saved = true
    await this.save(directory, record)
    checkInjectionResult(generated, record)
    record.result = { ...generated }; delete record.result.edits
    await this.save(directory, record)
    for (const repo of record.repositories) {
      signal?.throwIfAborted?.()
      if (isRevalidate) {
        try { if (!(await lstat(repo.path)).isDirectory()) throw new Error('missing') }
        catch { throw serviceError(`${repo.repo_id}：本任务的独立源码副本已不存在，请使用“直接复用已留存的生成结果”在新副本上应用`) }
        await this.git(repo.path, ['checkout', '-q', '--force', '--detach', repo.base_commit], signal)
        await this.git(repo.path, ['reset', '-q', '--hard', repo.base_commit], signal)
        await this.git(repo.path, ['clean', '-q', '-f', '-f', '-d'], signal)
        repo.diff = null; repo.diff_sha256 = null; repo.files = []
      } else {
        // The delivery is the result file. Changes the generator made to its source
        // copy are never mixed in: they are recorded, discarded, and the result is
        // applied to the clean checkout. A result that relied on them no longer
        // matches the original text and is rejected by the exact-match apply below.
        const changes = workspaceChanges(repo.workspace_baseline, await workspaceSnapshot(this.git, repo.path, signal))
        const head = await this.git(repo.path, ['rev-parse', 'HEAD'], signal)
        if (changes.length || head !== repo.base_commit) {
          repo.workspace_changes = changes.slice(0, 50)
          await this.git(repo.path, ['checkout', '-q', '--force', '--detach', repo.base_commit], signal)
          await this.git(repo.path, ['reset', '-q', '--hard', repo.base_commit], signal)
          await this.git(repo.path, ['clean', '-q', '-f', '-f', '-d'], signal)
          const remaining = workspaceChanges(repo.workspace_baseline, await workspaceSnapshot(this.git, repo.path, signal)).filter(item => item.change !== 'reverted')
          if (remaining.length || await this.git(repo.path, ['rev-parse', 'HEAD'], signal) !== repo.base_commit) {
            throw serviceError(`${repo.repo_id}：生成期间源码副本被改动且无法恢复（${describeChanges(remaining)}）。生成结果已保存，可“直接复用上次生成结果”在新的干净副本上应用`)
          }
          record.notices.push(`${repo.repo_id}：执行器在生成期间改动了源码副本（${changes.length ? describeChanges(changes) : 'HEAD 被移动'}）。这些改动已丢弃，未混入提交；下面的差异只来自结果文件中登记的修改。`)
          await this.save(directory, record)
        }
      }
      const edits = generated.edits.filter(edit => edit.repo_id === repo.repo_id)
      if (!edits.length) continue
      for (const edit of edits) {
        const attributes = await this.git(repo.path, ['check-attr', '-z', 'filter', '--', edit.path], signal)
        if (attributes.split('\0')[2] === 'lfs') throw serviceError(`本轮打桩不支持修改 LFS 文件：${edit.path}`)
      }
      let files
      try { files = await applyInjectionEdits(repo.path, edits) }
      catch (error) {
        if (record.reused_from && /未唯一匹配|新文件已存在/.test(error.message)) error.message = `复用的结果与当前源码不一致：${error.message}。请用“参考上次结果重新生成”，执行器只需重新定位变化的位置`
        throw error
      }
      await this.git(repo.path, ['add', '--', ...files], signal)
      repo.diff = await this.git(repo.path, ['diff', '--cached', '--no-ext-diff', '--no-textconv'], signal)
      if (!repo.diff) continue
      repo.diff_sha256 = hash(repo.diff)
      repo.files = files
      await this.save(directory, record)
    }
    if (!record.repositories.some(repo => repo.diff)) throw serviceError('本次没有形成代码差异')
    record.generation_complete = true
    delete record.failure_phase
    record.status = 'ready'; record.error = null; await this.save(directory, record)
  }
  async revalidate(dataRoot, runId, taskId) {
    return this.exclusive(dataRoot, runId, taskId, async () => {
      const record = await this.read(dataRoot, runId, taskId), directory = await this.directory(dataRoot, runId, taskId)
      if (activeStates.has(record.status)) throw serviceError('请先停止当前任务')
      if (record.status === 'pushed' || record.repositories?.some(repo => repo.commit)) throw serviceError('该任务已生成提交或推送，无需重新验收')
      if (!Array.isArray(record.repositories) || !record.repositories.length) throw serviceError('该任务尚未完成源码准备，请重新生成')
      const savedFile = await this.resolveSavedResultFile(directory)
      if (!savedFile) throw serviceError('该任务没有已保存的生成结果文件（result.json），请重新生成')
      let generated
      try { generated = JSON.parse(await readFile(savedFile, 'utf8')) }
      catch (error) { throw serviceError(`已保存的生成结果不是合法 JSON：${error.message}`) }
      try {
        await this.applyAndStageResult({ directory, scratchDirectory: path.join(directory, 'generation'), record, generated, signal: new AbortController().signal, isRevalidate: true })
      } catch (error) {
        record.status = 'failed'
        record.generation_complete = false
        record.error = cleanError(error)
        await this.save(directory, record)
        throw error
      }
      return record
    })
  }
  async exclusive(dataRoot, runId, taskId, callback) {
    const key = this.key(dataRoot, runId, taskId)
    if (this.queues.has(key) || this.active.has(key)) throw serviceError('本次打桩操作正在执行', 409)
    const work = Promise.resolve().then(callback); this.queues.set(key, work)
    try { return await work } finally { this.queues.delete(key) }
  }
  async branchExclusive(record, callback, signal, dataRoot) {
    const keys = []
    for (const repo of record.repositories) {
      const common = await this.git(repo.source_path, ['rev-parse', '--git-common-dir'])
      keys.push(path.join(await realpath(path.resolve(repo.source_path, common)), `pangea-injection-${hash(repo.branch).slice(0, 24)}.lock`))
    }
    const releases = []
    try {
      for (const key of [...new Set(keys)].sort()) {
        const previous = this.branchQueues.get(key) || Promise.resolve()
        let release; const gate = new Promise(resolve => { release = resolve })
        const tail = previous.then(() => gate)
        this.branchQueues.set(key, tail)
        releases.push(async () => { release(); if (this.branchQueues.get(key) === tail) this.branchQueues.delete(key) })
        signal?.throwIfAborted()
        let onAbort
        try {
          await Promise.race([previous, new Promise((_, reject) => {
            onAbort = () => reject(signal.reason || new Error('打桩任务已停止'))
            signal?.addEventListener('abort', onAbort, { once: true })
          })])
        } finally { if (onAbort) signal?.removeEventListener('abort', onAbort) }
        signal?.throwIfAborted()
        let handle
        try { handle = await open(key, 'wx') }
        catch (error) {
          if (error.code !== 'EEXIST') throw error
          let owner
          try { owner = JSON.parse(await readFile(key, 'utf8')) } catch {}
          let dead = false
          if (Number.isInteger(owner?.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0) } catch (reason) { dead = reason.code === 'ESRCH' }
          }
          if (!dead) throw serviceError('同一分支正在被另一打桩操作使用，请稍后重试', 409)
          await unlink(key)
          handle = await open(key, 'wx')
        }
        releases.push(async () => { await handle.close(); await unlink(key) })
        await handle.writeFile(JSON.stringify({ pid: process.pid, task: record.id }))
      }
      const ids = [...new Set(record.repositories.map(repo => repo.repo_id))].sort()
      const guarded = (index, inheritedSignal) => index === ids.length ? callback(inheritedSignal) : repositoryOperation(dataRoot, ids[index], operationSignal => guarded(index + 1, operationSignal), { signal: inheritedSignal })
      return await guarded(0, signal)
    } finally { for (const release of releases.reverse()) await release() }
  }
  async push(dataRoot, runId, taskId, { background = false, acknowledged_heads = {}, commit_message, commit_config, precheck_timeout_ms = DEFAULT_REGEX_TIMEOUT_MS } = {}) {
    return this.exclusive(dataRoot, runId, taskId, async () => {
      const record = await this.read(dataRoot, runId, taskId), directory = await this.directory(dataRoot, runId, taskId)
      if (record.schema_version !== 2) throw serviceError('旧任务使用任务分支，请按项目个人分支配置重新生成；本次不会推送旧分支')
      if (record.status === 'pushed') return record
      if (!['ready', 'interrupted'].includes(record.status) || !record.generation_complete) throw serviceError('请先完整生成本次代码修改')
      const savedDefaults = await this.readCommitDefaults(dataRoot)
      const detectedHookRegex = extractRemoteHookRegex(record.error)
        || (/【问题单号|Commit message does not follow|pre-receive hook declined/i.test(record.error || '') ? DEFAULT_INTRANET_COMMIT_REGEX : '')
      let desiredMessage
      if (commit_config && typeof commit_config === 'object') {
        const normalizedConfig = normalizeCommitConfig(commit_config, record.commit_config || savedDefaults)
        if (detectedHookRegex && !normalizedConfig.pattern) normalizedConfig.pattern = detectedHookRegex
        const checked = resolveCommitMessage(normalizedConfig, record, { timeoutMs: precheck_timeout_ms })
        if (!checked.ok) throw serviceError(checked.error)
        desiredMessage = checked.message
        await this.saveCommitDefaults(dataRoot, normalizedConfig)
        record.commit_config = normalizedConfig
      } else if (commit_message !== undefined && commit_message !== null) {
        const baseConfig = normalizeCommitConfig(record.commit_config, savedDefaults)
        const activePattern = detectedHookRegex || (baseConfig.mode === 'default' ? baseConfig.pattern : (baseConfig.pattern || DEFAULT_INTRANET_COMMIT_REGEX))
        const checked = validateRawCommitMessage(String(commit_message), activePattern, { timeoutMs: precheck_timeout_ms })
        if (!checked.ok) throw serviceError(checked.error)
        desiredMessage = checked.message
      } else {
        const effectiveConfig = normalizeCommitConfig(record.commit_config, savedDefaults)
        if (detectedHookRegex && !effectiveConfig.pattern) effectiveConfig.pattern = detectedHookRegex
        if (effectiveConfig.mode === 'default' && !effectiveConfig.custom_message && record.commit_message) {
          effectiveConfig.custom_message = record.commit_message
        }
        const checked = resolveCommitMessage(effectiveConfig, record, { timeoutMs: precheck_timeout_ms })
        if (!checked.ok) throw serviceError(checked.error)
        desiredMessage = checked.message
      }
      const rollbackSourceBranch = async (repo, expectedCommit) => {
        if (!repo.source_head || !expectedCommit || expectedCommit === repo.source_head) return false
        const currentRef = (await this.git(repo.source_path, ['rev-parse', `refs/heads/${repo.branch}`])).trim()
        if (currentRef !== expectedCommit) return false
        const isBare = (await this.git(repo.source_path, ['rev-parse', '--is-bare-repository'])).trim() === 'true'
        if (!isBare) {
          let headRef = ''
          try { headRef = (await this.git(repo.source_path, ['symbolic-ref', '-q', 'HEAD'])).trim() } catch {}
          if (headRef === `refs/heads/${repo.branch}`) {
            await this.git(repo.source_path, ['read-tree', '-u', '-m', expectedCommit, repo.source_head])
          }
        }
        await this.git(repo.source_path, ['update-ref', `refs/heads/${repo.branch}`, repo.source_head, expectedCommit])
        return true
      }
      const controller = new AbortController(), key = this.key(dataRoot, runId, taskId)
      const operation = { controller, done: null, status: 'pushing' }
      record.commit_message = desiredMessage
      record.status = 'pushing'; record.error = null
      this.active.set(key, operation)
      const published = this.save(directory, record)
      operation.done = published.then(() => this.branchExclusive(record, async signal => {
        try {
          // Check all repositories before making the first local commit.
          for (const repo of record.repositories) {
            signal.throwIfAborted()
            if (!repo.diff || repo.pushed) continue
            // A cancellation may arrive after Git has written the commit (or amend)
            // but before its SHA was saved. Recover only this task's exact change.
            if (repo.commit_started && !repo.commit) {
              const head = await this.git(repo.path, ['rev-parse', 'HEAD'], signal)
              if (head !== repo.base_commit) {
                const parent = await this.git(repo.path, ['rev-parse', `${head}^`], signal)
                const body = (await this.git(repo.path, ['log', '-1', '--format=%B', head], signal)).trim()
                const committedDiff = await this.git(repo.path, ['diff', '--no-ext-diff', '--no-textconv', repo.base_commit, head], signal)
                const expectedMessage = (repo.committed_message || desiredMessage).trim()
                if (parent !== repo.base_commit || body !== expectedMessage || hash(committedDiff) !== repo.diff_sha256) throw serviceError(`${repo.repo_id}：中断后提交不匹配，请重新生成`)
                repo.commit = head; await this.save(directory, record)
              }
            } else if (repo.amend_started && repo.commit) {
              const head = await this.git(repo.path, ['rev-parse', 'HEAD'], signal)
              if (head !== repo.commit) {
                const parent = await this.git(repo.path, ['rev-parse', `${head}^`], signal)
                const body = (await this.git(repo.path, ['log', '-1', '--format=%B', head], signal)).trim()
                const committedDiff = await this.git(repo.path, ['diff', '--no-ext-diff', '--no-textconv', repo.base_commit, head], signal)
                const expectedMessage = (repo.committed_message || desiredMessage).trim()
                if (parent !== repo.base_commit || body !== expectedMessage || hash(committedDiff) !== repo.diff_sha256) throw serviceError(`${repo.repo_id}：中断后重写提交不匹配，请重新生成`)
                repo.commit = head
              }
              repo.amend_started = false; await this.save(directory, record)
            }
            const configured = await readRepositorySettings(dataRoot, repo.repo_id)
            const configuredPath = await realpath(configured.git_path || path.join(dataRoot, 'repositories', repo.repo_id))
            if (configuredPath !== repo.source_path) throw serviceError(`${repo.repo_id}：项目源码目录已变更，请重新生成`)
            if (configured.personal_branch !== repo.branch || (configured.remote_branch || configured.personal_branch) !== (repo.remote_branch || repo.branch)) throw serviceError(`${repo.repo_id}：项目个人分支已变更，请重新生成`)
            const forbidden = protectedBranchReason(repo.branch) || protectedBranchReason(repo.remote_branch)
            if (forbidden) throw serviceError(`${repo.repo_id}：${forbidden}；本次不会提交或推送`)
            const remoteUrl = await this.git(repo.source_path, ['remote', 'get-url', '--push', configured.remote || 'origin'], signal)
            if (remoteUrl !== repo.remote_url) throw serviceError(`${repo.repo_id}：推送远端已变更，请重新生成`)
            await this.git(repo.path, ['fetch', '--no-tags', 'origin', `refs/heads/${repo.remote_branch || repo.branch}`], signal)
            const remote = await this.git(repo.path, ['rev-parse', 'FETCH_HEAD'], signal)
            if (repo.commit) {
              let delivered = remote === repo.commit
              if (!delivered) {
                try { delivered = await this.git(repo.path, ['merge-base', repo.commit, remote], signal) === repo.commit }
                catch (error) { signal.throwIfAborted() }
              }
              if (delivered) { repo.pushed = true; repo.push_result = 'confirmed'; await this.save(directory, record); continue }
            }
            const localBefore = await this.git(repo.source_path, ['rev-parse', `refs/heads/${repo.branch}`], signal)
            const priorCommits = Array.isArray(repo.previous_commits) ? repo.previous_commits : []
            if ((repo.commit && localBefore === repo.commit) || priorCommits.includes(localBefore)) {
              await rollbackSourceBranch(repo, localBefore)
              repo.local_applied = false
              await this.save(directory, record)
            }
            const local = await this.git(repo.source_path, ['rev-parse', `refs/heads/${repo.branch}`], signal)
            if (local !== repo.source_head) throw serviceError(`${repo.repo_id}：个人分支已有新提交，请重新生成打桩修改`)
            if (remote !== repo.remote_head) throw serviceError(`${repo.repo_id}：远端分支已更新，请重新生成打桩修改`)
            if (repo.outgoing_count > 0 && acknowledged_heads[repo.repo_id] !== repo.base_commit && !repo.commit) throw serviceError(`${repo.repo_id}：推送将包含个人分支上 ${repo.outgoing_count} 个已有未推送提交，请确认后继续`)
            if (!repo.commit) {
              const head = await this.git(repo.path, ['rev-parse', 'HEAD'], signal)
              const diff = await this.git(repo.path, ['diff', '--cached', '--no-ext-diff', '--no-textconv'], signal)
              const baselineUnstaged = new Set(repo.baseline_unstaged ?? [])
              const unstaged = (await this.git(repo.path, ['diff', '--name-only', '-z'], signal)).split('\0').filter(file => file && !baselineUnstaged.has(file))
              if (head !== repo.base_commit || hash(diff) !== repo.diff_sha256 || unstaged.length) throw serviceError(`${repo.repo_id}：待提交修改已变化，请重新生成`)
            } else {
              const currentMessage = (await this.git(repo.path, ['log', '-1', '--format=%B', repo.commit], signal)).trim()
              if (currentMessage !== desiredMessage) {
                const head = await this.git(repo.path, ['rev-parse', 'HEAD'], signal)
                const parent = await this.git(repo.path, ['rev-parse', `${repo.commit}^`], signal)
                const committedDiff = await this.git(repo.path, ['diff', '--no-ext-diff', '--no-textconv', repo.base_commit, repo.commit], signal)
                const extraStaged = await this.git(repo.path, ['diff', '--cached', '--name-only'], signal)
                if (head !== repo.commit || parent !== repo.base_commit || hash(committedDiff) !== repo.diff_sha256 || extraStaged) {
                  throw serviceError(`${repo.repo_id}：待重写提交状态已变化，请重新生成`)
                }
              }
            }
            const dirty = new Set([
              ...((await this.git(repo.source_path, ['diff', '--name-only', '-z'], signal)).split('\0')),
              ...((await this.git(repo.source_path, ['diff', '--cached', '--name-only', '-z'], signal)).split('\0')),
              ...((await this.git(repo.source_path, ['ls-files', '--others', '--exclude-standard', '-z'], signal)).split('\0')),
            ].filter(Boolean))
            if (repo.files.some(file => dirty.has(file))) throw serviceError(`${repo.repo_id}：本次修改文件存在未提交内容，请先处理后重试`)
          }
          for (const repo of record.repositories) {
            signal.throwIfAborted()
            if (!repo.diff || repo.pushed) continue
            record.current_repository = repo.repo_id; await this.save(directory, record)
            const resolveAuthorArgs = async () => {
              const author = []
              for (const [name, fallback] of [['user.name', 'PANGEA'], ['user.email', 'pangea@localhost']]) {
                try { await this.git(repo.path, ['config', '--get', name], signal) }
                catch (error) { signal.throwIfAborted(); author.push('-c', `${name}=${fallback}`) }
              }
              return author
            }
            if (!repo.commit) {
              repo.commit_started = true; repo.committed_message = desiredMessage; await this.save(directory, record)
              const author = await resolveAuthorArgs()
              await this.git(repo.path, [...author, 'commit', '--no-gpg-sign', '-m', desiredMessage], signal)
              repo.commit = await this.git(repo.path, ['rev-parse', 'HEAD'], signal)
              await this.save(directory, record)
            } else {
              const currentMessage = (await this.git(repo.path, ['log', '-1', '--format=%B', repo.commit], signal)).trim()
              if (currentMessage !== desiredMessage) {
                const oldCommit = repo.commit
                const oldTree = await this.git(repo.path, ['rev-parse', `${oldCommit}^{tree}`], signal)
                repo.previous_commits = [...new Set([...(repo.previous_commits ?? []), oldCommit])].slice(-10)
                repo.amend_started = true; repo.committed_message = desiredMessage; await this.save(directory, record)
                const author = await resolveAuthorArgs()
                await this.git(repo.path, [...author, 'commit', '--amend', '--no-gpg-sign', '-m', desiredMessage], signal)
                const newCommit = await this.git(repo.path, ['rev-parse', 'HEAD'], signal)
                const newTree = await this.git(repo.path, ['rev-parse', `${newCommit}^{tree}`], signal)
                if (newTree !== oldTree) throw serviceError(`${repo.repo_id}：重写提交信息时文件树异常变化，已中止`)
                repo.commit = newCommit; repo.amend_started = false; await this.save(directory, record)
              }
            }
            const local = await this.git(repo.source_path, ['rev-parse', `refs/heads/${repo.branch}`], signal)
            if (local !== repo.commit) {
              if (local === repo.source_head) {
                // Address branch explicitly inside receive-pack so a concurrent checkout
                // cannot write into another branch; if unrelated tracked files are dirty,
                // fall back to two-way read-tree + CAS update-ref (which still rejects dirty target files).
                try {
                  await this.git(repo.path, ['push', `--receive-pack=git -c core.hooksPath=${shellQuote(await disabledHooksPath())} -c receive.denyCurrentBranch=updateInstead receive-pack`,
                    repo.source_path, `${repo.commit}:refs/heads/${repo.branch}`], signal)
                } catch (localPushError) {
                  if (!/Working directory has unstaged changes/i.test(String(localPushError?.message || ''))) throw localPushError
                  await this.git(repo.source_path, ['fetch', '--no-tags', '--', repo.path, repo.commit], signal)
                  const isBare = (await this.git(repo.source_path, ['rev-parse', '--is-bare-repository'], signal)).trim() === 'true'
                  if (!isBare) {
                    let headRef = ''
                    try { headRef = (await this.git(repo.source_path, ['symbolic-ref', '-q', 'HEAD'], signal)).trim() } catch {}
                    if (headRef === `refs/heads/${repo.branch}`) {
                      await this.git(repo.source_path, ['read-tree', '-u', '-m', repo.source_head, repo.commit], signal)
                    }
                  }
                  await this.git(repo.source_path, ['update-ref', `refs/heads/${repo.branch}`, repo.commit, repo.source_head], signal)
                }
              } else {
                throw serviceError(`${repo.repo_id}：个人分支已变化，请重新生成`)
              }
            }
            repo.local_applied = true; await this.save(directory, record)
            // Plain fast-forward push: never create a task ref or force overwrite.
            repo.push_result = 'unconfirmed'; await this.save(directory, record)
            try {
              await this.git(repo.path, ['push', 'origin', `${repo.commit}:refs/heads/${repo.remote_branch || repo.branch}`], signal)
            } catch (pushError) {
              if (isRemotePushRejected(pushError)) {
                let rollbackWarning = ''
                try {
                  const rolledBack = await rollbackSourceBranch(repo, repo.commit)
                  if (rolledBack || (await this.git(repo.source_path, ['rev-parse', `refs/heads/${repo.branch}`])).trim() === repo.source_head) {
                    repo.local_applied = false
                  }
                } catch (rollbackError) {
                  rollbackWarning = `\n本地上游分支回滚失败（请检查 ${repo.source_path} 的 ${repo.branch} 分支）：${cleanError(rollbackError)}`
                }
                repo.push_result = 'rejected'; await this.save(directory, record)
                if (rollbackWarning) throw serviceError(`${cleanError(pushError)}${rollbackWarning}`, pushError.statusCode || 422)
              }
              throw pushError
            }
            repo.pushed = true; repo.push_result = 'confirmed'; await this.save(directory, record)
          }
          record.status = 'pushed'
        } catch (error) { record.status = 'ready'; record.error = (record.repositories.some(repo => !repo.pushed && repo.push_result === 'unconfirmed') ? '推送结果待确认；重试时将先本地校验提交信息合规，再查询远端决定确认或重推。\n' : '') + (controller.signal.aborted ? '提交或推送已停止，已提交内容保留，可重试' : cleanError(error)) }
        await this.save(directory, record)
        return record
      }, controller.signal, dataRoot)).catch(async error => { record.status = 'ready'; record.error = cleanError(error); await this.save(directory, record); return record }).finally(() => this.active.delete(key))
      if (background) operation.done.catch(() => {})
      await published
      return background ? structuredClone(record) : operation.done
    })
  }
  // mode: 'regenerate' (fresh generation), 'reference' (generation starting from
  // this task's saved result) or 'reuse' (apply the saved result; no model call).
  async retry(dataRoot, runId, taskId, cwd, { mode = 'regenerate' } = {}) {
    const previous = await this.read(dataRoot, runId, taskId)
    if (activeStates.has(previous.status)) throw serviceError('请先停止当前任务')
    if (!['regenerate', 'reference', 'reuse'].includes(mode)) throw serviceError('未知重试方式')
    if (mode !== 'regenerate' && !previous.result_saved) throw serviceError('该任务没有已保存的生成结果，请重新生成')
    return this.start({ dataRoot, cwd,
      run: { run_id: runId, analysis_context: previous.analysis_context ?? null, source_snapshot: { repositories: previous.source_repositories.map(repo => ({ repo_id: repo.repo_id })) }, details: { test_cases: previous.cases } },
      input: { case_keys: previous.case_keys, repositories: previous.source_repositories.map(repo => ({ repo_id: repo.repo_id })),
        baseline_acknowledged: previous.baseline_acknowledged, provider_id: previous.provider_id, agent_model: previous.agent_model, instructions: previous.instructions,
        pipeline_url: previous.pipeline_url, name: previous.name,
        ...(previous.commit_config ? { commit_config: previous.commit_config } : {}),
        ...(mode === 'reuse' ? { reuse_task_id: taskId } : mode === 'reference' ? { reference_task_id: taskId, reference_error: previous.error || '' } : {}) } }, { requireReceipt: false })
  }
  async recordVerification(dataRoot, runId, taskId, input) {
    return this.exclusive(dataRoot, runId, taskId, async () => {
      const record = await this.read(dataRoot, runId, taskId)
      if (!record.repositories.some(repo => repo.commit)) throw serviceError('尚未生成可关联的修改提交')
      if (input.build) {
        const { url = '', package_id = '', package_sha256 = '', notes = '' } = input.build
        if (url && !/^https?:\/\//i.test(url)) throw serviceError('构建链接必须是 HTTP/HTTPS 地址')
        record.build = { url: String(url), package_id: String(package_id), package_sha256: String(package_sha256), notes: String(notes),
          commits: record.repositories.filter(repo => repo.commit).map(repo => ({ repo_id: repo.repo_id, commit: repo.commit })) }
      }
      if (input.verification) {
        const value = input.verification
        if (!record.case_keys.includes(value.case_key) || !['not_run', 'passed', 'failed', 'not_triggered'].includes(value.result)) throw serviceError('验证用例或结果无效')
        record.verification.push({ case_key: value.case_key, result: value.result, notes: String(value.notes || ''),
          hits: String(value.hits || ''), build: structuredClone(record.build), at: new Date().toISOString() })
      }
      await this.save(await this.directory(dataRoot, runId, taskId), record)
      return record
    })
  }
  async cancel(dataRoot, runId, taskId) {
    const operation = this.active.get(this.key(dataRoot, runId, taskId))
    if (operation) { operation.controller.abort(new Error('用户停止打桩任务')); await operation.done }
    return this.read(dataRoot, runId, taskId)
  }
  busy() { return this.active.size > 0 || this.queues.size > 0 }
  async dispose() {
    for (const operation of this.active.values()) operation.controller.abort(new Error('打桩任务已停止'))
    await Promise.allSettled([...this.active.values()].map(operation => operation.done))
    await Promise.allSettled(this.queues.values())
  }
}
