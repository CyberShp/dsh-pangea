import { randomUUID } from 'node:crypto'
import { realpath, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const previews = new Map(), lifetime = 10 * 60 * 1000
const fail = (statusCode, message) => Object.assign(new Error(message), { statusCode })
const inside = (root, candidate) => { const value = path.relative(root, candidate); return value === '' || value !== '..' && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value) }

async function repositoryRoot(dataRoot, repository) {
  if (typeof repository !== 'string' || !repository || /[\\/\0]/.test(repository) || ['.', '..'].includes(repository) || path.win32.parse(repository).root) throw fail(400, '仓库无效')
  const parent = await realpath(path.join(dataRoot, 'repositories')), root = await realpath(path.join(parent, repository))
  if (root === parent || !inside(parent, root)) throw fail(403, '仓库越出受控目录')
  return root
}
async function resolveEntry(root, input) {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw fail(400, '源码路径无效')
  const value = input.trim().replaceAll('\\', '/')
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || path.win32.parse(value).root || value.split('/').includes('..')) throw fail(403, '请选择仓库内相对目录，不能使用绝对路径或上级路径')
  let candidate
  try { candidate = await realpath(path.resolve(root, value)) }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) throw fail(400, '源码目录不存在'); throw error }
  if (!inside(root, candidate)) throw fail(403, '源码范围越出仓库边界')
  const info = await stat(candidate)
  return { path: path.relative(root, candidate).split(path.sep).join('/') || '.', kind: info.isDirectory() ? 'directory' : 'file' }
}
export async function validateScope({ dataRoot, repository, source_scope }) {
  if (!Array.isArray(source_scope) || !source_scope.length) throw fail(400, '请选择源码范围')
  const root = await repositoryRoot(dataRoot, repository)
  const entries = await Promise.all(source_scope.map(value => resolveEntry(root, value)))
  if (entries.some(item => item.path === '.' || item.kind !== 'directory')) throw fail(400, '请选择真实存在的非根下级目录，不能选择整个仓库或文件')
  const normalized_scope = [...new Set(entries.map(item => item.path))].sort()
  return { status: 'ok', normalized_scope, selected_entry_count: normalized_scope.length, entries }
}
export async function scopeTree({ dataRoot, repository, path: relative = '.', cursor = 0, limit = 100 }) {
  const root = await repositoryRoot(dataRoot, repository), entry = await resolveEntry(root, relative)
  if (entry.kind !== 'directory') throw fail(400, '请选择目录')
  const directory = path.resolve(root, entry.path)
  const names = (await readdir(directory, { withFileTypes: true })).sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name, 'zh-CN'))
  const offset = Number(cursor), size = Math.min(200, Math.max(1, Number(limit) || 100))
  if (!Number.isSafeInteger(offset) || offset < 0) throw fail(400, '分页位置无效')
  const entries = await Promise.all(names.slice(offset, offset + size).map(async item => {
    const relativePath = path.relative(root, path.join(directory, item.name)).split(path.sep).join('/')
    try { const resolved = await resolveEntry(root, relativePath); return { name: item.name, ...resolved, selectable: resolved.kind === 'directory' && resolved.path !== '.' } }
    catch { return { name: item.name, path: relativePath, kind: item.isDirectory() ? 'directory' : 'file', selectable: false } }
  }))
  return { status: 'ok', repository, path: entry.path, entries, cursor: offset, total_entries: names.length, next_cursor: offset + entries.length, has_more: offset + entries.length < names.length }
}
function paginate(record, input) {
  const offset = Number(input.cursor || 0), size = Math.min(200, Math.max(1, Number(input.limit) || 50))
  if (!Number.isSafeInteger(offset) || offset < 0) throw fail(400, '分页位置无效')
  return { status: 'ok', ...record.value, preview_id: record.id, scanned_at: record.scannedAt,
    files: record.value.files.slice(offset, offset + size), next_cursor: offset + size,
    has_more: offset + size < record.value.files.length }
}
export async function previewScope(input, runner) {
  const validated = await validateScope(input), root = await realpath(input.dataRoot)
  const key = JSON.stringify([root, input.repository, validated.normalized_scope])
  for (const [id, record] of previews) if (Date.now() - record.created > lifetime) previews.delete(id)
  if (input.preview_id) {
    const record = previews.get(input.preview_id)
    if (!record || record.key !== key) throw fail(409, '范围预览已失效，请重新预览')
    return paginate(record, input)
  }
  const value = await runner({ cwd: input.cwd, args: ['source-scope-preview', '--data-root', root, '--repository', input.repository, '--source-scope', JSON.stringify(validated.normalized_scope)] })
  if (value.preview_state !== 'complete' || !Array.isArray(value.files) || value.matched_file_count !== value.files.length || !value.scope_revision) throw fail(422, '范围预览未完整完成，请检查源码读取诊断')
  if (previews.size >= 100) previews.delete(previews.keys().next().value)
  const record = { id: randomUUID(), key, created: Date.now(), scannedAt: new Date().toISOString(), value: { ...value, is_entire_repository: validated.normalized_scope.includes('.') } }
  previews.set(record.id, record)
  return paginate(record, input)
}
export async function confirmScope(input, runner) {
  const prior = await previewScope({ ...input, preview_id: input.scope_preview_id }, runner)
  if (!input.scope_preview_id || !input.expected_scope_revision || input.expected_scope_revision !== prior.scope_revision) throw fail(409, '请重新预览并确认源码范围')
  const current = await previewScope({ ...input, preview_id: undefined }, runner)
  if (current.scope_revision !== prior.scope_revision) throw fail(409, '源码文件集合已变化，请重新预览并确认范围')
  if (!current.matched_file_count) throw fail(422, '范围中没有可分析的源码文件')
  return current
}

