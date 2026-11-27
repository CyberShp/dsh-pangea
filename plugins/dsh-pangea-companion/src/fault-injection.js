import { repositoryOperation } from './repositories/operations.js'
import { inspectSource, readRepositorySettings, compareSnapshot, readRemoteDefaultBranch } from './repositories/git-source.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, lstat, writeFile, open, unlink, rm } from 'node:fs/promises'
import path from 'node:path'
import { writeTaskStoreFile } from './task-store.js'
import { caseIdentity } from './case-review-projection.js'
import { caseContentHash } from './case-review-store.js'
import { withGitLongPaths, disabledHooksPath } from './repositories/git-environment.js'
import { protectedBranchReason } from './repositories/branch-policy.js'
import {
  DEFAULT_INTRANET_COMMIT_REGEX, DEFAULT_REGEX_TIMEOUT_MS, extractMarkerStrings, extractRemoteHookRegex,
  normalizeBuildVariant, normalizeCommitConfig, normalizeDeliveryMode, normalizeReplaceFiles,
  resolveCommitMessage, setBacktrackingMatcherRunner, validateRawCommitMessage,
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
const activeStates = new Set(['preparing', 'generating'])
const activeBuildStates = new Set(['composing', 'pushing'])
const hash = value => createHash('sha256').update(value).digest('hex')
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
const serviceError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode })
const inside = (root, file) => { const r = path.relative(root, file); return r && r !== '..' && !r.startsWith(`..${path.sep}`) && !path.isAbsolute(r) }
const cleanError = error => {
  const message = String(error?.stderr || error?.message || error).replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, '$1***@')
  return message.length <= 6000 ? message : `${message.slice(0, 2900)}\n…错误输出过长，中间已省略…\n${message.slice(-2900)}`
}
const formatPersonalBranchBlockMessage = ({ repoId, personalBranch, sourcePath = '', suggestedRef = '', actionLabel = '' }) => {
  const target = suggestedRef ? ` ${suggestedRef}${actionLabel ? ` 后${actionLabel}` : ''}` : `开发分支或目标提交${actionLabel ? `后${actionLabel}` : ''}`
  const command = suggestedRef && sourcePath ? `（可执行：git -C "${sourcePath}" checkout ${suggestedRef}）` : ''
  return `${repoId}：分析目录当前检出的正是个人分支 ${personalBranch}，请先切回${target}${command}`
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

const IS_CMAKE_FILE = /(?:^|\/)CMakeLists\.txt$|\.cmake$/i

// Deterministic lexical check for CMake files: verifies balanced parentheses,
// quoted/bracketed arguments, and the top-level invariant that every command
// invocation has the form `identifier(...)` with no trailing tokens outside `)`.
export function checkCmakeSyntax(text, filePath = 'CMakeLists.txt') {
  const src = String(text ?? '')
  let i = 0, line = 1, depth = 0, openLine = 0
  const len = src.length
  const skipBracket = (startIdx) => {
    if (src[startIdx] !== '[') return -1
    let eq = 0
    let j = startIdx + 1
    while (j < len && src[j] === '=') { eq++; j++ }
    if (src[j] !== '[') return -1
    const closeToken = `]${'='.repeat(eq)}]`
    let pos = j + 1
    while (pos < len) {
      if (src.startsWith(closeToken, pos)) return pos + closeToken.length
      if (src[pos] === '\n') line++
      pos++
    }
    return -2 // unclosed bracket
  }
  while (i < len) {
    const ch = src[i]
    if (ch === '\n') { line++; i++; continue }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\uFEFF') { i++; continue }
    if (ch === '#') {
      if (src[i + 1] === '[') {
        const startLine = line
        const next = skipBracket(i + 1)
        if (next === -2) throw serviceError(`CMake 语法错误（${filePath}:${startLine}）：块注释 #[=[ 未闭合`)
        if (next > 0) { i = next; continue }
      }
      while (i < len && src[i] !== '\n') i++
      continue
    }
    if (depth === 0) {
      const cmdLine = line
      if (!/[A-Za-z_]/.test(ch)) {
        const snippet = src.slice(i, i + 24).split(/\r?\n/)[0]
        throw serviceError(`CMake 语法错误（${filePath}:${cmdLine}）：命令调用外存在非法字符「${snippet}」，请确认新增内容是否误落在闭括号之外`)
      }
      let end = i + 1
      while (end < len && /[A-Za-z0-9_]/.test(src[end])) end++
      const token = src.slice(i, end)
      let look = end
      while (look < len && (src[look] === ' ' || src[look] === '\t')) look++
      if (src[look] !== '(') {
        throw serviceError(`CMake 语法错误（${filePath}:${cmdLine}）：闭括号外存在裸标记「${token}」（缺少紧随的 "("），请将新增参数放入对应命令的括号内部`)
      }
      depth = 1
      openLine = cmdLine
      i = look + 1
      continue
    }
    if (ch === '(') { depth++; i++; continue }
    if (ch === ')') { depth--; i++; continue }
    if (ch === '"') {
      const quoteLine = line
      i++
      let closed = false
      while (i < len) {
        if (src[i] === '\\' && i + 1 < len) {
          if (src[i + 1] === '\n') line++
          i += 2
          continue
        }
        if (src[i] === '\n') line++
        if (src[i] === '"') { closed = true; i++; break }
        i++
      }
      if (!closed) throw serviceError(`CMake 语法错误（${filePath}:${quoteLine}）：双引号字符串未闭合`)
      continue
    }
    if (ch === '[') {
      const prev = i > 0 ? src[i - 1] : ''
      if (!prev || /[\s(]/.test(prev)) {
        const bracketLine = line
        const next = skipBracket(i)
        if (next === -2) throw serviceError(`CMake 语法错误（${filePath}:${bracketLine}）：括号参数 [=[ 未闭合`)
        if (next > 0) { i = next; continue }
      }
    }
    if (ch === '\\' && i + 1 < len) {
      if (src[i + 1] === '\n') line++
      i += 2
      continue
    }
    i++
  }
  if (depth > 0) throw serviceError(`CMake 语法错误（${filePath}:${openLine}）：命令调用左括号未闭合（剩余 ${depth} 层）`)
}

async function readSafeRepoFile(root, name) {
  if (typeof name !== 'string' || !name || /[\\\x00-\x1f:]/.test(name) || path.posix.isAbsolute(name)
    || name.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git')) {
    throw serviceError('修改文件路径必须在所选仓库内')
  }
  const file = path.resolve(root, name)
  if (!inside(root, file)) throw serviceError('修改文件路径越出所选仓库')
  let parent = path.dirname(file)
  while (parent !== root) {
    try {
      if (!(await lstat(parent)).isDirectory() || !inside(root, await realpath(parent))) throw serviceError(`目录越界或不是普通目录：${name}`)
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      parent = path.dirname(parent)
    }
  }
  try {
    if (!(await lstat(file)).isFile() || !inside(root, await realpath(file))) throw serviceError(`仅支持仓库内普通文件：${name}`)
    const bytes = await readFile(file)
    if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) throw serviceError(`文件不是 UTF-8 文本：${name}`)
    return bytes.toString('utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

// The agent supplies the behavior and exact replacement. The host only checks
// file boundaries and matching bytes; it never decides whether a fault is useful.
export async function applyInjectionEdits(repositoryRoot, edits, { dryRun = false } = {}) {
  const root = await realpath(repositoryRoot)
  const staged = new Map()
  for (const edit of edits) {
    const name = edit?.path
    if (!staged.has(name)) {
      staged.set(name, await readSafeRepoFile(root, name))
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
  for (const [name, content] of staged) {
    if (IS_CMAKE_FILE.test(name)) checkCmakeSyntax(content, name)
  }
  if (dryRun) return [...staged.keys()]
  // Validate every replacement before touching any file in this repository.
  for (const [name, content] of staged) { const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, content, 'utf8') }
  return [...staged.keys()]
}

async function cloneIsolatedCheckout(git, workDir, sourcePath, checkout, signal) {
  await rm(checkout, { recursive: true, force: true })
  await mkdir(path.dirname(checkout), { recursive: true })
  try {
    await git(workDir, ['clone', '--shared', '--no-checkout', '--', sourcePath, checkout], signal)
    return
  } catch (error) {
    if (signal?.aborted) throw error
    await rm(checkout, { recursive: true, force: true })
    await mkdir(path.dirname(checkout), { recursive: true })
  }
  await git(workDir, ['clone', '--no-hardlinks', '--no-checkout', '--', sourcePath, checkout], signal)
}

function applyFileEditsToText(filePath, initialText, edits) {
  let current = initialText
  for (const edit of edits) {
    if (edit.before === null) {
      if (current !== null || typeof edit.after !== 'string') throw serviceError(`新文件已存在或内容无效：${filePath}`)
      current = edit.after
    } else {
      if (typeof current !== 'string' || typeof edit.before !== 'string' || !edit.before || typeof edit.after !== 'string') throw serviceError(`替换缺少原文或新内容：${filePath}`)
      const eol = current.includes('\r\n') ? '\r\n' : '\n'
      const before = edit.before.replace(/\r?\n/g, eol), after = edit.after.replace(/\r?\n/g, eol)
      const at = current.indexOf(before)
      if (at < 0 || current.indexOf(before, at + 1) >= 0) throw serviceError(`原文未唯一匹配：${filePath}；请重新生成此修改`)
      current = current.slice(0, at) + after + current.slice(at + before.length)
    }
  }
  return current
}

function extractAddedLines(base, side) {
  let bi = 0
  const added = []
  for (const line of side) {
    if (bi < base.length && line === base[bi]) bi++
    else added.push(line)
  }
  return bi === base.length ? added : null
}

// Resolve pure adjacent-line append conflicts in CMake lists (e.g. two tasks each
// adding a new stub .c entry right before the same closing parenthesis). Uses
// --diff3 output and only resolves when every base line is preserved in exact
// order and every newly inserted line is a plain list entry (never a command call).
function resolveCmakeAppendConflict(conflictText) {
  const eol = conflictText.includes('\r\n') ? '\r\n' : '\n'
  const lines = conflictText.split(/\r?\n/)
  const out = []
  let i = 0
  while (i < lines.length) {
    if (!lines[i].startsWith('<<<<<<<')) { out.push(lines[i++]); continue }
    i++
    const ours = [], base = [], theirs = []
    let section = 'ours', sawBase = false, sawMid = false, sawEnd = false
    while (i < lines.length) {
      if (lines[i].startsWith('|||||||')) { section = 'base'; sawBase = true; i++; continue }
      if (lines[i].startsWith('=======')) { section = 'theirs'; sawMid = true; i++; continue }
      if (lines[i].startsWith('>>>>>>>')) { sawEnd = true; i++; break }
      if (section === 'ours') ours.push(lines[i])
      else if (section === 'base') base.push(lines[i])
      else theirs.push(lines[i])
      i++
    }
    if (!sawBase || !sawMid || !sawEnd || !ours.length || !theirs.length) return null
    const oursAdded = extractAddedLines(base, ours)
    const theirsAdded = extractAddedLines(base, theirs)
    if (!oursAdded || !theirsAdded || !oursAdded.length || !theirsAdded.length) return null
    const isPlainListItem = line => { const t = line.trim(); return t.length > 0 && !/[()#]/.test(t) }
    if (!oursAdded.every(isPlainListItem) || !theirsAdded.every(isPlainListItem)) return null
    const merged = [...ours]
    for (const line of theirsAdded) {
      if (!merged.includes(line)) {
        const closingIdx = base.length ? merged.lastIndexOf(base[base.length - 1]) : -1
        if (closingIdx >= 0) merged.splice(closingIdx, 0, line)
        else merged.push(line)
      }
    }
    out.push(...merged)
  }
  return out.join(eol)
}

async function mergeFileContent(git, checkout, tmpDir, filePath, { baseContent, oursContent, theirsContent }, signal) {
  if (baseContent === null) {
    if (oursContent === null) return theirsContent
    if (oursContent === theirsContent) return oursContent
    throw serviceError(`多任务新增同名文件且内容冲突：${filePath}`)
  }
  if (oursContent === baseContent) return theirsContent
  if (theirsContent === baseContent) return oursContent
  if (oursContent === theirsContent) return oursContent
  await mkdir(tmpDir, { recursive: true })
  const token = randomUUID()
  const scratchFile = path.join(tmpDir, `${token}.merged`)
  const baseFile = path.join(tmpDir, `${token}.base`)
  const theirsFile = path.join(tmpDir, `${token}.theirs`)
  try {
    await writeFile(scratchFile, oursContent, 'utf8')
    await writeFile(baseFile, baseContent, 'utf8')
    await writeFile(theirsFile, theirsContent, 'utf8')
    let cleanMerge = false
    try {
      await git(checkout, ['merge-file', '--diff3', '-L', 'current', '-L', 'base', '-L', 'incoming', scratchFile, baseFile, theirsFile], signal)
      cleanMerge = true
    } catch (error) {
      if (signal?.aborted) throw error
    }
    const mergedText = await readFile(scratchFile, 'utf8')
    if (cleanMerge && !mergedText.includes('<<<<<<<')) {
      if (IS_CMAKE_FILE.test(filePath)) checkCmakeSyntax(mergedText, filePath)
      return mergedText
    }
    if (IS_CMAKE_FILE.test(filePath) && mergedText.includes('<<<<<<<')) {
      const resolved = resolveCmakeAppendConflict(mergedText)
      if (resolved !== null) {
        checkCmakeSyntax(resolved, filePath)
        return resolved
      }
    }
    throw serviceError(`多任务三方合并发生行级冲突：${filePath}；请调整所选任务组合或合并后重新生成`)
  } finally {
    await Promise.all([scratchFile, baseFile, theirsFile].map(f => rm(f, { force: true }).catch(() => {})))
  }
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
const DIAG_DIR_NAME = /^(?:diag(?:nose|nostics?)?|dbg|debug|cli|cmds?|dfx|maint|pgd)$/i
const DIAG_FILE_NAME = /(?:^|[_-])(?:diag(?:nose)?|dbg|debug|cli|cmd|dfx|pgd)(?:[_.-]|\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)$)/i
const DIAG_HOOK_LINE = /^\s*(?!\/\/|\/\*|\*|#\s*include\b).*\b(?:\w*(?:diagnose|diag_cmd|dbg_cmd|debug_cmd|pgd_cmd)\w*\s*(?:\(|\[|=)|(?:DIAG|DBG|CLI|PGD)_[A-Z0-9_]*(?:CMD|REG)[A-Z0-9_]*\s*\(|\w*(?:reg|register)_[A-Za-z0-9_]*(?:diag|dbg|cmd|cli|pgd)\w*\s*\()/i
const INLINE_REPO_LOC = /(?<![A-Za-z0-9_./-])(?:[A-Za-z0-9_.-]+:)?[A-Za-z0-9_./-]+\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx)(?::\d+(?:-\d+)?)?/g

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
      if (!pt?.repo_id || pt.repo_id === repoId) {
        add(pt?.path)
        addSym(pt?.symbol)
        for (const hint of [pt?.enable, pt?.trigger, pt?.disable]) {
          if (typeof hint !== 'string') continue
          for (const m of hint.matchAll(INLINE_REPO_LOC)) add(m[0])
        }
      }
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
  const moduleFiles = [], conditionalMacros = [], diagnoseHooks = [], diagnoseSnippets = [], cmakeRules = [], testDirectories = [], targetSnippets = [], existingSymbolTests = []
  let sampleTestSnippet = null
  const targetSymbols = new Set((Array.isArray(hintSymbols) ? hintSymbols : []).map(extractCleanSymbol).filter(Boolean))
  const seenMacroLocs = new Set(), seenDiagLocs = new Set(), candidateDirs = new Set(['.']), moduleDirs = new Set(), diagParentDirs = new Set()
  for (const rel of targetPaths.slice(0, 8)) {
    let dir = path.posix.dirname(rel)
    if (dir && dir !== '.') moduleDirs.add(dir)
    let hops = 0
    while (dir && dir !== '.') {
      candidateDirs.add(dir)
      if (hops < 3) diagParentDirs.add(dir)
      hops += 1
      const parent = path.posix.dirname(dir)
      dir = parent === dir ? '.' : parent
    }
    if (hops <= 2) diagParentDirs.add('.')
  }
  const moduleSourceTexts = [], diagExtraTexts = [], loadedRels = new Set()
  const pushText = (list, rel, text) => {
    if (!text || loadedRels.has(rel)) return
    loadedRels.add(rel)
    list.push({ rel, text })
  }
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
            const rel = `${incRel}/${entry.name}`
            pushText(moduleSourceTexts, rel, await readBoundedText(root, rel))
          }
        }
      } catch {}
    }
    for (const name of files.slice(0, 16)) {
      const rel = `${dir}/${name}`
      pushText(moduleSourceTexts, rel, await readBoundedText(root, rel))
    }
  }
  for (const rel of targetPaths.slice(0, 8)) {
    if (!loadedRels.has(rel)) {
      const text = await readBoundedText(root, rel)
      if (text) { loadedRels.add(rel); moduleSourceTexts.unshift({ rel, text }) }
    }
  }
  // Probe module-ancestor and sibling diag/dbg/cli/dfx/pgd directories so diagnose command shells
  // living outside target `src/` (e.g. `mod/dbg/`, `mod/diagnose/`, `mod/cli/`) are fed directly.
  const seenDiagSubdirs = new Set()
  for (const pDir of [...diagParentDirs].slice(0, 6)) {
    const fullPDir = pDir === '.' ? root : path.resolve(root, pDir)
    if (pDir !== '.' && !inside(root, fullPDir)) continue
    let entries = []
    try { entries = await readdir(fullPDir, { withFileTypes: true }) } catch { continue }
    for (const entry of entries.filter(e => e.isFile() && SOURCE_EXT.test(e.name) && DIAG_FILE_NAME.test(e.name)).slice(0, 8)) {
      const rel = pDir === '.' ? entry.name : `${pDir}/${entry.name}`
      pushText(diagExtraTexts, rel, await readBoundedText(root, rel))
    }
    for (const sub of entries.filter(e => e.isDirectory() && !e.name.startsWith('.') && DIAG_DIR_NAME.test(e.name))) {
      if (seenDiagSubdirs.size >= 6) break
      const subRel = pDir === '.' ? sub.name : `${pDir}/${sub.name}`
      if (seenDiagSubdirs.has(subRel)) continue
      seenDiagSubdirs.add(subRel)
      const fullSub = path.resolve(root, subRel)
      if (!inside(root, fullSub)) continue
      let subEntries = []
      try { subEntries = await readdir(fullSub, { withFileTypes: true }) } catch { continue }
      for (const f of subEntries.filter(e => e.isFile() && SOURCE_EXT.test(e.name)).map(e => e.name).sort().slice(0, 10)) {
        const rel = `${subRel}/${f}`
        pushText(diagExtraTexts, rel, await readBoundedText(root, rel))
      }
    }
  }
  let snippetLinesBudget = 140
  for (const rel of targetPaths.slice(0, 4)) {
    const found = moduleSourceTexts.find(item => item.rel === rel) || diagExtraTexts.find(item => item.rel === rel)
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
  const diagLinesByRel = new Map()
  for (const { rel, text } of moduleSourceTexts) {
    const lines = text.split(/\r?\n/)
    let blockRemaining = 0
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index]
      if (diagnoseHooks.length < 16 && DIAG_HOOK_LINE.test(line)) {
        const dLoc = `${rel}:${index + 1}`
        if (!seenDiagLocs.has(dLoc)) {
          seenDiagLocs.add(dLoc)
          diagnoseHooks.push({ location: dLoc, code: line.trim().slice(0, 180) })
          if (!diagLinesByRel.has(rel)) diagLinesByRel.set(rel, { lines, hits: [] })
          diagLinesByRel.get(rel).hits.push([index + 1, index + 1])
        }
      }
      if (conditionalMacros.length >= 32) continue
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
  for (const { rel, text } of diagExtraTexts) {
    if (diagnoseHooks.length >= 16) break
    const lines = text.split(/\r?\n/)
    for (let index = 0; index < lines.length && diagnoseHooks.length < 16; index++) {
      const line = lines[index]
      if (!DIAG_HOOK_LINE.test(line)) continue
      const dLoc = `${rel}:${index + 1}`
      if (seenDiagLocs.has(dLoc)) continue
      seenDiagLocs.add(dLoc)
      diagnoseHooks.push({ location: dLoc, code: line.trim().slice(0, 180) })
      if (!diagLinesByRel.has(rel)) diagLinesByRel.set(rel, { lines, hits: [] })
      diagLinesByRel.get(rel).hits.push([index + 1, index + 1])
    }
  }
  // Slice ~20-line windows around matched diagnose/pgd registrations so the model sees callback
  // signatures, command table structs, and registration macros without extra read tool calls.
  let diagBudget = 66
  for (const [rel, { lines, hits }] of diagLinesByRel) {
    if (diagBudget <= 0 || diagnoseSnippets.length >= 3) break
    const windows = mergeLineWindows(hits, lines.length, 14, 8)
    for (const [start, rawEnd] of windows) {
      if (diagBudget <= 0 || diagnoseSnippets.length >= 3) break
      const end = Math.min(rawEnd, start + diagBudget - 1, start + 25)
      const numbered = lines.slice(start - 1, end).map((line, idx) => `${start + idx}: ${line.slice(0, 220)}`).join('\n')
      diagnoseSnippets.push({ path: rel, start_line: start, end_line: end, total_lines: lines.length, content: numbered })
      diagBudget -= (end - start + 1)
    }
  }
  // Discover nearby build rules and test subtrees along the ancestor chain without full-repo traversal.
  const queue = [...candidateDirs]
  const visitedDirs = new Set()
  const nearbyTestTexts = []
  const buildTargets = []
  const seenTargets = new Set()
  const addBuildTarget = item => {
    if (buildTargets.length >= 24) return
    const key = `${item.file}:${item.target}:${item.kind}`
    if (seenTargets.has(key)) return
    seenTargets.add(key)
    buildTargets.push(item)
  }
  while (queue.length && visitedDirs.size < 60) {
    const relDir = queue.shift()
    if (visitedDirs.has(relDir)) continue
    visitedDirs.add(relDir)
    const fullDir = relDir === '.' ? root : path.resolve(root, relDir)
    if (relDir !== '.' && !inside(root, fullDir)) continue
    let entries = []
    try { entries = await readdir(fullDir, { withFileTypes: true }) } catch { continue }
    const fileNames = entries.filter(e => e.isFile()).map(e => e.name).sort()
    const inTestDir = relDir.split('/').some(part => TEST_DIR_NAME.test(part))
    if (fileNames.includes('CMakeLists.txt') && cmakeRules.length < 16) {
      const cmakeRel = relDir === '.' ? 'CMakeLists.txt' : `${relDir}/CMakeLists.txt`
      const cmakeText = await readBoundedText(root, cmakeRel)
      if (cmakeText) {
        const hasGlob = /\bfile\s*\(\s*GLOB(?:_RECURSE)?\b/i.test(cmakeText)
        const configureDepends = hasGlob && /\bfile\s*\(\s*GLOB(?:_RECURSE)?[\s\S]{0,240}?CONFIGURE_DEPENDS\b/i.test(cmakeText)
        const hasAux = /\baux_source_directory\s*\(/i.test(cmakeText)
        const hasTarget = /\badd_(?:executable|library)\s*\(/i.test(cmakeText)
        const defs = new Set()
        const conditionalDefs = new Set()
        const cmakeLines = cmakeText.split(/\r?\n/)
        let ifDepth = 0
        const outputNames = new Map()
        for (let idx = 0; idx < cmakeLines.length; idx++) {
          const rawLine = cmakeLines[idx]
          const trimmed = rawLine.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          if (/^\s*if\s*\(/i.test(rawLine)) ifDepth++
          else if (/^\s*endif\s*\(/i.test(rawLine)) ifDepth = Math.max(0, ifDepth - 1)
          for (const match of rawLine.matchAll(FAULT_DEF_TOKEN)) {
            defs.add(match[1])
            if (inTestDir || ifDepth > 0 || rawLine.includes('$<')) conditionalDefs.add(match[1])
          }
          const libMatch = rawLine.match(/\badd_library\s*\(\s*([A-Za-z0-9_.-]+)(?:\s+(STATIC|SHARED|MODULE|OBJECT|INTERFACE))?/i)
          if (libMatch && !inTestDir) {
            const mode = (libMatch[2] || '').toUpperCase()
            addBuildTarget({
              file: cmakeRel,
              line: idx + 1,
              kind: mode === 'SHARED' ? 'shared_lib' : mode === 'OBJECT' ? 'object_lib' : mode === 'MODULE' ? 'shared_lib' : 'static_lib',
              target: libMatch[1],
            })
          }
          const exeMatch = rawLine.match(/\badd_executable\s*\(\s*([A-Za-z0-9_.-]+)/i)
          if (exeMatch && !inTestDir) {
            addBuildTarget({ file: cmakeRel, line: idx + 1, kind: 'executable', target: exeMatch[1] })
          }
          const outMatch = rawLine.match(/\bset_target_properties\s*\(\s*([A-Za-z0-9_.-]+)[\s\S]*?\bOUTPUT_NAME\s+"?([A-Za-z0-9_.-]+)"?/i)
          if (outMatch) outputNames.set(outMatch[1], outMatch[2])
        }
        for (const item of buildTargets) {
          if (item.file === cmakeRel && outputNames.has(item.target)) item.output_name = outputNames.get(item.target)
        }
        cmakeRules.push({
          path: cmakeRel,
          directory: relDir,
          source_collection: hasGlob ? 'file_glob' : hasAux ? 'aux_source_directory' : hasTarget ? 'explicit_list' : 'other',
          ...(hasGlob ? { configure_depends: configureDepends } : {}),
          ctest_or_gtest: /\b(?:enable_testing|add_test|gtest_discover_tests|GTest|gtest)\b/i.test(cmakeText),
          ...(defs.size ? { fault_definitions: [...defs] } : {}),
          ...(conditionalDefs.size ? { conditional_fault_definitions: [...conditionalDefs] } : {}),
        })
      }
    }
    if (!inTestDir && buildTargets.length < 24) {
      for (const mkName of ['Makefile', 'Kbuild', 'GNUmakefile']) {
        if (!fileNames.includes(mkName)) continue
        const mkRel = relDir === '.' ? mkName : `${relDir}/${mkName}`
        const mkText = await readBoundedText(root, mkRel, 65536)
        if (!mkText) continue
        const mkLines = mkText.split(/\r?\n/)
        for (let idx = 0; idx < mkLines.length && buildTargets.length < 24; idx++) {
          const line = mkLines[idx]
          if (!line || /^\s*#/.test(line)) continue
          const koMatch = line.match(/^\s*obj-[my]\s*[:+]?=\s*([A-Za-z0-9_.-]+)\.o\b/)
          if (koMatch) addBuildTarget({ file: mkRel, line: idx + 1, kind: 'kernel_module', target: `${koMatch[1]}.ko` })
          const libMatch = line.match(/\b(lib[A-Za-z0-9_.-]+\.(?:a|so(?:\.\d+)*))\b/)
          if (libMatch) addBuildTarget({ file: mkRel, line: idx + 1, kind: libMatch[1].endsWith('.a') ? 'static_lib' : 'shared_lib', target: libMatch[1] })
        }
      }
    }
    if (!inTestDir && buildTargets.length < 24) {
      for (const pyMeta of ['pyproject.toml', 'setup.py', 'pytest.ini', 'conftest.py']) {
        if (fileNames.includes(pyMeta)) {
          addBuildTarget({ file: relDir === '.' ? pyMeta : `${relDir}/${pyMeta}`, line: 1, kind: 'python_project', target: pyMeta })
        }
      }
    }
    const testFiles = fileNames.filter(name => TEST_FILE_NAME.test(name) || (TEST_DIR_NAME.test(path.posix.basename(relDir)) && /\.(?:c|cc|cpp|cxx|py|sh)$/i.test(name)))
    if (testFiles.length && testDirectories.length < 10) {
      const sampleRel = relDir === '.' ? testFiles[0] : `${relDir}/${testFiles[0]}`
      const sampleText = await readBoundedText(root, sampleRel, 65536)
      const isGtest = Boolean(sampleText && /\bgtest\b|TEST(?:_F|_P)?\s*\(/.test(sampleText))
      const isPytest = sampleRel.endsWith('.py') && Boolean(sampleText && /\bpytest\b|def\s+test_/.test(sampleText))
      const isShell = /\.(?:sh|bash)$/i.test(sampleRel)
      testDirectories.push({
        directory: relDir,
        framework: isGtest ? 'gtest' : isPytest ? 'pytest' : isShell ? 'shell' : 'native',
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
  const conditionalFaultSet = new Set()
  for (const rule of cmakeRules) {
    for (const macro of rule.fault_definitions ?? []) {
      if (!allFaultDefs.has(macro)) allFaultDefs.set(macro, [])
      allFaultDefs.get(macro).push(rule.path)
    }
    for (const macro of rule.conditional_fault_definitions ?? []) conditionalFaultSet.add(macro)
  }
  const faultMacros = [...allFaultDefs.entries()].map(([name, definedIn]) => {
    const token = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
    const usageCount = moduleSourceTexts.filter(item => token.test(item.text)).length
    return {
      name,
      defined_in: definedIn,
      module_usage_count: usageCount,
      conditional_or_test: conditionalFaultSet.has(name),
    }
  })
  if (!moduleFiles.length && !conditionalMacros.length && !diagnoseHooks.length && !diagnoseSnippets.length && !cmakeRules.length && !testDirectories.length && !faultMacros.length && !targetSnippets.length && !existingSymbolTests.length && !buildTargets.length) return null
  return {
    ...(targetPaths.length ? { target_files: targetPaths.slice(0, 8) } : {}),
    ...(targetSnippets.length ? { target_snippets: targetSnippets } : {}),
    ...(moduleFiles.length ? { module_files: moduleFiles } : {}),
    ...(conditionalMacros.length ? { conditional_macros: conditionalMacros } : {}),
    ...(diagnoseHooks.length ? { diagnose_hooks: diagnoseHooks } : {}),
    ...(diagnoseSnippets.length ? { diagnose_snippets: diagnoseSnippets } : {}),
    ...(buildTargets.length ? { build_targets: buildTargets } : {}),
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
    delivery_mode: normalizeDeliveryMode(record.delivery_mode),
    build_variant: normalizeBuildVariant(record.build_variant),
    instructions: record.instructions || '',
    analysis_source: analysisSource,
    ...(record.analysis_context ? { analysis_context: record.analysis_context } : {}),
    repositories: record.repositories.map(repo => ({
      repo_id: repo.repo_id, path: repo.path, base_commit: repo.base_commit,
      ...(repo.base_branch ? { base_branch: repo.base_branch } : {}),
      analysis_commit: repo.analysis_commit ?? null,
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
  const deliveryMode = normalizeDeliveryMode(record?.delivery_mode)
  const buildVariant = normalizeBuildVariant(record?.build_variant)
  const modeGuidance = deliveryMode === 'unit_test'
    ? '当前交付形态为 unit_test（仓内单元测试 / GTest）：若 repositories[].harness 给出了 C/C++ 单元测试环境（test_directories 含 gtest/native 或 cmake_rules/fault_macros）：① 若 fault_macros 显示某测试编译宏（如 -D*_SIMU_FAULT）的 module_usage_count=0，说明当前模块无现成注入消费点，直接在目标函数对应的 #ifdef <测试宏> 保护下植入默认关闭的最小控制桩，不要全仓搜寻既有框架；② 按 Option A 在 test_directories 配套新增（before=null）或补充 gtest 用例文件，在同一测试目标内依次覆盖“桩默认关闭正常路径 → 启用桩命中目标超时/错误分支 → 复位后恢复正常”，同进程测试优先通过受控开关函数/原子计数或环境变量触发，阻塞等待必须有界且时长直接复用源码超时宏或兼容 harness.conditional_macros 中的 ASAN/非 ASAN 阈值（严禁写死小于 ASAN 超时阈值的短常数）；③ 若对应 cmake_rules 为 file_glob，无需修改构建文件，若 configure_depends=false 则在 steps 中先执行 cmake 重新生成以纳入新测试文件，运行 gtest 时指定 --gtest_filter 并校验实际执行用例数 >= 1（防止匹配 0 条用例时仍返回 0）。'
    : `当前交付形态为 product_package（个人分支出产品大包同源构建并部署验证，目标部署变体：${buildVariant === 'hitest' ? 'hitest 精准' : '正常 debug'}）：① 严禁把业务桩代码包在产品构建默认未定义的条件/测试编译宏（如 harness.fault_macros 中 conditional_or_test=true 的宏、*_SIMU_FAULT、LLT/UT 专属开关）内，避免产品配置出包时桩被编译期整体剔除；桩代码必须无条件参与目标组件常规编译（保证同一份源码在正常 debug 与 hitest 精准构建下均可编入组件库与宿主二进制），且运行期必须默认关闭（零副作用），严禁写死参数导致每次进程启动必然触发故障；② 按触发时机选择门控形态（平台实测约束 L1：平台 init 守护拉起 C/C++ 宿主进程时不传递环境变量，除非用户明确说明目标进程可注入环境，否则严禁以 getenv() 作为唯一触发通道）：若桩点位于【稳态运行期路径】（连接/IO/管理命令/周期任务），优先直接复用 repositories[].harness.diagnose_snippets / diagnose_hooks 中预提取的模块诊断命令回调函数签名与注册宏壳子（如 diagnose/pgd），在进程内参数化控制开关、步骤号、时长与剩余次数（命中原子递减至 0 自动恢复，无需重启进程）；若桩点位于【进程启动/模块初始化路径】（不重启走不到初始化，重启进程又会使纯内存开关归零），采用“一次性自毁控制文件（如 /dev/shm/<唯一桩标记> 或 /tmp/<唯一桩标记>，桩读到参数后立即 unlink/remove 删除文件再注入故障）”门控（模块有 diagnose/pgd 注册入口时可同时提供子命令写入/清理该文件，也可由测试命令直接写入），实现“默认无文件正常初始化 → 写文件后单次重拉宿主进程命中故障并自毁文件 → 再次重拉自动恢复正常”；③ 遵守平台持久化与守护拉起约束（L2）：平台节点重启会从部署包镜像恢复运行时文件（手工替换/盒上重链在节点重启后还原，持久化走大包）；宿主进程必须由平台守护拉起（脱离守护手工直接执行宿主二进制会因缺少运行时库路径即刻失败，严禁在 steps/cleanup 中直接运行宿主二进制）；初始化路径需要重拉宿主进程时，先落盘单次自毁控制文件，再通过平台服务重启命令或单次终止当前宿主进程由平台守护自动重拉（约秒级拉起新进程，核验新 PID 与命中日志，禁止无界循环强杀）；④ 不要无故修改单元测试目录（test/ut/llt）或单测 CMakeLists.txt；若业务组件 CMakeLists.txt 将正常 debug 与 hitest 拆分为多个 target 且新增源文件/定义，须同步接入两侧 target；结合 repositories[].harness.build_targets，在 delivery.replace_files 中逐项列明修改源码归属的组件库/模块产物名（用于构建后核验组件库与大包宿主二进制同源带桩，以及可选临时单文件快验），严禁编造库名。`
  return [
    '你正在执行独立的 PANGEA 用例打桩代码生成任务。不要创建分析 Run，也不要调用 Graph bind/settle/work-finish。',
    inlined
      ? `任务输入 JSON 已直接内联在本文末 <task_input_json> 中（无需首轮再调用 read 读取 ${posixInput}；若后续发生上下文压缩丢失细节，可重新读取 ${posixInput}）。其中 cases 是已选用例，analysis_context 是关联风险/覆盖率缺口/流程证据，repositories 含源码副本及宿主预扫描的 harness 事实。输入中 {"$same_as": "<路径>"} 表示该处内容与所指路径（$ 为输入根）的值完全相同，已去重以缩短输入。`
      : `先读取任务输入 JSON：${posixInput}。其中 cases 是已选用例，analysis_context 是关联风险/覆盖率缺口/流程证据，repositories 含本次独立源码副本、固定提交及宿主预扫描的 harness 事实。输入中 {"$same_as": "<路径>"} 表示该处内容与所指路径（$ 为输入根）的值完全相同，已去重以缩短输入。`,
    '宿主已确认的事实，无需再用工具探测：源码副本是宿主刚检出的干净固定提交（不必运行 git status/log 确认）；宿主写入 edits 时按每个文件现有的 CRLF/LF 风格换行，before/after 用 \\n 即可，不必检查换行符；Git、构建与推送均由宿主完成。',
    ...(posixRef ? [`参考结果：${posixRef} 是本任务上一次生成的完整结果 JSON。优先复用其中仍然成立的桩点设计、profiles 与 edits，只针对当前源码重新定位 before 原文并修正失效或被指出的问题；不要从零重新调查。与当前源码冲突时以源码为准。${referenceError ? `上一次未完成的原因：${referenceError}` : ''}`] : []),
    '探索步数预算严格受限（<= 10 次只读工具调用）：repositories[].harness.target_snippets 已预附带目标源码区间的带行号原文，diagnose_snippets 与 diagnose_hooks 已自动扫描同模块及邻近 diag/dbg/cli/dfx/pgd 目录并附带完整回调函数签名与注册宏样板，build_targets 已预附带组件构建目标线索，sample_test_snippet 与 existing_symbol_tests 已预附带同目录测试头部样板及目标函数既有测试调用定位；若预切片上下文已足够唯一定位 edits[].before 与构建归属，无需重复 read 同一文件，仅按需补读缺失头文件或调用点后旋即构造并落盘输出 JSON；禁止用 bash 执行 ls/find 遍历目录，禁止研究全仓构建脚本。',
    modeGuidance,
    '只在这些仓库内调查需要的实现与既有调测入口。核对所选用例引用的 analysis_source 冻结片段与本次源码副本，分析基线与本次基线不同则重新定位；只比较相关位置，差异对注入方案的影响写入 summary，不重做全仓分析。',
    '不要修改或推送源码仓库，不运行构建或安装命令。唯一交付是下述 JSON 文件；宿主负责精确写入、提交和推送。',
    '源码副本是只读输入，包括拟新增文件的位置：禁止用 write/edit/apply_patch 或 shell 直接在 repositories 中创建或修改文件，也不要先写源文件再把它读回生成 edits。新增模块的完整源码放进 edits[].after 字符串，before=null；已有文件修改用 before/after 字符串描述。',
    '防单步超长输出截断与定界符越界：edits[].before 只截取当前文件中唯一匹配的最短 1~5 行原文，严禁整函数大段复制；修改 CMakeLists.txt、函数参数或初始化列表时，before 必须包含闭合定界符 `)`/`}` 并在定界符内部插入新项，严禁对以 `)`/`}` 结尾的行做行后追加（宿主会对修改的 CMake 文件执行确定性词法语法检查）；不要在思考或回复正文中预先默写整份源码或完整 JSON。可直接用 write 工具写入目标 JSON，或在输出文件的父目录写简短脚本生成目标 JSON。交付前确认输出文件存在、JSON 可解析且 edits 非空，然后立即结束；聊天里的代码块不能代替磁盘交付。',
    '若目标源码为 Python（.py）或 Shell（.sh/.bash）脚本：运行期优先通过环境变量（如 os.environ.get("PANGEA_FI") 或 ${PANGEA_FI:-}）控制故障触发并默认关闭，delivery.artifact_verify 可使用 python3 -m py_compile <脚本> / bash -n <脚本> 或 grep -Fq "<marker>" <脚本> 校验。',
    '本任务不搭建模拟 HTTP/数据库/容器栈，不启动后台服务，不执行 profiles 中的部署或业务操作。自检限定为 JSON 合同、原文替换唯一性及源码语法；真实构建与端到端实测由宿主后续执行，不能把模拟结果写成实测结论。',
    '先完成调用路径与副作用判断，再生成实际可编译的修改。故障注入制造原因，保留原有错误处理和恢复逻辑，不直接篡改预期结果。',
    '同包多个桩默认关闭，具有独立启停方式。限定目标对象/调用阶段/次数，记录实际命中，次数配置为零或负数时明确禁用。凡在 points[].times 或自述中声明有限触发次数（如 times=1 / “命中后消耗一次”），内存态开关必须在命中时原子递减（fetch_sub / --），文件门控必须在命中时立即 unlink/remove 消费或改写剩余次数（注意 getenv() 返回只读环境变量不会自行递减）；若实现为常驻开关依赖外部手动关闭，则 times 与自述须如实写明持续生效，严禁自述“消耗一次”而实现只读不减。优先复用真实已有 diagnose/调测入口；没有时实现符合项目语言与平台约束的最小受控入口，并把必要源文件/构建接入一起纳入 edits。',
    '逐用例说明按真实执行顺序组织：关闭全部桩验证正常基线 → 启用目标桩执行并检查实际命中及故障后状态 → 关闭桩或耗尽次数后验证恢复（若开关仅启动时读取则写明写入单次自毁控制文件与单次重拉顺序；分轮/组合桩写明触发顺序，基线准备不得提前消耗一次性桩）。同一分支上已有兼容桩点须复用；不能落地的部分写入 limitations，不能编造命令或宣称已编译/实测。',
    '逐步核对观测断言：不得断言目录只剩业务文件；时间戳考虑实际精度并结合内容/计数验证恢复；区分命令退出码与业务返回值。',
    '安全合同 v2（包括参考旧结果和复用结果）：每个 points 元素增加 trigger_scope:{current_input:string,excluded_inputs:[string]}，明确真实调用链上当前请求/当前操作的来源与匹配表达式。禁止用完整 SQL 参数、序列化历史、日志或持久化上下文的全文匹配代替当前输入；历史里含标记而当前输入不含时不得命中、不得消耗次数。不能可靠隔离当前输入时停止该方案，不能扩大命中范围。',
    '每个 profile 增加 safety:{setup:[string],negative_steps:[string],negative_point_ids:[id],cleanup:[string],cleanup_verify:[string]}。这些数组均须非空、可执行，negative_point_ids 覆盖本 profile 全部桩点。setup 先保存原控制状态（包括文件原本不存在及原始字节）和本轮独占资源标识；negative_steps 在全新未消耗的次数预算下验证非目标历史/上下文不触发、计数不变，然后 steps 验证目标确实命中、重试和撤桩恢复。不要通过先耗尽次数制造负向通过。',
    '宿主按 setup → negative_steps → steps 顺序执行，并在同一 profile 的独立 shell 中安装 EXIT/INT/TERM 清理。cleanup 必须独立幂等、容忍 setup 只执行一部分和未定义变量，恢复原控制状态、只清理本轮创建且确属本轮的测试数据/服务；cleanup_verify 独立验证精确恢复与资源清理。不要覆盖宿主 trap、使用 exec 替换宿主或在后台留下未等待的业务命令；Python/其他子进程也须以 try/finally 处理自身资源。清理所需状态不可只存于已退出的子进程内存。保留证据日志；SIGKILL/断电等不可捕获退出明确列入 limitations。',
    '资源清理必须覆盖本轮登录创建的认证会话/令牌，而不只是 HTTP 连接与业务数据；在 finally/cleanup 撤销或删除仅本轮拥有的认证会话，并独立查询确认不再有效。创建远端业务对象前先持久化本轮唯一 ID/所有权凭据，成功响应到达后先登记资源再做结果断言，以便请求已成功但断言失败/超时也能回收；禁止按用户或时间范围批量删除不属于本轮的数据。含认证信息的状态文件须限制访问且不得写进证据日志。',
    '清理不能把快照损坏/丢失等同于原状态不存在；原本存在而备份缺失时必须保留现状并报错，不得擅自删除控制文件或宣称恢复成功。清理某资源失败后仍应尝试其它资源，最终汇总失败并非零退出；验证不能吞错。',
    '恢复备份必须验证完整性：用明确存在标记、严格类型与严格解码（Python base64.b64decode(..., validate=True)），必要时核对原字节哈希。备份缺失或解码损坏不能跳过检查后打印成功，也不能把非法编码宽松解码成空字节并覆盖现状；无法证明原状态时清理与独立核验均须非零。每项资源恢复使用独立异常边界，读取/解码/写入控制备份失败仍须继续撤销本轮认证资源与清理业务数据，最后汇总失败。',
    '空文件（零字节/空 base64 字符串）是合法的原始快照，必须与字段不存在、备份损坏分开判定，不能用字符串 truthiness 判断备份是否存在。覆盖正常存在、原本不存在、原本为空三种恢复基线。登录等资源分配调用前持久化本轮唯一所有权标识；获得凭据后立即落盘，先于任何后续身份探测或断言。后续探测失败或调用结果未知时，也要能按本轮唯一标识回收并核验；不能把“尚未登记 token”当作“未创建会话”而报告成功。',
    '核对运行时库的真实数据形状：数据库驱动默认 tuple 行不能直接 dict(row)，需显式字典行工厂或按列名转换；不能仅凭语法检查推断运行成功。控制开关与次数必须严格校验类型，字符串 false 等非布尔值不能因 truthy 被当作启用；异常或不完整控制数据默认禁用。',
    '交付契约 v3：顶层必须包含 delivery:{mode:"product_package"|"unit_test", build_requirement:string, replace_files:[{artifact:string, kind:"static_lib"|"shared_lib"|"kernel_module"|"executable"|"script"|"other", source_files:[string], build_evidence:string, post_replace_action:string}], marker_strings:[string], artifact_verify:[string]}。其中 marker_strings 为编入目标产物的唯一字面量（如命中日志标识、diagnose 子命令名或控制文件名），必须逐字出现在 edits[].after 中；replace_files 必须覆盖本次修改的全部业务源码文件。',
    'JSON 结构：{summary:string, delivery:{mode,build_requirement,replace_files:[{artifact,kind,source_files:[string],build_evidence,post_replace_action}],marker_strings:[string],artifact_verify:[string]}, points:[{id,case_keys:[string],repo_id,path,symbol,action,trigger,trigger_scope:{current_input:string,excluded_inputs:[string]},times,enable,disable,observe,cleanup,depends_on:[id],exclusive_with:[id]}], profiles:[{case_key,point_ids:[id],safety:{setup:[string],negative_steps:[string],negative_point_ids:[id],cleanup:[string],cleanup_verify:[string]},steps:[string]}], edits:[{repo_id,path,before:string|null,after:string}], limitations:[string]}。',
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
  if (value.delivery && typeof value.delivery === 'object') {
    if (Array.isArray(value.delivery.marker_strings)) {
      value.delivery.marker_strings = [...new Set(value.delivery.marker_strings.map(item => typeof item === 'string' ? item.trim() : item).filter(item => typeof item !== 'string' || item.length > 0))]
    }
    if (Array.isArray(value.delivery.artifact_verify)) {
      value.delivery.artifact_verify = value.delivery.artifact_verify.filter(item => typeof item !== 'string' || item.trim().length > 0)
    }
  }
  return value
}

const isBusinessSourceEdit = (editPath) => {
  const norm = posixPath(editPath || '')
  if (!norm || IS_CMAKE_FILE.test(norm) || /(?:^|\/)(?:Makefile|Kbuild|GNUmakefile)$/i.test(norm)) return false
  if (norm.split('/').some(part => TEST_DIR_NAME.test(part)) || TEST_FILE_NAME.test(path.posix.basename(norm))) return false
  return true
}

const sourceFileCovered = (edit, replaceFiles, allowBasename = false) => {
  const normPath = posixPath(edit.path || '')
  const repoPrefixed = `${edit.repo_id}:${normPath}`
  const slashPrefixed = `${edit.repo_id}/${normPath}`
  const base = path.posix.basename(normPath)
  for (const item of replaceFiles) {
    for (const ref of item.source_files || []) {
      const clean = posixPath(String(ref || '').trim()).replace(/^\.\/+/, '')
      if (!clean) continue
      if (clean === normPath || clean === repoPrefixed || clean === slashPrefixed || (allowBasename && clean === base)) return true
    }
  }
  return false
}

export function collectConsistencyNotices(value, record = null) {
  const notices = []
  if (!value || typeof value !== 'object') return notices
  const points = Array.isArray(value.points) ? value.points : []
  const edits = Array.isArray(value.edits) ? value.edits : []
  const declaresFiniteTimes = points.some(point => {
    const t = point?.times
    if (typeof t === 'number' && Number.isFinite(t) && t > 0) return true
    if (typeof t === 'string' && /(?:^\s*[1-9]\d*\s*(?:次)?\s*$|消耗\s*(?:1|一|\d+)\s*次|单次|一次)/.test(t)) return true
    const desc = `${point?.trigger ?? ''} ${point?.action ?? ''}`
    return /消耗\s*(?:1|一|\d+)\s*次|命中后递减/.test(desc)
  })
  if (declaresFiniteTimes && edits.length) {
    const afterBlob = edits.map(e => typeof e?.after === 'string' ? e.after : '').join('\n')
    const hasDecrementOrStateWrite = /(?:--|\-=|fetch_sub|__sync_sub_and_fetch|__atomic_sub_fetch|atomic_dec|atomic_sub|compare_exchange|setenv|unsetenv|unlink\s*\(|remove\s*\(|-\s*1\b|hits\s*>=|count\s*>=|remaining\s*<=)/i.test(afterBlob)
    if (!hasDecrementOrStateWrite) {
      notices.push('一致性提醒：桩点声明了有限触发次数（如单次/消耗一次），但补丁源码中未检测到明显的计数递减、状态更新或控制文件 unlink 删除语句，请核对差异确认未出现“只读 getenv 不递减”的无限触发。')
    }
  }
  const deliveryMode = normalizeDeliveryMode(record?.delivery_mode ?? value?.delivery?.mode)
  if (deliveryMode === 'product_package') {
    const cBusinessEdits = edits.filter(e => isBusinessSourceEdit(e?.path) && SOURCE_EXT.test(e?.path || ''))
    if (cBusinessEdits.length) {
      const cAfterBlob = cBusinessEdits.map(e => typeof e?.after === 'string' ? e.after : '').join('\n')
      const newlyAddedGetenv = cBusinessEdits.some(e => /\bgetenv\s*\(/.test(e?.after || '') && !/\bgetenv\s*\(/.test(e?.before || ''))
      const hasDiagOrFileGate = /\b(?:diagnose\w*|diag_\w*|dbg_cmd\w*|debug_cmd\w*|pgd_cmd\w*|reg_cmd\w*|cli_\w*|fopen|open|access|stat|lstat|unlink|remove)\s*\(/i.test(cAfterBlob)
        || /(?:DIAG|DBG|CLI|PGD)_[A-Z0-9_]*(?:CMD|REG)/i.test(cAfterBlob)
      if (newlyAddedGetenv && !hasDiagOrFileGate) {
        notices.push('平台限制提醒（L1）：当前产品包 C/C++ 补丁仅新增了 getenv() 环境变量门控；若目标宿主进程由平台 init 守护拉起（无法传递环境变量），桩将无法触发。建议稳态运行期路径改用模块 diagnose/pgd 命令触发，初始化路径改用“读到即 unlink 删除”的单次控制文件门控。')
      }
      const declaresHardcoded = points.some(p => /(?:写死|常量化|无条件触发|每次(?:进程)?启动必|拆除环境变量)/.test(`${p?.trigger ?? ''} ${p?.enable ?? ''}`))
      const lacksConditionalBranch = !/\b(?:if|switch)\s*\(|\?/.test(cAfterBlob)
        && points.some(p => /^(?:无|写死|常量化|编译写死|启动即触发|none|n\/a)$/i.test(String(p?.enable ?? '').trim()))
      if (declaresHardcoded || lacksConditionalBranch) {
        notices.push('平台限制提醒（L2）：检测到触发参数写死或缺少运行期门控；大包部署后每次宿主进程启动均会触发故障（模块持续停留失败态，无法同包验证恢复），恢复需重出干净基线包，不适合常态化驻留。')
      }
    }
  }
  return notices
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
  if (record.generation_contract_version >= 3) {
    const delivery = value.delivery
    if (!delivery || typeof delivery !== 'object' || Array.isArray(delivery)) {
      throw serviceError('生成结果缺少 delivery 交付信息（构建前提、应单独替换文件清单与桩特征标识）')
    }
    if (typeof delivery.build_requirement !== 'string' || !delivery.build_requirement.trim()) {
      throw serviceError('delivery.build_requirement 不能为空，请声明构建配置前提')
    }
    const markers = Array.isArray(delivery.marker_strings)
      ? delivery.marker_strings.filter(item => typeof item === 'string' && item.trim().length >= 4).map(item => item.trim())
      : []
    if (!markers.length) {
      throw serviceError('delivery.marker_strings 必须包含至少一个长度 >= 4 的桩特征字面量（如控制环境变量名或命中日志标识）')
    }
    const allAfter = value.edits.map(edit => typeof edit.after === 'string' ? edit.after : '').join('\n')
    const missingMarker = markers.find(marker => !allAfter.includes(marker))
    if (missingMarker) {
      throw serviceError(`delivery.marker_strings 中的标识「${missingMarker}」未出现在任何 edits[].after 补丁代码中，请核对`)
    }
    const replaceFiles = normalizeReplaceFiles(delivery.replace_files)
    if (!replaceFiles.length || replaceFiles.some(item => !item.source_files.length)) {
      throw serviceError('delivery.replace_files 不能为空，且每项必须声明 artifact 产物名及对应的 source_files 源码列表')
    }
    if (normalizeDeliveryMode(record.delivery_mode) === 'product_package') {
      const businessEdits = value.edits.filter(edit => isBusinessSourceEdit(edit.path))
      const basenameCounts = new Map()
      for (const edit of businessEdits) {
        const base = path.posix.basename(posixPath(edit.path || ''))
        basenameCounts.set(base, (basenameCounts.get(base) ?? 0) + 1)
      }
      const uncovered = businessEdits
        .filter(edit => !sourceFileCovered(edit, replaceFiles, basenameCounts.get(path.posix.basename(posixPath(edit.path || ''))) === 1))
        .map(edit => posixPath(edit.path))
      if (uncovered.length) {
        throw serviceError(`delivery.replace_files 遗漏了已修改业务源码的替换产物归属：${[...new Set(uncovered)].join('、')}`)
      }
    }
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

function buildSummaryForTask(build) {
  if (!build || build.status === 'unreadable') return null
  const branch = [...new Set((build.repositories || []).map(repo => repo.remote_branch || repo.personal_branch).filter(Boolean))].join('、')
  const commits = (build.repositories || []).filter(repo => repo.commit).map(repo => ({ repo_id: repo.repo_id, commit: repo.commit }))
  return {
    build_id: build.id,
    status: build.status,
    created_at: build.created_at,
    updated_at: build.updated_at,
    pushed: build.status === 'pushed',
    branch,
    commits,
    pipeline_url: build.pipeline_url || '',
    error: build.error || null,
  }
}

function taskSummary(task, { latestBuild = null, latestPushedBuild = null } = {}) {
  if (task.status === 'unreadable') return task
  const latest = new Map((task.verification || []).map(item => [item.case_key, item.result]))
  const repoIds = (task.repositories || []).length
    ? task.repositories.map(repo => repo.repo_id)
    : (task.source_repositories || []).map(repo => repo.repo_id)
  const replaceFiles = normalizeReplaceFiles(task.result?.delivery?.replace_files)
  const markerStrings = extractMarkerStrings(task)
  return {
    id: task.id, run_id: task.run_id, name: task.name || task.cases?.[0]?.title || '', status: task.status, failure_phase: task.failure_phase, error: task.error,
    created_at: task.created_at, updated_at: task.updated_at, schema_version: task.schema_version,
    delivery_mode: normalizeDeliveryMode(task.delivery_mode),
    build_variant: normalizeBuildVariant(task.build_variant),
    replace_files: replaceFiles,
    marker_strings: markerStrings,
    case_count: task.case_keys?.length ?? 0, point_count: task.result?.points?.length ?? 0,
    repo_ids: repoIds,
    result_saved: Boolean(task.result_saved),
    result_sha256: task.result_sha256 || null,
    includable: Boolean(task.result_saved && task.generation_complete !== false && ['ready', 'pushed'].includes(task.status)),
    base_commits: Object.fromEntries((task.repositories || []).map(repo => [repo.repo_id, repo.base_commit || null])),
    analysis_commits: Object.fromEntries(
      ((task.repositories || []).length ? task.repositories : (task.source_repositories || []))
        .map(repo => [repo.repo_id, repo.analysis_commit ?? null]),
    ),
    passed_count: [...latest.values()].filter(result => result === 'passed').length,
    verified_count: [...latest.values()].filter(result => result !== 'not_run').length,
    latest_build: latestBuild,
    latest_pushed_build: latestPushedBuild,
  }
}

function validateHttpPipelineUrl(value) {
  const url = String(value || '').trim()
  if (url) {
    let parsed
    try { parsed = new URL(url) } catch { throw serviceError('请输入完整的构建流水线 HTTP/HTTPS 地址') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw serviceError('流水线地址需使用 HTTP/HTTPS，且不能包含账号密码')
  }
  return url
}

export class FaultInjectionService {
  constructor({ generate, git = injectionGit, validateModel } = {}) { this.validateModel = validateModel; this.generate = generate; this.git = git; this.active = new Map(); this.queues = new Map(); this.branchQueues = new Map() }
  key(dataRoot, runId, taskId) { return JSON.stringify([path.resolve(dataRoot), runId, taskId]) }
  buildKey(dataRoot, buildId) { return JSON.stringify([path.resolve(dataRoot), '__build__', buildId]) }
  async directory(dataRoot, runId, taskId) {
    if (!id(runId) || (taskId != null && !id(taskId))) throw serviceError('打桩任务或 Run 标识无效')
    const root = await realpath(dataRoot)
    const base = path.join(root, '.pangea', 'fault-injection', runId, ...(taskId ? [taskId] : []))
    await mkdir(base, { recursive: true })
    if (!inside(root, await realpath(base))) throw serviceError('打桩任务目录越出数据目录')
    return base
  }
  async buildsRoot(dataRoot, { create = false } = {}) {
    const root = await realpath(dataRoot)
    const base = path.join(root, '.pangea', 'fault-injection-builds')
    if (create) {
      await mkdir(base, { recursive: true })
      if (!inside(root, await realpath(base))) throw serviceError('出包目录越出数据目录')
    } else if (!inside(root, base)) {
      throw serviceError('出包目录越出数据目录')
    }
    return base
  }
  async buildDirectory(dataRoot, buildId, { create = true } = {}) {
    if (!id(buildId)) throw serviceError('出包标识无效')
    const root = await realpath(dataRoot)
    const base = path.join(root, '.pangea', 'fault-injection-builds', buildId)
    if (create) {
      await mkdir(base, { recursive: true })
      if (!inside(root, await realpath(base))) throw serviceError('出包目录越出数据目录')
    } else if (!inside(root, base)) {
      throw serviceError('出包目录越出数据目录')
    }
    return base
  }
  async save(directory, record) {
    record.updated_at = new Date().toISOString()
    await writeTaskStoreFile(path.join(directory, 'task.json'), JSON.stringify(record, null, 2) + '\n')
  }
  async saveBuild(directory, build) {
    build.updated_at = new Date().toISOString()
    const persisted = {
      ...build,
      repositories: (build.repositories || []).map(({ checkout, remote_url, ...repo }) => repo),
    }
    await writeTaskStoreFile(path.join(directory, 'build.json'), JSON.stringify(persisted, null, 2) + '\n')
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
  async readBuild(dataRoot, buildId) {
    const directory = await this.buildDirectory(dataRoot, buildId, { create: false })
    const file = path.join(directory, 'build.json')
    const upgradeCommit = value => {
      if (value?.commit_config && typeof value.commit_config === 'object' && value.commit_config.mode === 'default' && !value.commit_config.explicit_default_mode) {
        const upgraded = { ...value.commit_config }
        delete upgraded.mode
        if (!upgraded.pattern) delete upgraded.pattern
        value.commit_config = normalizeCommitConfig(upgraded)
      }
      return value
    }
    let build = upgradeCommit(JSON.parse(await readFile(file, 'utf8')))
    if (build.id !== buildId) throw serviceError('出包记录身份不匹配')
    const key = this.buildKey(dataRoot, buildId)
    if (activeBuildStates.has(build.status) && !this.active.has(key)) {
      build = upgradeCommit(JSON.parse(await readFile(file, 'utf8')))
      if (build.id !== buildId) throw serviceError('出包记录身份不匹配')
      if (activeBuildStates.has(build.status) && !this.active.has(key)) {
        return { ...build, status: 'interrupted', error: '上次出包操作已中断，可重试本次出包' }
      }
    }
    const operation = this.active.get(key)
    if (operation && !activeBuildStates.has(build.status)) return { ...build, status: operation.status }
    return build
  }
  async listBuilds(dataRoot) {
    const base = await this.buildsRoot(dataRoot, { create: false })
    let entries
    try { entries = await readdir(base, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const builds = []
    for (const item of entries) {
      if (!item.isDirectory() || !id(item.name)) continue
      try { builds.push(await this.readBuild(dataRoot, item.name)) }
      catch (error) {
        if (error.code === 'ENOENT') continue
        builds.push({ id: item.name, status: 'unreadable', error: `出包记录不可读：${error.message}` })
      }
    }
    return builds.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  }
  async taskBuildIndex(dataRoot) {
    const latestAny = new Map(), latestPushed = new Map(), pushedBuilds = new Map()
    let builds = []
    try { builds = await this.listBuilds(dataRoot) } catch { return { builds: [], latestAny, latestPushed, pushedBuilds } }
    for (const build of builds) {
      const summary = buildSummaryForTask(build)
      if (!summary) continue
      for (const item of Array.isArray(build.items) ? build.items : []) {
        const taskKey = `${item.run_id}\0${item.task_id}`
        if (!latestAny.has(taskKey)) latestAny.set(taskKey, summary)
        if (build.status === 'pushed') {
          if (!latestPushed.has(taskKey)) latestPushed.set(taskKey, summary)
          const list = pushedBuilds.get(taskKey) || []
          list.push(summary)
          pushedBuilds.set(taskKey, list)
        }
      }
    }
    return { builds, latestAny, latestPushed, pushedBuilds }
  }
  async collectRecordedInjectionCommits(dataRoot, repoId, { includeRestore = false, limit = 64 } = {}) {
    const root = await realpath(dataRoot)
    const seen = new Map()
    const addCommit = (commit, source_type, source_id) => {
      if (typeof commit === 'string' && /^[0-9a-f]{7,64}$/i.test(commit) && !seen.has(commit) && seen.size < limit) {
        seen.set(commit, { commit, source_type, source_id })
      }
    }
    try {
      const buildsDir = path.join(root, '.pangea', 'fault-injection-builds')
      for (const entry of await readdir(buildsDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || !id(entry.name)) continue
        try {
          const build = JSON.parse(await readFile(path.join(buildsDir, entry.name, 'build.json'), 'utf8'))
          if (build?.restore_baseline && !includeRestore) continue
          for (const repo of build?.repositories || []) {
            if (repo?.repo_id === repoId && repo.commit && repo.push_result !== 'unchanged') {
              addCommit(repo.commit, build?.restore_baseline ? 'restore_baseline' : 'build', entry.name)
            }
          }
        } catch {}
      }
    } catch {}
    try {
      const fiDir = path.join(root, '.pangea', 'fault-injection')
      for (const runEntry of await readdir(fiDir, { withFileTypes: true })) {
        if (!runEntry.isDirectory() || !id(runEntry.name)) continue
        try {
          for (const taskEntry of await readdir(path.join(fiDir, runEntry.name), { withFileTypes: true })) {
            if (!taskEntry.isDirectory() || !id(taskEntry.name)) continue
            try {
              const task = JSON.parse(await readFile(path.join(fiDir, runEntry.name, taskEntry.name, 'task.json'), 'utf8'))
              for (const repo of task?.repositories || []) {
                if (repo?.repo_id === repoId && repo.commit) addCommit(repo.commit, 'legacy_task', taskEntry.name)
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
    return [...seen.values()]
  }
  async findAncestorInjectionCommits(dataRoot, repoId, sourcePath, headCommit, signal) {
    const recorded = await this.collectRecordedInjectionCommits(dataRoot, repoId)
    if (!recorded.length || !headCommit) return []
    const matched = []
    for (const item of recorded) {
      signal?.throwIfAborted?.()
      if (item.commit === headCommit) { matched.push(item); continue }
      try {
        if (await this.git(sourcePath, ['merge-base', item.commit, headCommit], signal) === item.commit) matched.push(item)
      } catch {
        signal?.throwIfAborted?.()
      }
    }
    return matched
  }
  async read(dataRoot, runId, taskId, { buildIndex = null } = {}) {
    const directory = await this.directory(dataRoot, runId, taskId)
    // Tasks written before result_saved existed (or aborted right after result.json
    // landed on disk) still expose their saved result for revalidate / reuse.
    const withSavedResult = async value => {
      const savedFile = await this.resolveSavedResultFile(directory)
      if (savedFile) {
        value.result_saved = true
        if (!value.result_sha256) value.result_sha256 = hash(await readFile(savedFile))
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
      if (activeStates.has(record.status) && !this.active.has(this.key(dataRoot, runId, taskId))) {
        record = { ...record, status: 'interrupted', error: '上次操作已中断；可重新生成，已保存的结果仍可复用' }
      }
    } else {
      const operation = this.active.get(this.key(dataRoot, runId, taskId))
      if (operation && !activeStates.has(record.status)) record = { ...record, status: operation.status }
    }
    const index = buildIndex || await this.taskBuildIndex(dataRoot)
    const taskKey = `${runId}\0${taskId}`
    const latestPushed = index.latestPushed.get(taskKey) || null
    const latestAny = index.latestAny.get(taskKey) || null
    record.latest_pushed_build = latestPushed
    record.latest_build = latestPushed || latestAny
    record.pushed_builds = index.pushedBuilds?.get(taskKey) || []
    return record
  }
  async list(dataRoot, runId, { buildIndex = null } = {}) {
    const directory = await this.directory(dataRoot, runId)
    const index = buildIndex || await this.taskBuildIndex(dataRoot)
    const records = []
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (!item.isDirectory() || !id(item.name)) continue
      try { records.push(await this.read(dataRoot, runId, item.name, { buildIndex: index })) }
      catch (error) {
        if (error.code === 'ENOENT') continue
        // One damaged record must not hide the other tasks of the same Run.
        records.push({ id: item.name, run_id: runId, status: 'unreadable', error: `记录不可读：${error.message}` })
      }
    }
    return records.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  }
  async listAll(dataRoot) {
    const root = await realpath(dataRoot)
    const index = await this.taskBuildIndex(dataRoot)
    let entries
    try { entries = await readdir(path.join(root, '.pangea', 'fault-injection'), { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') return []; throw error }
    const tasks = []
    for (const item of entries) {
      if (!item.isDirectory() || !id(item.name)) continue
      for (const task of await this.list(dataRoot, item.name, { buildIndex: index })) {
        const taskKey = `${task.run_id}\0${task.id}`
        tasks.push(taskSummary(task, {
          latestBuild: index.latestPushed.get(taskKey) || index.latestAny.get(taskKey) || null,
          latestPushedBuild: index.latestPushed.get(taskKey) || null,
        }))
      }
    }
    return tasks.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  }
  async configurePipeline(dataRoot, runId, taskId, value) {
    const url = validateHttpPipelineUrl(value)
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
  async configureBuildPipeline(dataRoot, buildId, value) {
    const url = validateHttpPipelineUrl(value)
    const buildsBase = await this.buildsRoot(dataRoot, { create: true })
    await writeTaskStoreFile(path.join(buildsBase, 'pipeline.json'), JSON.stringify({ pipeline_url: url }) + '\n')
    if (!buildId) return { pipeline_url: url, build: null }
    return this.buildExclusive(dataRoot, buildId, async () => {
      const build = await this.readBuild(dataRoot, buildId)
      build.pipeline_url = url
      await this.saveBuild(await this.buildDirectory(dataRoot, buildId), build)
      return { pipeline_url: url, build }
    })
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
  async resolveSuggestedCheckoutRef(sourcePath, { remote = 'origin', personalBranch = '', analysisCommit = null, signal = undefined } = {}) {
    if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) {
      try {
        const ref = await this.git(sourcePath, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`], signal)
        const prefix = `refs/remotes/${remote}/`
        const branch = ref.startsWith(prefix) ? ref.slice(prefix.length) : ''
        if (branch && branch !== personalBranch) return branch
      } catch (error) {
        if (signal?.aborted) throw error
      }
    }
    return analysisCommit ? String(analysisCommit) : ''
  }
  async inspectRepositoryStatus(dataRoot, repoId, { analysisCommit = null, runId = null } = {}) {
    const settings = await readRepositorySettings(dataRoot, repoId)
    const sourcePath = settings.git_path || path.join(dataRoot, 'repositories', repoId)
    let source
    try { source = await inspectSource(sourcePath) } catch (error) { source = { kind: 'unavailable', error: error.message } }
    const personalBranch = settings.personal_branch || ''
    const remoteBranch = settings.remote_branch || personalBranch || ''
    const remote = settings.remote || 'origin'
    const currentBranch = source.kind === 'git' ? (source.branch || '') : ''
    const headEqualsPersonalBranch = Boolean(source.kind === 'git' && personalBranch && currentBranch && currentBranch === personalBranch)
    const protectedBranchError = personalBranch ? (protectedBranchReason(personalBranch) || protectedBranchReason(remoteBranch) || '') : ''
    const resolvedSourcePath = source.path || sourcePath
    const defaultBranch = source.kind === 'git' ? await readRemoteDefaultBranch(resolvedSourcePath, remote) : ''
    const suggestedCheckoutRef = source.kind === 'git'
      ? ((defaultBranch && defaultBranch !== personalBranch) ? defaultBranch : (analysisCommit ? String(analysisCommit) : ''))
      : ''
    const suggestedCheckoutCommand = suggestedCheckoutRef ? `git -C "${resolvedSourcePath}" checkout ${suggestedCheckoutRef}` : ''
    let comparison = { available: false, changed_count: 0, files: [] }
    if (source.kind === 'git' && runId) {
      try { comparison = await compareSnapshot(resolvedSourcePath, 'HEAD', path.join(dataRoot, 'runs', runId, 'inputs', 'source', repoId)) }
      catch (error) { comparison = { available: false, error: error.message } }
    }
    const injectionCommitsInHead = source.kind === 'git' && source.commit
      ? await this.findAncestorInjectionCommits(dataRoot, repoId, resolvedSourcePath, source.commit)
      : []
    return {
      repo_id: repoId,
      source_path: sourcePath,
      base_ref: 'HEAD',
      current_branch: currentBranch,
      personal_branch: personalBranch,
      remote_branch: remoteBranch,
      remote,
      default_branch: defaultBranch,
      suggested_checkout_ref: suggestedCheckoutRef,
      suggested_checkout_command: suggestedCheckoutCommand,
      head_equals_personal_branch: headEqualsPersonalBranch,
      protected_branch_error: protectedBranchError,
      injection_commits_in_head: injectionCommitsInHead,
      analysis_commit: analysisCommit,
      source,
      ...(runId ? { comparison } : {}),
      linked: Boolean(settings.git_path),
      project_pipeline_configured: Object.hasOwn(settings, 'pipeline_url'),
      pipeline_url: settings.pipeline_url || '',
    }
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
      repositories.push(await this.inspectRepositoryStatus(dataRoot, repo.repo_id, {
        analysisCommit: repo.git?.commit ?? repo.git?.head ?? null,
        runId: run.run_id,
      }))
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
      if (configured.personal_branch) {
        const forbidden = protectedBranchReason(configured.personal_branch) || protectedBranchReason(configured.remote_branch)
        if (forbidden) throw serviceError(`${repo.repo_id}：${forbidden}。请在项目配置改选个人开发分支`)
        if (configured.head_equals_personal_branch) {
          throw serviceError(formatPersonalBranchBlockMessage({
            repoId: repo.repo_id,
            personalBranch: configured.personal_branch,
            sourcePath: configured.source?.path || configured.source_path,
            suggestedRef: configured.suggested_checkout_ref,
            actionLabel: '再生成打桩修改',
          }))
        }
      }
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
    let contractVersion = 3
    if (reused) {
      try {
        const reusedTask = JSON.parse(await readFile(path.join(await this.directory(dataRoot, run.run_id, reused.task_id), 'task.json'), 'utf8'))
        if (Number.isInteger(reusedTask?.generation_contract_version) && reusedTask.generation_contract_version < 3) {
          contractVersion = reusedTask.generation_contract_version
        }
      } catch {}
    }
    const taskId = randomUUID(), directory = await this.directory(dataRoot, run.run_id, taskId)
    const record = { schema_version: 3, generation_contract_version: contractVersion, id: taskId, run_id: run.run_id, status: 'preparing', created_at: new Date().toISOString(),
      name: String(input.name || selected[0].title || '打桩任务').slice(0, 100), pipeline_url: defaults.pipeline_url || '',
      delivery_mode: normalizeDeliveryMode(input.delivery_mode),
      build_variant: normalizeBuildVariant(input.build_variant),
      branch: [...new Set(selectedRepositories.map(repo => repo.personal_branch).filter(Boolean))].join('、'),
      case_keys: keys, cases: selected,
      analysis_context: run.analysis_context ?? extractAnalysisContext(run, selected), repositories: [], source_repositories: selectedRepositories,
      provider_id: providerId, agent_model: model, agent_catalog_id: input.agent_catalog_id || null,
      baseline_acknowledged: input.baseline_acknowledged === true, instructions: String(input.instructions || ''),
      result: null, result_saved: false, result_sha256: null, generation_complete: false, verification: [], build: {}, error: null,
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
  async setBuildVariant(dataRoot, runId, taskId, buildVariant) {
    const normalized = normalizeBuildVariant(buildVariant)
    return this.exclusive(dataRoot, runId, taskId, async () => {
      const record = await this.read(dataRoot, runId, taskId)
      record.build_variant = normalized
      const persisted = { ...record }
      delete persisted.latest_build
      delete persisted.latest_pushed_build
      delete persisted.pushed_builds
      await this.save(await this.directory(dataRoot, runId, taskId), persisted)
      return { ...persisted, latest_build: record.latest_build, latest_pushed_build: record.latest_pushed_build, pushed_builds: record.pushed_builds }
    })
  }
  async prepareAndGenerate({ dataRoot, directory, record, cwd, signal }) {
    for (const source of record.source_repositories) {
      await repositoryOperation(dataRoot, source.repo_id, async operationSignal => {
        const signal = operationSignal
        signal.throwIfAborted()
        const settings = await readRepositorySettings(dataRoot, source.repo_id)
        const sourcePath = await realpath(settings.git_path || source.source_path)
        const top = await this.git(sourcePath, ['rev-parse', '--show-toplevel'], signal)
        if (await realpath(top) !== sourcePath) throw serviceError(`请指定 Git 仓库根目录：${source.repo_id}`)
        const personalBranch = settings.personal_branch || source.personal_branch || ''
        const remoteBranch = settings.remote_branch || source.remote_branch || personalBranch
        if (personalBranch) {
          const forbidden = protectedBranchReason(personalBranch) || protectedBranchReason(remoteBranch)
          if (forbidden) throw serviceError(`${source.repo_id}：${forbidden}。请在项目配置改选个人开发分支`)
        }
        const currentBranch = await this.git(sourcePath, ['branch', '--show-current'], signal)
        if (personalBranch && currentBranch && currentBranch === personalBranch) {
          const suggestedRef = await this.resolveSuggestedCheckoutRef(sourcePath, {
            remote: settings.remote || source.remote || 'origin',
            personalBranch,
            analysisCommit: source.analysis_commit,
            signal,
          }) || source.suggested_checkout_ref || ''
          throw serviceError(formatPersonalBranchBlockMessage({
            repoId: source.repo_id,
            personalBranch,
            sourcePath,
            suggestedRef,
            actionLabel: '再生成打桩修改',
          }))
        }
        const baseCommit = await this.git(sourcePath, ['rev-parse', '--verify', 'HEAD^{commit}'], signal)
        const dirty = Boolean(await this.git(sourcePath, ['status', '--porcelain'], signal))
        source.working_tree_dirty = dirty
        const ancestorInjections = await this.findAncestorInjectionCommits(dataRoot, source.repo_id, sourcePath, baseCommit, signal)
        if (ancestorInjections.length) {
          const listed = ancestorInjections.slice(0, 5).map(item => `${item.commit.slice(0, 12)}（${item.source_type === 'build' ? `出包 ${item.source_id.slice(0, 8)}` : `旧任务 ${item.source_id.slice(0, 8)}`}）`).join('、')
          record.notices.push(`${source.repo_id}：当前分析目录 HEAD 含有历史打桩提交 ${listed}。宿主不会代为回退分析目录，请确认当前基线是否为预期开发代码。`)
        }
        const checkout = path.join(directory, 'repositories', source.repo_id)
        await cloneIsolatedCheckout(this.git, directory, sourcePath, checkout, signal)
        for (const setting of ['user.name', 'user.email']) {
          try { const value = await this.git(sourcePath, ['config', '--get', setting], signal); if (value) await this.git(checkout, ['config', setting, value], signal) }
          catch (error) { if (signal.aborted) throw error }
        }
        await this.git(checkout, ['checkout', '--detach', baseCommit], signal)
        source.comparison = await compareSnapshot(checkout, baseCommit, path.join(dataRoot, 'runs', record.run_id, 'inputs', 'source', source.repo_id))
        // Anything present now was produced by the host checkout, not by the generator.
        const baseline = await workspaceSnapshot(this.git, checkout, signal)
        const { paths: targetPaths, rangesByPath, symbols: hintSymbols } = collectTargetEvidenceSpecs(source.repo_id, record.cases, record.analysis_context)
        const harness = await inspectRepositoryHarness(checkout, source.repo_id, targetPaths, rangesByPath, hintSymbols)
        record.repositories.push({
          repo_id: source.repo_id,
          path: checkout,
          source_path: sourcePath,
          base_commit: baseCommit,
          base_branch: currentBranch || '',
          analysis_commit: source.analysis_commit ?? null,
          working_tree_dirty: dirty,
          branch: personalBranch,
          remote_branch: remoteBranch,
          workspace_baseline: baseline,
          baseline_unstaged: baseline.filter(entry => entry.status !== '??' && entry.status[1] !== ' ').map(entry => entry.path),
          ...(harness ? { harness } : {}),
        })
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
      const validateOutput = async candidate => {
        const clone = structuredClone(candidate)
        normalizeInjectionResult(clone)
        checkInjectionResult(clone, record)
        for (const repo of record.repositories) {
          await this.cleanGeneratorCheckout(directory, record, repo, signal)
          const edits = clone.edits.filter(edit => edit.repo_id === repo.repo_id)
          if (!edits.length) continue
          for (const edit of edits) {
            const attributes = await this.git(repo.path, ['check-attr', '-z', 'filter', '--', edit.path], signal)
            if (attributes.split('\0')[2] === 'lfs') throw serviceError(`本轮打桩不支持修改 LFS 文件：${edit.path}`)
          }
          await applyInjectionEdits(repo.path, edits, { dryRun: true })
        }
      }
      const result = await this.generate({ record, cwd, scratchDirectory, inputPath, outputPath, signal,
        prompt: injectionPrompt({ record, inputPath, outputPath, compactInput, referencePath, referenceError: record.reference_from?.error }) + `\n用户补充说明：${record.instructions || '无'}`,
        validateOutput,
        onStarted: async session => { record.agent_session = session; await this.save(directory, record) },
        onTelemetry: async telemetry => { record.telemetry = telemetry; await this.save(directory, record) } })
      signal.throwIfAborted()
      generated = result ?? JSON.parse(await readFile(outputPath, 'utf8'))
    }
    await this.applyAndStageResult({ directory, scratchDirectory, record, generated, signal, isRevalidate: false })
  }
  async cleanGeneratorCheckout(directory, record, repo, signal) {
    // The delivery is the result file. Changes the generator made to its source
    // copy are never mixed in: they are recorded, discarded, and the result is
    // applied to the clean checkout. A result that relied on them no longer
    // matches the original text and is rejected by exact-match apply.
    const changes = workspaceChanges(repo.workspace_baseline, await workspaceSnapshot(this.git, repo.path, signal))
    const head = await this.git(repo.path, ['rev-parse', 'HEAD'], signal)
    if (!changes.length && head === repo.base_commit) return
    const mergedChanges = [...(Array.isArray(repo.workspace_changes) ? repo.workspace_changes : []), ...changes]
    const seenChangeKeys = new Set()
    repo.workspace_changes = mergedChanges.filter(item => {
      const key = `${item.change}:${item.path}`
      if (seenChangeKeys.has(key)) return false
      seenChangeKeys.add(key)
      return true
    }).slice(0, 50)
    await this.git(repo.path, ['checkout', '-q', '--force', '--detach', repo.base_commit], signal)
    await this.git(repo.path, ['reset', '-q', '--hard', repo.base_commit], signal)
    await this.git(repo.path, ['clean', '-q', '-f', '-f', '-d'], signal)
    const remaining = workspaceChanges(repo.workspace_baseline, await workspaceSnapshot(this.git, repo.path, signal)).filter(item => item.change !== 'reverted')
    if (remaining.length || await this.git(repo.path, ['rev-parse', 'HEAD'], signal) !== repo.base_commit) {
      throw serviceError(`${repo.repo_id}：生成期间源码副本被改动且无法恢复（${describeChanges(remaining)}）。生成结果已保存，可“直接复用上次生成结果”在新的干净副本上应用`)
    }
    const notice = `${repo.repo_id}：执行器在生成期间改动了源码副本（${changes.length ? describeChanges(changes) : 'HEAD 被移动'}）。这些改动已丢弃，未混入提交；下面的差异只来自结果文件中登记的修改。`
    if (!record.notices.includes(notice)) record.notices.push(notice)
    await this.save(directory, record)
  }
  async applyAndStageResult({ directory, scratchDirectory, record, generated, signal, isRevalidate = false }) {
    normalizeInjectionResult(generated)
    await mkdir(scratchDirectory, { recursive: true })
    // Keep the authored result available even if its transport shape is broken.
    await writeFile(path.join(scratchDirectory, 'authored-result.json'), JSON.stringify(generated, null, 2))
    const savedFile = await this.resolveSavedResultFile(directory)
    record.result_saved = true
    record.result_sha256 = savedFile ? hash(await readFile(savedFile)) : null
    await this.save(directory, record)
    checkInjectionResult(generated, record)
    for (const notice of collectConsistencyNotices(generated, record)) {
      if (!record.notices.includes(notice)) record.notices.push(notice)
    }
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
        await this.cleanGeneratorCheckout(directory, record, repo, signal)
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
  async buildExclusive(dataRoot, buildId, callback) {
    const key = this.buildKey(dataRoot, buildId)
    if (this.queues.has(key) || this.active.has(key)) throw serviceError('本次出包操作正在执行', 409)
    const work = Promise.resolve().then(callback); this.queues.set(key, work)
    try { return await work } finally { this.queues.delete(key) }
  }
  async branchExclusive(record, callback, signal, dataRoot) {
    const locksDir = path.join(await realpath(dataRoot), '.pangea', 'locks')
    await mkdir(locksDir, { recursive: true })
    const keys = []
    for (const repo of record.repositories) {
      const common = await this.git(repo.source_path, ['rev-parse', '--git-common-dir'])
      const commonReal = await realpath(path.resolve(repo.source_path, common))
      const branchLockName = repo.remote_branch || repo.personal_branch || repo.branch
      keys.push(path.join(locksDir, `branch-${hash(`${commonReal}\0${branchLockName}`).slice(0, 32)}.lock`))
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
            onAbort = () => reject(signal.reason || new Error('出包任务已停止'))
            signal?.addEventListener('abort', onAbort, { once: true })
          })])
        } finally { if (onAbort) signal?.removeEventListener('abort', onAbort) }
        signal?.throwIfAborted()
        let handle
        try { handle = await open(key, 'wx') }
        catch (error) {
          if (error.code !== 'EEXIST') throw error
          let owner = null
          try { owner = JSON.parse(await readFile(key, 'utf8')) } catch {}
          let dead = false
          if (Number.isInteger(owner?.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0) } catch (reason) { dead = reason.code === 'ESRCH' }
          } else {
            try {
              const info = await lstat(key)
              if (Date.now() - info.mtimeMs > 10_000) dead = true
            } catch (statError) {
              if (statError.code === 'ENOENT') dead = true
            }
          }
          if (!dead) throw serviceError(`同一分支正在被另一出包操作使用，请稍后重试（锁文件：${key}）`, 409)
          await unlink(key).catch(unlinkError => { if (unlinkError.code !== 'ENOENT') throw unlinkError })
          handle = await open(key, 'wx')
        }
        releases.push(async () => { await handle.close(); await unlink(key).catch(() => {}) })
        await handle.writeFile(JSON.stringify({ pid: process.pid, build: record.id, created_at: Date.now() }))
      }
      const ids = [...new Set(record.repositories.map(repo => repo.repo_id))].sort()
      const guarded = (index, inheritedSignal) => index === ids.length ? callback(inheritedSignal) : repositoryOperation(dataRoot, ids[index], operationSignal => guarded(index + 1, operationSignal), { signal: inheritedSignal })
      return await guarded(0, signal)
    } finally { for (const release of releases.reverse()) await release() }
  }
  async buildContext(dataRoot) {
    const root = await realpath(dataRoot)
    const tasks = await this.listAll(dataRoot)
    const builds = await this.listBuilds(dataRoot)
    const includableSet = new Set(tasks.filter(task => task.includable).map(task => `${task.run_id}\0${task.id}`))
    const pushedItemsByRepoSet = {}
    let defaultItems = []
    let defaultResolved = false
    for (const build of builds) {
      if (build.status !== 'pushed') continue
      const repoSetKey = [...new Set((build.repositories || []).map(repo => repo.repo_id).filter(Boolean))].sort().join(',')
      const validItems = (build.items || [])
        .filter(item => includableSet.has(`${item.run_id}\0${item.task_id}`))
        .map(item => ({ run_id: item.run_id, task_id: item.task_id }))
      if (!defaultResolved) {
        defaultItems = validItems
        defaultResolved = true
      }
      if (repoSetKey && !Object.hasOwn(pushedItemsByRepoSet, repoSetKey)) {
        pushedItemsByRepoSet[repoSetKey] = validItems
      }
    }
    const repoIds = new Set(tasks.flatMap(task => task.repo_ids || []))
    for (const dirPath of [path.join(root, '.pangea', 'repository-settings'), path.join(root, 'repositories')]) {
      try {
        for (const entry of await readdir(dirPath, { withFileTypes: true })) {
          const name = entry.isFile() && entry.name.endsWith('.json') ? entry.name.slice(0, -5) : entry.isDirectory() ? entry.name : ''
          if (id(name)) repoIds.add(name)
        }
      } catch {}
    }
    const repositories = []
    for (const repoId of [...repoIds].sort()) {
      repositories.push(await this.inspectRepositoryStatus(dataRoot, repoId))
    }
    let buildPipeline = {}
    try { buildPipeline = JSON.parse(await readFile(path.join(await this.buildsRoot(dataRoot, { create: false }), 'pipeline.json'), 'utf8')) } catch {}
    const configuredRepoPipelines = repositories
      .filter(repo => repo.project_pipeline_configured && repo.pipeline_url)
      .map(repo => repo.pipeline_url)
    const uniqueRepoPipelines = [...new Set(configuredRepoPipelines)]
    const sharedRepoPipeline = repositories.length > 0
      && configuredRepoPipelines.length === repositories.length
      && uniqueRepoPipelines.length === 1
      ? uniqueRepoPipelines[0]
      : ''
    const latestPipeline = builds.find(b => b.pipeline_url)?.pipeline_url || ''
    const commit_config = await this.readCommitDefaults(dataRoot)
    return {
      tasks,
      builds,
      default_items: defaultItems,
      pushed_items_by_repo_set: pushedItemsByRepoSet,
      commit_config,
      pipeline_url: sharedRepoPipeline || (repositories.length <= 1 ? (buildPipeline.pipeline_url || latestPipeline || '') : ''),
      repositories,
    }
  }
  async loadAndValidateBuildTask(dataRoot, item, { expectedSha = null } = {}) {
    if (!item || !id(item.run_id) || !id(item.task_id)) throw serviceError('所选打桩任务标识无效')
    const directory = await this.directory(dataRoot, item.run_id, item.task_id)
    let rawDiskRecord
    try { rawDiskRecord = JSON.parse(await readFile(path.join(directory, 'task.json'), 'utf8')) }
    catch (error) {
      if (error.code === 'ENOENT') throw serviceError(`打桩任务不存在：${item.task_id}`)
      throw serviceError(`打桩任务记录不可读（${item.task_id}）：${error.message}`)
    }
    const record = await this.read(dataRoot, item.run_id, item.task_id)
    if (activeStates.has(record.status)) throw serviceError(`打桩任务「${record.name || record.id}」仍在生成中，请等待完成后再出包`)
    if (!['ready', 'pushed'].includes(record.status) || record.generation_complete === false) {
      throw serviceError(`请先完整生成打桩任务「${record.name || record.id}」后再加入出包`)
    }
    const savedFile = await this.resolveSavedResultFile(directory)
    if (!savedFile) throw serviceError(`打桩任务「${record.name || record.id}」缺少已保存的结果文件，请重新生成`)
    const bytes = await readFile(savedFile)
    const actualSha = hash(bytes)
    if (rawDiskRecord.result_sha256 && rawDiskRecord.result_sha256 !== actualSha) {
      throw serviceError(`打桩任务「${record.name || record.id}」的结果文件已被篡改（SHA-256 不符），请重新验收或重新生成`)
    }
    const callerExpected = expectedSha || item.result_sha256 || null
    if (callerExpected && callerExpected !== actualSha) {
      throw serviceError(`打桩任务「${record.name || record.id}」的结果文件在选入后被改动（SHA-256 不符）`)
    }
    let parsed
    try { parsed = JSON.parse(bytes.toString('utf8')) }
    catch (error) { throw serviceError(`打桩任务「${record.name || record.id}」结果文件 JSON 损坏：${error.message}`) }
    normalizeInjectionResult(parsed)
    if (!Array.isArray(parsed?.edits) || !parsed.edits.length) {
      throw serviceError(`打桩任务「${record.name || record.id}」结果文件不包含代码修改`)
    }
    return { record, edits: parsed.edits, resultSha256: actualSha }
  }
  async build(dataRoot, input = {}) {
    const background = input.background === true
    const retryBuildId = input.build_id ? String(input.build_id) : ''
    const runBuild = async () => {
      let build, buildDir, loadedTasks, restoreBaseline
      if (retryBuildId) {
        build = await this.readBuild(dataRoot, retryBuildId)
        if (build.status === 'pushed') return build
        if (activeBuildStates.has(build.status)) throw serviceError('本次出包正在执行', 409)
        buildDir = await this.buildDirectory(dataRoot, retryBuildId)
        restoreBaseline = build.restore_baseline === true
        loadedTasks = []
        for (const item of build.items || []) {
          loadedTasks.push(await this.loadAndValidateBuildTask(dataRoot, item, { expectedSha: item.result_sha256 }))
        }
      } else if (input.restore_baseline === true) {
        if (Array.isArray(input.items) && input.items.length) throw serviceError('恢复干净基线模式不能同时包含打桩任务')
        restoreBaseline = true
        loadedTasks = []
      } else {
        restoreBaseline = false
        const rawItems = input.items
        if (!Array.isArray(rawItems) || !rawItems.length) throw serviceError('请至少勾选一个就绪的打桩任务加入出包')
        const itemKeys = rawItems.map(item => `${item?.run_id || ''}\0${item?.task_id || ''}`)
        if (new Set(itemKeys).size !== itemKeys.length) throw serviceError('出包任务列表中包含重复项')
        const unsorted = []
        for (const item of rawItems) {
          unsorted.push(await this.loadAndValidateBuildTask(dataRoot, item))
        }
        loadedTasks = unsorted.sort((a, b) =>
          String(a.record.created_at || '').localeCompare(String(b.record.created_at || ''))
          || String(a.record.id).localeCompare(String(b.record.id)))
      }
      let targetRepoIds
      if (retryBuildId) {
        targetRepoIds = [...new Set((build.repositories || []).map(repo => repo.repo_id))]
      } else if (restoreBaseline) {
        const rawRepoIds = input.repo_ids
        if (!Array.isArray(rawRepoIds) || !rawRepoIds.length) throw serviceError('请选择需要恢复干净基线的目标仓库')
        if (new Set(rawRepoIds).size !== rawRepoIds.length) throw serviceError('恢复干净基线的目标仓库列表中包含重复项')
        targetRepoIds = rawRepoIds.map(repoId => String(repoId))
      } else {
        targetRepoIds = [...new Set(loadedTasks.flatMap(entry => entry.edits.map(edit => edit?.repo_id).filter(Boolean)))]
      }
      if (!targetRepoIds.length) throw serviceError(restoreBaseline ? '请选择需要恢复干净基线的目标仓库' : '所选打桩任务没有目标仓库修改')
      const repoConfigs = new Map()
      for (const repoId of targetRepoIds) {
        if (!id(repoId)) throw serviceError(`仓库标识无效：${repoId}`)
        const settings = await readRepositorySettings(dataRoot, repoId)
        if (!settings.personal_branch) throw serviceError(`${repoId}：请先在仓库配置中选择个人开发分支`)
        const personalBranch = settings.personal_branch
        const remoteBranch = settings.remote_branch || personalBranch
        const forbidden = protectedBranchReason(personalBranch) || protectedBranchReason(remoteBranch)
        if (forbidden) throw serviceError(`${repoId}：${forbidden}。请在仓库配置改选个人开发分支`)
        const remote = String(settings.remote || 'origin')
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote)) throw serviceError(`${repoId}：远端名称无效`)
        const rawSourcePath = settings.git_path || path.join(dataRoot, 'repositories', repoId)
        let source
        try { source = await inspectSource(rawSourcePath) } catch (error) { throw serviceError(`${repoId}：${error.message}`) }
        if (source.kind !== 'git') throw serviceError(source.error || `${repoId} 尚未关联 Git 仓库`)
        if (source.branch && source.branch === personalBranch) {
          const suggestedRef = await this.resolveSuggestedCheckoutRef(source.path, { remote, personalBranch })
          throw serviceError(formatPersonalBranchBlockMessage({
            repoId,
            personalBranch,
            sourcePath: source.path,
            suggestedRef,
            actionLabel: '再出包',
          }))
        }
        repoConfigs.set(repoId, {
          repo_id: repoId,
          source_path: source.path,
          personal_branch: personalBranch,
          remote_branch: remoteBranch,
          remote,
          pipeline_url: Object.hasOwn(settings, 'pipeline_url') ? (settings.pipeline_url || '') : null,
        })
      }
      const buildId = retryBuildId || randomUUID()
      const commitSubject = {
        id: buildId,
        restore_baseline: restoreBaseline,
        items: loadedTasks.map(entry => ({
          run_id: entry.record.run_id,
          task_id: entry.record.id,
          name: entry.record.name || entry.record.cases?.[0]?.title || entry.record.id,
        })),
      }
      const precheckTimeoutMs = input.precheck_timeout_ms ?? DEFAULT_REGEX_TIMEOUT_MS
      const savedDefaults = await this.readCommitDefaults(dataRoot)
      const detectedHookRegex = extractRemoteHookRegex(build?.error)
        || (/【问题单号|Commit message does not follow|pre-receive hook declined/i.test(build?.error || '') ? DEFAULT_INTRANET_COMMIT_REGEX : '')
      let desiredMessage
      let nextCommitConfig = build?.commit_config || null
      if (input.commit_config && typeof input.commit_config === 'object') {
        const normalizedConfig = normalizeCommitConfig(input.commit_config, build?.commit_config || savedDefaults)
        if (detectedHookRegex && !normalizedConfig.pattern) normalizedConfig.pattern = detectedHookRegex
        const checked = resolveCommitMessage(normalizedConfig, commitSubject, { timeoutMs: precheckTimeoutMs })
        if (!checked.ok) throw serviceError(checked.error)
        desiredMessage = checked.message
        await this.saveCommitDefaults(dataRoot, normalizedConfig)
        nextCommitConfig = normalizedConfig
      } else if (input.commit_message !== undefined && input.commit_message !== null) {
        const baseConfig = normalizeCommitConfig(build?.commit_config, savedDefaults)
        const activePattern = detectedHookRegex || (baseConfig.mode === 'default' ? baseConfig.pattern : (baseConfig.pattern || DEFAULT_INTRANET_COMMIT_REGEX))
        const checked = validateRawCommitMessage(String(input.commit_message), activePattern, { timeoutMs: precheckTimeoutMs })
        if (!checked.ok) throw serviceError(checked.error)
        desiredMessage = checked.message
      } else {
        const effectiveConfig = normalizeCommitConfig(build?.commit_config, savedDefaults)
        if (detectedHookRegex && !effectiveConfig.pattern) effectiveConfig.pattern = detectedHookRegex
        if (effectiveConfig.mode === 'default' && !effectiveConfig.custom_message && build?.commit_message && !/^(?:test: fault injection|revert: restore clean baseline)\b/.test(build.commit_message)) {
          effectiveConfig.custom_message = build.commit_message
        }
        const checked = resolveCommitMessage(effectiveConfig, commitSubject, { timeoutMs: precheckTimeoutMs })
        if (!checked.ok) throw serviceError(checked.error)
        desiredMessage = checked.message
        nextCommitConfig = effectiveConfig
      }
      const selectedRepoPipelines = targetRepoIds
        .map(repoId => ({ repo_id: repoId, pipeline_url: repoConfigs.get(repoId)?.pipeline_url || '' }))
        .filter(entry => Boolean(entry.pipeline_url))
      const fallbackSelectedPipeline = selectedRepoPipelines[0]?.pipeline_url || ''
      const configuredPipeline = input.pipeline_url !== undefined
        ? validateHttpPipelineUrl(input.pipeline_url)
        : (build?.pipeline_url ?? fallbackSelectedPipeline)
      if (input.pipeline_url !== undefined) {
        const buildsBase = await this.buildsRoot(dataRoot, { create: true })
        await writeTaskStoreFile(path.join(buildsBase, 'pipeline.json'), JSON.stringify({ pipeline_url: configuredPipeline }) + '\n')
      }
      buildDir = buildDir || await this.buildDirectory(dataRoot, buildId)
      if (!build) {
        build = {
          id: buildId,
          created_at: new Date().toISOString(),
          status: 'composing',
          ...(restoreBaseline ? { restore_baseline: true } : {}),
          items: loadedTasks.map(entry => ({
            run_id: entry.record.run_id,
            task_id: entry.record.id,
            name: entry.record.name || entry.record.cases?.[0]?.title || entry.record.id,
            created_at: entry.record.created_at,
            result_sha256: entry.resultSha256,
          })),
          repositories: targetRepoIds.map(repoId => {
            const cfg = repoConfigs.get(repoId)
            return {
              repo_id: repoId,
              source_path: cfg.source_path,
              base_commit: null,
              base_branch: '',
              personal_branch: cfg.personal_branch,
              remote: cfg.remote,
              remote_branch: cfg.remote_branch,
              remote_head: null,
              tree: null,
              commit: null,
              committed_message: null,
              pushed: false,
              push_result: null,
              applied: [],
              failures: [],
              ...(cfg.pipeline_url ? { pipeline_url: cfg.pipeline_url } : {}),
            }
          }),
          commit_message: desiredMessage,
          ...(nextCommitConfig ? { commit_config: nextCommitConfig } : {}),
          pipeline_url: configuredPipeline,
          repository_pipelines: selectedRepoPipelines,
          notices: [],
          error: null,
        }
      } else {
        build.commit_message = desiredMessage
        if (nextCommitConfig) build.commit_config = nextCommitConfig
        build.pipeline_url = configuredPipeline
        build.repository_pipelines = selectedRepoPipelines
        build.error = null
        delete build.error_code
        build.status = 'composing'
      }
      const controller = new AbortController()
      const bKey = this.buildKey(dataRoot, buildId)
      const operation = { controller, done: null, status: 'composing' }
      this.active.set(bKey, operation)
      const published = this.saveBuild(buildDir, build)
      operation.done = published.then(async () => {
        try {
          const signal = controller.signal
          // Phase A: compose clean detached baseline + apply selected tasks' edits per repository
          for (const repo of build.repositories) {
            signal.throwIfAborted()
            const checkout = path.join(buildDir, 'repositories', repo.repo_id)
            repo.checkout = checkout
            if (repo.pushed) continue
            let hasReusableTree = false
            if (repo.tree && repo.base_commit) {
              try { hasReusableTree = (await lstat(checkout)).isDirectory() } catch { hasReusableTree = false }
            }
            if (hasReusableTree) {
              continue
            }
            await repositoryOperation(dataRoot, repo.repo_id, async opSignal => {
              opSignal.throwIfAborted()
              const cfg = repoConfigs.get(repo.repo_id)
              const sourcePath = await realpath(cfg.source_path)
              const top = await this.git(sourcePath, ['rev-parse', '--show-toplevel'], opSignal)
              if (await realpath(top) !== sourcePath) throw serviceError(`请指定 Git 仓库根目录：${repo.repo_id}`)
              const baseBranch = await this.git(sourcePath, ['branch', '--show-current'], opSignal)
              if (baseBranch && baseBranch === cfg.personal_branch) {
                const suggestedRef = await this.resolveSuggestedCheckoutRef(sourcePath, { remote: cfg.remote, personalBranch: cfg.personal_branch, signal: opSignal })
                throw serviceError(formatPersonalBranchBlockMessage({
                  repoId: repo.repo_id,
                  personalBranch: cfg.personal_branch,
                  sourcePath,
                  suggestedRef,
                  actionLabel: '再出包',
                }))
              }
              const baseCommit = repo.base_commit || await this.git(sourcePath, ['rev-parse', '--verify', 'HEAD^{commit}'], opSignal)
              const remoteUrl = await this.git(sourcePath, ['remote', 'get-url', '--push', cfg.remote], opSignal)
              const ancestorInjections = await this.findAncestorInjectionCommits(dataRoot, repo.repo_id, sourcePath, baseCommit, opSignal)
              if (ancestorInjections.length) {
                const listed = ancestorInjections.slice(0, 5).map(item => `${item.commit.slice(0, 12)}（${item.source_type === 'build' ? `出包 ${item.source_id.slice(0, 8)}` : `旧任务 ${item.source_id.slice(0, 8)}`}）`).join('、')
                const notice = `${repo.repo_id}：当前分析目录 HEAD 含有历史打桩提交 ${listed}；宿主不会自动回退分析目录。`
                if (!build.notices.includes(notice)) build.notices.push(notice)
              }
              repo.source_path = sourcePath
              repo.base_commit = baseCommit
              repo.base_branch = baseBranch || ''
              repo.remote_url = remoteUrl
              repo.applied = []
              repo.failures = []
              await cloneIsolatedCheckout(this.git, buildDir, sourcePath, checkout, opSignal)
              for (const setting of ['user.name', 'user.email']) {
                try { const value = await this.git(sourcePath, ['config', '--get', setting], opSignal); if (value) await this.git(checkout, ['config', setting, value], opSignal) }
                catch { if (opSignal.aborted) throw opSignal.reason }
              }
              await this.git(checkout, ['remote', 'set-url', 'origin', remoteUrl], opSignal)
              await this.git(checkout, ['checkout', '--detach', baseCommit], opSignal)
              const touchedBy = new Map()
              const baseSnapshots = new Map()
              const allFiles = new Set()
              const mergeTmpDir = path.join(buildDir, '.merge-tmp')
              const readRepoTextAt = async (commit, relPath, fallbackEol = '\n') => {
                if (commit === baseCommit && baseSnapshots.has(relPath)) return baseSnapshots.get(relPath)
                try {
                  const raw = await this.git(checkout, ['show', `${commit}:${relPath}`], opSignal)
                  return raw ? (raw.endsWith(fallbackEol) ? raw : raw + fallbackEol) : raw
                } catch (err) {
                  if (opSignal.aborted) throw err
                  return null
                }
              }
              for (const entry of loadedTasks) {
                const edits = entry.edits.filter(edit => edit.repo_id === repo.repo_id)
                if (!edits.length) continue
                try {
                  for (const edit of edits) {
                    const attributes = await this.git(checkout, ['check-attr', '-z', 'filter', '--', edit.path], opSignal)
                    if (attributes.split('\0')[2] === 'lfs') throw serviceError(`不支持修改 LFS 文件：${edit.path}`)
                  }
                  const root = await realpath(checkout)
                  for (const edit of edits) {
                    const norm = posixPath(edit?.path || '')
                    if (!norm || baseSnapshots.has(norm) || touchedBy.has(norm)) continue
                    const targetFile = path.resolve(root, norm)
                    if (inside(root, targetFile)) {
                      const snap = await readFile(targetFile, 'utf8').catch(err => (err.code === 'ENOENT' ? null : undefined))
                      if (snap !== undefined) baseSnapshots.set(norm, snap)
                    }
                  }
                  const hasOverlap = edits.some(edit => touchedBy.has(posixPath(edit?.path || '')))
                  let files
                  if (!hasOverlap) {
                    files = await applyInjectionEdits(checkout, edits)
                  } else {
                    const taskBaseCommit = entry.record.repositories?.find(r => r.repo_id === repo.repo_id)?.base_commit || baseCommit
                    const byFile = new Map()
                    for (const edit of edits) {
                      const norm = posixPath(edit?.path || '')
                      if (!byFile.has(norm)) byFile.set(norm, [])
                      byFile.get(norm).push(edit)
                    }
                    const mergedStage = new Map()
                    for (const [norm, fileEdits] of byFile) {
                      const oursContent = await readSafeRepoFile(root, norm)
                      if (!touchedBy.has(norm)) {
                        const direct = applyFileEditsToText(norm, oursContent, fileEdits)
                        if (IS_CMAKE_FILE.test(norm)) checkCmakeSyntax(direct, norm)
                        mergedStage.set(norm, direct)
                      } else {
                        const fallbackEol = typeof oursContent === 'string' && oursContent.includes('\r\n') ? '\r\n' : '\n'
                        const baseContent = await readRepoTextAt(taskBaseCommit, norm, fallbackEol)
                        const theirsContent = applyFileEditsToText(norm, baseContent, fileEdits)
                        const merged = await mergeFileContent(this.git, checkout, mergeTmpDir, norm, { baseContent, oursContent, theirsContent }, opSignal)
                        mergedStage.set(norm, merged)
                      }
                    }
                    for (const [norm, content] of mergedStage) {
                      const targetFile = path.join(root, norm)
                      await mkdir(path.dirname(targetFile), { recursive: true })
                      await writeFile(targetFile, content, 'utf8')
                    }
                    files = [...mergedStage.keys()]
                  }
                  repo.applied.push({ task_id: entry.record.id, run_id: entry.record.run_id, name: entry.record.name || entry.record.id, files })
                  for (const file of files) {
                    const norm = posixPath(file)
                    allFiles.add(norm)
                    if (!touchedBy.has(norm)) touchedBy.set(norm, [])
                    touchedBy.get(norm).push(entry.record)
                  }
                } catch (applyErr) {
                  opSignal.throwIfAborted()
                  const overlaps = [...new Set(edits.flatMap(edit => {
                    const norm = posixPath(edit?.path || '')
                    return (touchedBy.get(norm) || []).map(other => `「${other.name || other.id}」（${norm}）`)
                  }))]
                  const overlapHint = overlaps.length ? `；与已应用的打桩任务修改同一文件冲突：${overlaps.join('、')}` : ''
                  repo.failures.push({
                    task_id: entry.record.id,
                    run_id: entry.record.run_id,
                    name: entry.record.name || entry.record.id,
                    error: `${cleanError(applyErr)}${overlapHint}`,
                  })
                }
              }
              await rm(mergeTmpDir, { recursive: true, force: true }).catch(() => {})
              if (!repo.failures.length) {
                if (allFiles.size) await this.git(checkout, ['add', '--', ...allFiles], opSignal)
                repo.tree = (await this.git(checkout, ['write-tree'], opSignal)).trim()
              }
              await this.saveBuild(buildDir, build)
            }, { wait: true, signal })
          }
          const failedRepos = build.repositories.filter(repo => repo.failures?.length)
          if (failedRepos.length) {
            build.status = 'failed'
            const details = failedRepos.flatMap(repo => repo.failures.map(item => `${repo.repo_id} · 任务「${item.name}」：${item.error}`))
            build.error = `共有 ${details.length} 项补丁失配，本次未生成提交且未推送：\n${details.join('\n')}`
            await this.saveBuild(buildDir, build)
            await rm(path.join(buildDir, 'repositories'), { recursive: true, force: true })
            return build
          }
          // Phase B: inside branchExclusive, fetch remote personal branch, synthesize commit-tree, and fast-forward push
          operation.status = 'pushing'
          build.status = 'pushing'
          const priorDivergedRepo = build.remote_diverged_repo || ''
          const priorDivergedHead = build.remote_diverged_head || ''
          delete build.remote_diverged_repo
          delete build.remote_diverged_head
          delete build.remote_diverged_commits
          await this.saveBuild(buildDir, build)
          await this.branchExclusive(build, async lockSignal => {
            const msgFile = path.join(buildDir, 'commit-message.txt')
            await writeFile(msgFile, desiredMessage, 'utf8')
            // Pass 1: verify settings, fetch remote head, reconcile or synthesize commit-tree for every unfinished repository
            for (const repo of build.repositories) {
              lockSignal.throwIfAborted()
              if (repo.pushed) continue
              const configured = await readRepositorySettings(dataRoot, repo.repo_id)
              const configuredPath = await realpath(configured.git_path || path.join(dataRoot, 'repositories', repo.repo_id))
              if (configuredPath !== repo.source_path) throw serviceError(`${repo.repo_id}：仓库目录已变更，请重新发起出包`)
              const personalBranch = configured.personal_branch || ''
              const remoteBranch = configured.remote_branch || personalBranch
              if (personalBranch !== repo.personal_branch || remoteBranch !== repo.remote_branch) {
                throw serviceError(`${repo.repo_id}：个人分支配置已变更，请重新发起出包`)
              }
              const forbidden = protectedBranchReason(personalBranch) || protectedBranchReason(remoteBranch)
              if (forbidden) throw serviceError(`${repo.repo_id}：${forbidden}；本次不会提交或推送`)
              const currentBranch = await this.git(repo.source_path, ['branch', '--show-current'], lockSignal)
              if (currentBranch && currentBranch === personalBranch) {
                const suggestedRef = await this.resolveSuggestedCheckoutRef(repo.source_path, {
                  remote: configured.remote || repo.remote || 'origin',
                  personalBranch,
                  signal: lockSignal,
                })
                throw serviceError(formatPersonalBranchBlockMessage({
                  repoId: repo.repo_id,
                  personalBranch,
                  sourcePath: repo.source_path,
                  suggestedRef,
                  actionLabel: '再出包',
                }))
              }
              const sourceRemote = configured.remote || 'origin'
              let sourcePushUrls = []
              try {
                sourcePushUrls = (await this.git(repo.source_path, ['remote', 'get-url', '--push', '--all', sourceRemote], lockSignal))
                  .split(/\r?\n/).map(line => line.trim()).filter(Boolean)
              } catch {
                lockSignal.throwIfAborted()
                const single = (await this.git(repo.source_path, ['remote', 'get-url', '--push', sourceRemote], lockSignal)).trim()
                if (single) sourcePushUrls = [single]
              }
              const uniqueSourcePushUrls = [...new Set(sourcePushUrls)]
              if (uniqueSourcePushUrls.length !== 1) {
                throw serviceError(`${repo.repo_id}：无法确认远端 ${sourceRemote} 的唯一推送地址（发现 ${uniqueSourcePushUrls.length} 个），已停止推送`)
              }
              const remoteUrl = uniqueSourcePushUrls[0]
              const readCheckoutPushUrls = async () => {
                try {
                  return (await this.git(repo.checkout, ['remote', 'get-url', '--push', '--all', 'origin'], lockSignal))
                    .split(/\r?\n/).map(line => line.trim()).filter(Boolean)
                } catch {
                  lockSignal.throwIfAborted()
                  try {
                    const single = (await this.git(repo.checkout, ['remote', 'get-url', '--push', 'origin'], lockSignal)).trim()
                    return single ? [single] : []
                  } catch {
                    lockSignal.throwIfAborted()
                    return []
                  }
                }
              }
              const checkoutPushUrls = await readCheckoutPushUrls()
              const checkoutMatches = checkoutPushUrls.length === 1 && checkoutPushUrls[0] === remoteUrl
              if (!checkoutMatches || remoteUrl !== repo.remote_url) {
                await this.git(repo.checkout, ['remote', 'set-url', 'origin', remoteUrl], lockSignal)
                try { await this.git(repo.checkout, ['config', '--local', '--unset-all', 'remote.origin.pushurl'], lockSignal) }
                catch { lockSignal.throwIfAborted() }
                if (checkoutPushUrls.length && !checkoutMatches) {
                  repo.remote_head = null
                  repo.commit = null
                  repo.committed_message = null
                }
                repo.remote_url = remoteUrl
                await this.saveBuild(buildDir, build)
              }
              const effectivePushUrls = await readCheckoutPushUrls()
              const originPushMatches = effectivePushUrls.length === 1 && effectivePushUrls[0] === remoteUrl
              let originFetchMatches = originPushMatches
              if (originFetchMatches) {
                try {
                  const fetchUrl = (await this.git(repo.checkout, ['remote', 'get-url', 'origin'], lockSignal)).trim()
                  originFetchMatches = fetchUrl === remoteUrl
                } catch {
                  lockSignal.throwIfAborted()
                  originFetchMatches = false
                }
              }
              const gitFetchTarget = originFetchMatches ? 'origin' : remoteUrl
              const gitPushTarget = originPushMatches ? 'origin' : remoteUrl
              repo.effective_push_target = gitPushTarget
              try {
                await this.git(repo.checkout, ['fetch', '--no-tags', gitFetchTarget, `refs/heads/${repo.remote_branch}`], lockSignal)
              } catch (fetchError) {
                lockSignal.throwIfAborted()
                if (/couldn't find remote ref|not found/i.test(String(fetchError?.message || ''))) {
                  throw serviceError(`${repo.repo_id}：远端 ${repo.remote} 上不存在个人分支 ${repo.remote_branch}，请先在远端创建该分支`)
                }
                throw fetchError
              }
              const remoteHead = (await this.git(repo.checkout, ['rev-parse', 'FETCH_HEAD'], lockSignal)).trim()
              if (repo.commit) {
                let delivered = remoteHead === repo.commit
                if (!delivered) {
                  try { delivered = await this.git(repo.checkout, ['merge-base', repo.commit, remoteHead], lockSignal) === repo.commit }
                  catch { lockSignal.throwIfAborted() }
                }
                if (delivered) {
                  repo.remote_head = remoteHead
                  repo.pushed = true
                  repo.push_result = 'confirmed'
                  await this.saveBuild(buildDir, build)
                  continue
                }
              }
              const remoteTree = (await this.git(repo.checkout, ['rev-parse', `${remoteHead}^{tree}`], lockSignal)).trim()
              if (remoteTree === repo.tree) {
                repo.remote_head = remoteHead
                repo.commit = remoteHead
                repo.pushed = true
                repo.push_result = 'unchanged'
                await this.saveBuild(buildDir, build)
                continue
              }
              if (!repo.commit || repo.remote_head !== remoteHead || repo.committed_message !== desiredMessage) {
                if (remoteHead !== repo.base_commit) {
                  const knownSet = new Set((await this.collectRecordedInjectionCommits(dataRoot, repo.repo_id, { includeRestore: true, limit: Infinity })).map(item => item.commit))
                  const pageSize = 200
                  const maxScanCommits = 2000
                  const unknownCommits = []
                  let scanned = 0
                  let historyTruncated = false
                  while (true) {
                    let rawPage = ''
                    try {
                      rawPage = await this.git(
                        repo.checkout,
                        ['log', `--skip=${scanned}`, `--max-count=${pageSize}`, '--format=%H\t%s', `${repo.base_commit}..${remoteHead}`],
                        lockSignal,
                      )
                    } catch (logError) {
                      lockSignal.throwIfAborted()
                      throw Object.assign(
                        serviceError(`${repo.repo_id}：无法读取远端分支 ${repo.remote_branch} 的分叉提交历史，已停止推送以避免覆盖人工提交（${cleanError(logError)}）`, 409),
                        { code: 'REMOTE_HISTORY_UNREADABLE' },
                      )
                    }
                    const pageLines = rawPage ? rawPage.split(/\r?\n/).filter(Boolean) : []
                    if (!pageLines.length) break
                    for (const line of pageLines) {
                      const tab = line.indexOf('\t')
                      const entry = tab > 0
                        ? { commit: line.slice(0, tab).trim(), subject: line.slice(tab + 1).trim() }
                        : { commit: line.trim(), subject: '' }
                      if (entry.commit && !knownSet.has(entry.commit)) unknownCommits.push(entry)
                    }
                    scanned += pageLines.length
                    if (pageLines.length < pageSize) break
                    if (scanned >= maxScanCommits) {
                      historyTruncated = true
                      break
                    }
                  }
                  if (historyTruncated && unknownCommits.length === 0) {
                    throw Object.assign(
                      serviceError(`${repo.repo_id}：远端分支 ${repo.remote_branch} 分叉提交超过可核实上限（${maxScanCommits} 条），已停止推送以避免静默覆盖较早的人工提交`, 409),
                      { code: 'REMOTE_HISTORY_UNREADABLE' },
                    )
                  }
                  if (unknownCommits.length) {
                    const summary = unknownCommits.slice(0, 5).map(item => `${item.commit.slice(0, 10)}${item.subject ? ` ${item.subject}` : ''}`).join('；')
                    const confirmedMap = {
                      ...(build.confirmed_remote_diverged && typeof build.confirmed_remote_diverged === 'object' ? build.confirmed_remote_diverged : {}),
                      ...(input.confirmed_remote_diverged && typeof input.confirmed_remote_diverged === 'object' ? input.confirmed_remote_diverged : {}),
                    }
                    if (input.allow_overwrite_remote_diverged === true && priorDivergedRepo && priorDivergedHead) {
                      confirmedMap[priorDivergedRepo] = priorDivergedHead
                    }
                    const confirmedHead = typeof confirmedMap[repo.repo_id] === 'string' ? confirmedMap[repo.repo_id].trim() : ''
                    if (confirmedHead && confirmedHead === remoteHead) {
                      build.confirmed_remote_diverged = confirmedMap
                      const notice = `${repo.repo_id}：已按用户显式确认覆盖远端分支 ${repo.remote_branch}（HEAD ${remoteHead.slice(0, 10)}）上的 ${unknownCommits.length} 个非 PANGEA 提交（${summary}）。`
                      if (!build.notices.includes(notice)) build.notices.push(notice)
                    } else {
                      build.confirmed_remote_diverged = confirmedMap
                      build.remote_diverged_repo = repo.repo_id
                      build.remote_diverged_head = remoteHead
                      build.remote_diverged_commits = unknownCommits.slice(0, 10)
                      await this.saveBuild(buildDir, build)
                      throw Object.assign(
                        serviceError(`${repo.repo_id}：远端分支 ${repo.remote_branch}（HEAD ${remoteHead.slice(0, 10)}）存在 ${unknownCommits.length} 个未合入当前基线且非 PANGEA 打桩产生的提交（${summary}）。推送将把该分支树同步为当前基线与所选桩代码；请改用专用打桩构建分支，或显式确认覆盖后重试。`, 409),
                        { code: 'REMOTE_BRANCH_DIVERGED', diverged_repo: repo.repo_id, diverged_head: remoteHead, diverged_commits: unknownCommits.slice(0, 10) },
                      )
                    }
                  }
                }
                let baseIsAncestor = remoteHead === repo.base_commit
                if (!baseIsAncestor) {
                  try { baseIsAncestor = await this.git(repo.checkout, ['merge-base', repo.base_commit, remoteHead], lockSignal) === repo.base_commit }
                  catch { lockSignal.throwIfAborted() }
                }
                const parents = ['-p', remoteHead, ...(baseIsAncestor ? [] : ['-p', repo.base_commit])]
                const author = ['-c', 'commit.gpgsign=false']
                for (const [name, fallback] of [['user.name', 'PANGEA'], ['user.email', 'pangea@localhost']]) {
                  try { await this.git(repo.checkout, ['config', '--get', name], lockSignal) }
                  catch { lockSignal.throwIfAborted(); author.push('-c', `${name}=${fallback}`) }
                }
                const commit = (await this.git(repo.checkout, [...author, 'commit-tree', repo.tree, ...parents, '-F', msgFile], lockSignal)).trim()
                repo.remote_head = remoteHead
                repo.commit = commit
                repo.committed_message = desiredMessage
                await this.saveBuild(buildDir, build)
              }
            }
            // Pass 2: plain fast-forward push to remote personal branch (never writes local source_path)
            for (const repo of build.repositories) {
              lockSignal.throwIfAborted()
              if (repo.pushed) continue
              build.current_repository = repo.repo_id
              repo.push_result = 'unconfirmed'
              await this.saveBuild(buildDir, build)
              const pushTarget = repo.effective_push_target || 'origin'
              try {
                await this.git(repo.checkout, ['push', pushTarget, `${repo.commit}:refs/heads/${repo.remote_branch}`], lockSignal)
              } catch (pushError) {
                if (isRemotePushRejected(pushError) || /non-fast-forward|fetch first/i.test(String(pushError?.stderr || pushError?.message || ''))) {
                  repo.push_result = 'rejected'
                  await this.saveBuild(buildDir, build)
                }
                throw pushError
              }
              repo.pushed = true
              repo.push_result = 'confirmed'
              await this.saveBuild(buildDir, build)
            }
          }, controller.signal, dataRoot)
          delete build.current_repository
          delete build.remote_diverged_repo
          delete build.remote_diverged_head
          delete build.remote_diverged_commits
          build.status = 'pushed'
          build.error = null
          await this.saveBuild(buildDir, build)
          await rm(path.join(buildDir, 'repositories'), { recursive: true, force: true })
          await rm(path.join(buildDir, 'commit-message.txt'), { force: true })
          return build
        } catch (error) {
          delete build.current_repository
          build.status = controller.signal.aborted ? 'cancelled' : 'failed'
          if (error.code === 'REMOTE_BRANCH_DIVERGED' || error.code === 'REMOTE_HISTORY_UNREADABLE') build.error_code = error.code
          const rawErr = cleanError(error)
          const unconfirmed = build.repositories.some(repo => !repo.pushed && repo.push_result === 'unconfirmed')
          const nonFastForward = build.repositories.some(repo => !repo.pushed && repo.push_result === 'rejected') && /non-fast-forward|fetch first/i.test(rawErr)
          build.error = (unconfirmed ? '推送结果待确认；重试本次出包时将先本地校验提交信息合规，再查询远端决定确认或重推。\n' : '')
            + (controller.signal.aborted ? '出包操作已停止，可重试本次出包' : rawErr)
            + (nonFastForward ? '\n远端个人分支已被推进；重试本次出包将以新的远端分支头重新合成提交。' : '')
          await this.saveBuild(buildDir, build)
          return build
        }
      }).finally(() => this.active.delete(bKey))
      if (background) operation.done.catch(() => {})
      await published
      if (background) {
        const { repositories, ...rest } = build
        return structuredClone({ ...rest, repositories: repositories.map(({ checkout, remote_url, ...repo }) => repo) })
      }
      const completed = await operation.done
      const { repositories, ...rest } = completed
      return { ...rest, repositories: repositories.map(({ checkout, remote_url, ...repo }) => repo) }
    }
    return retryBuildId ? this.buildExclusive(dataRoot, retryBuildId, runBuild) : runBuild()
  }
  async cancelBuild(dataRoot, buildId) {
    const operation = this.active.get(this.buildKey(dataRoot, buildId))
    if (operation) { operation.controller.abort(new Error('用户停止出包任务')); await operation.done }
    return this.readBuild(dataRoot, buildId)
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
        delivery_mode: previous.delivery_mode, build_variant: previous.build_variant,
        pipeline_url: previous.pipeline_url, name: previous.name,
        ...(mode === 'reuse' ? { reuse_task_id: taskId } : mode === 'reference' ? { reference_task_id: taskId, reference_error: previous.error || '' } : {}) } }, { requireReceipt: false })
  }
  async recordVerification(dataRoot, runId, taskId, input) {
    return this.exclusive(dataRoot, runId, taskId, async () => {
      const record = await this.read(dataRoot, runId, taskId)
      const pushedBuilds = Array.isArray(record.pushed_builds) ? record.pushed_builds : (record.latest_pushed_build ? [record.latest_pushed_build] : [])
      const legacyCommits = (record.repositories || []).filter(repo => repo.commit).map(repo => ({ repo_id: repo.repo_id, commit: repo.commit }))
      const requestedBuildId = String(input?.build_id || input?.build?.build_id || '').trim() || null
      let selectedBuild = null
      if (requestedBuildId) {
        selectedBuild = pushedBuilds.find(b => b.build_id === requestedBuildId) || null
        if (!selectedBuild) {
          throw serviceError(`指定的构建 ${requestedBuildId} 不存在或未包含本打桩任务的已推送记录`)
        }
      } else if (pushedBuilds.length === 1) {
        selectedBuild = pushedBuilds[0]
      } else if (pushedBuilds.length > 1) {
        throw serviceError(`本打桩任务存在 ${pushedBuilds.length} 个已推送构建（${pushedBuilds.slice(0, 3).map(b => b.build_id).join('、')}），请显式指定本次验证对应的构建 build_id，不能自动推定为最新构建`)
      }
      const commits = selectedBuild?.commits?.length ? selectedBuild.commits : legacyCommits
      if (!commits.length) throw serviceError('请先将本打桩任务加入出包并推送到个人分支，再记录验证结果')
      const buildId = selectedBuild?.build_id || null
      const sameBuild = Boolean(buildId ? record.build?.build_id === buildId : !record.build?.build_id)
      const recordedForBuild = buildId
        ? (record.build_metadata?.[buildId]
          || [...(record.verification || [])].reverse().find(entry => entry?.build?.build_id === buildId)?.build
          || null)
        : null
      const prevBuild = sameBuild ? record.build : recordedForBuild
      const {
        url = prevBuild?.url || selectedBuild?.pipeline_url || '',
        package_id = prevBuild?.package_id || '',
        package_sha256 = prevBuild?.package_sha256 || '',
        notes = prevBuild?.notes || '',
      } = input.build || {}
      if (url && !/^https?:\/\//i.test(url)) throw serviceError('构建链接必须是 HTTP/HTTPS 地址')
      const buildSnapshot = {
        ...(buildId ? { build_id: buildId } : {}),
        url: String(url),
        package_id: String(package_id),
        package_sha256: String(package_sha256),
        notes: String(notes),
        commits: structuredClone(commits),
      }
      record.build = buildSnapshot
      if (buildId) {
        record.build_metadata = {
          ...(record.build_metadata && typeof record.build_metadata === 'object' ? record.build_metadata : {}),
          [buildId]: structuredClone(buildSnapshot),
        }
      }
      if (input.verification) {
        const value = input.verification
        if (!record.case_keys.includes(value.case_key) || !['not_run', 'passed', 'failed', 'not_triggered'].includes(value.result)) throw serviceError('验证用例或结果无效')
        const executionStatus = ['completed', 'infra_error', 'not_run'].includes(value.execution_status)
          ? value.execution_status
          : (value.result === 'not_run' ? 'not_run' : 'completed')
        const riskVerdict = ['confirmed', 'excluded', 'not_triggered', 'blocked', 'unknown'].includes(value.risk_verdict)
          ? value.risk_verdict
          : (value.result === 'failed' ? 'confirmed' : value.result === 'passed' ? 'excluded' : value.result === 'not_triggered' ? 'not_triggered' : 'blocked')
        const validCombo = (
          (value.result === 'passed' && executionStatus === 'completed' && riskVerdict === 'excluded')
          || (value.result === 'failed' && ((executionStatus === 'completed' && riskVerdict === 'confirmed') || (executionStatus === 'infra_error' && ['unknown', 'blocked'].includes(riskVerdict))))
          || (value.result === 'not_triggered' && executionStatus === 'completed' && riskVerdict === 'not_triggered')
          || (value.result === 'not_run' && executionStatus === 'not_run' && ['blocked', 'unknown'].includes(riskVerdict))
        )
        if (!validCombo) {
          throw serviceError(`验证结果与风险结论组合无效：result=${value.result}, execution_status=${executionStatus}, risk_verdict=${riskVerdict}`)
        }
        record.verification.push({
          case_key: value.case_key,
          result: value.result,
          execution_status: executionStatus,
          risk_verdict: riskVerdict,
          notes: String(value.notes || ''),
          hits: String(value.hits || ''),
          build: structuredClone(buildSnapshot),
          at: new Date().toISOString(),
        })
      }
      const persisted = { ...record }
      delete persisted.latest_build
      delete persisted.latest_pushed_build
      delete persisted.pushed_builds
      await this.save(await this.directory(dataRoot, runId, taskId), persisted)
      return { ...persisted, latest_build: record.latest_build, latest_pushed_build: record.latest_pushed_build, pushed_builds: record.pushed_builds }
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