// Tool references have a separate receipt and never enlarge source_scope.
export async function previewTestTools(input, runner) {
  if (!Array.isArray(input.test_tool_sources) || !input.test_tool_sources.length) throw fail(400, '请选择测试工具代码')
  const sources = []
  for (const source of input.test_tool_sources) {
    const checked = await validateScope({ dataRoot: input.dataRoot, repository: source.repo_id, source_scope: source.paths })
    sources.push({ repo_id: source.repo_id, paths: checked.normalized_scope })
  }
  const root = await realpath(input.dataRoot)
  const key = JSON.stringify(['test-tools', root, sources])
  for (const [id, record] of previews) if (Date.now() - record.created > lifetime) previews.delete(id)
  if (input.preview_id) {
    const record = previews.get(input.preview_id)
    if (!record || record.key !== key) throw fail(409, '工具参考预览已失效，请重新预览')
    return paginate(record, input)
  }
  const value = await runner({ cwd: input.cwd, args: ['test-tool-scope-preview', '--data-root', root, '--test-tool-sources', JSON.stringify(sources)] })
  if (value.preview_state !== 'complete' || !Array.isArray(value.files) || value.matched_file_count !== value.files.length || !value.scope_revision) throw fail(422, '工具参考预览未完整完成')
  if (previews.size >= 100) previews.delete(previews.keys().next().value)
  const record = { id: randomUUID(), key, created: Date.now(), scannedAt: new Date().toISOString(), value }
  previews.set(record.id, record)
  return paginate(record, input)
}
export async function confirmTestTools(input, runner) {
  const prior = await previewTestTools({ ...input, preview_id: input.test_tool_preview_id }, runner)
  if (!input.test_tool_preview_id || input.expected_test_tool_revision !== prior.scope_revision) throw fail(409, '请重新预览并确认测试工具代码')
  const current = await previewTestTools({ ...input, preview_id: undefined }, runner)
  if (current.scope_revision !== prior.scope_revision) throw fail(409, '工具参考文件集合已变化，请重新预览')
  if (!current.matched_file_count) throw fail(422, '工具参考范围没有可读取文件')
  return current
}
