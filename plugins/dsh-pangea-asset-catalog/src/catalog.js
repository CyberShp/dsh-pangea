import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { NORMALIZABLE_SUFFIXES, normalizeDocument } from './normalize.js'

const OUTPUT_DIR = 'asset-catalog'
const MAX_TEXT_BYTES = 1024 * 1024
const MAX_FILES = 5000
const TEXT_SUFFIXES = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.lua', '.toml', '.ini', '.cfg', '.conf',
])
const DISCOVERABLE_SUFFIXES = new Set([...TEXT_SUFFIXES, ...NORMALIZABLE_SUFFIXES])
const IGNORED_PARTS = new Set(['.git', 'node_modules', '__pycache__', 'build', 'dist', '.pangea', OUTPUT_DIR])
const ALLOWED_ROLES = new Set([
  'input_candidate', 'semantic_reference', 'example_reference', 'methodology_candidate',
  'automation_capability', 'unclassified',
])

function cleanText(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

function unique(values) {
  return [...new Set(values.filter(Boolean))]
}

function limited(values, size = 40) {
  return unique(values).slice(0, size)
}

function relativeLocation(relative, line) {
  return line ? `${relative}:${line}` : relative
}

function safeId(prefix, relative) {
  const value = relative.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 96)
  return `${prefix}-${value || 'asset'}`
}

function lineRecords(text) {
  return text.split(/\r?\n/).map((value, index) => ({ number: index + 1, text: value }))
}

function firstSummary(lines) {
  for (const line of lines) {
    const value = line.text.trim()
    if (!value || value.startsWith('#') || value.startsWith('<!--')) continue
    return value.replace(/^[-*]\s+/, '').slice(0, 240)
  }
  return ''
}

function inferKind(relative, text) {
  const sample = `${relative}\n${text.slice(0, 8000)}`.toLowerCase()
  if (/\b(requirements?|req[-_ ])/i.test(sample) || /需求|验收标准/.test(sample)) return 'requirement'
  if (/\b(design|architecture|specification)\b/i.test(sample) || /设计|架构/.test(sample)) return 'design'
  if (/\b(protocol|rfc|nvme|iscsi)\b/i.test(sample) || /协议/.test(sample)) return 'protocol'
  if (/test[ _-]?case|测试用例|测试步骤|预期结果/i.test(sample)) return 'existing_test'
  if (/test[ _-]?report|测试报告|分析报告/i.test(sample)) return 'report'
  if (/incident|故障复盘|事故记录/i.test(sample)) return 'incident'
  if (/methodology|rubric|方法论|检查清单/i.test(sample)) return 'methodology'
  return 'material'
}

function materialAnalysis(relative, text, override = undefined) {
  const lines = lineRecords(text)
  const headings = lines
    .filter(line => /^#{1,6}\s+\S/.test(line.text))
    .map(line => ({ title: line.text.replace(/^#{1,6}\s+/, '').trim(), location: relativeLocation(relative, line.number) }))
  const requirements = []
  const symbols = []
  const declaredRestrictions = []
  const methodologyPoints = []
  for (const line of lines) {
    const requirementIds = line.text.match(/\b(?:REQ|SPEC|DESIGN|AC)-[A-Z0-9][A-Z0-9-]*\b/gi) ?? []
    for (const id of requirementIds) requirements.push({ id: id.toUpperCase(), text: line.text.trim(), location: relativeLocation(relative, line.number) })
    for (const match of line.text.matchAll(/`([^`]{1,120})`/g)) {
      if (/^[A-Za-z_][A-Za-z0-9_.:>-]*(?:\([^)]*\))?$/.test(match[1])) symbols.push(match[1].replace(/\([^)]*\)$/, ''))
    }
    if (/仅作为.*参考|只作为.*参考|最终行为以.*为准|reference[ -]?only/i.test(line.text)) {
      declaredRestrictions.push({ text: line.text.trim(), location: relativeLocation(relative, line.number) })
    }
    if (/^\s*[-*]\s+/.test(line.text) && /关注|检查|生命周期|协商|异常|超时|恢复|清理|边界|并发|兼容/.test(line.text)) {
      methodologyPoints.push({ text: line.text.replace(/^\s*[-*]\s+/, '').trim(), location: relativeLocation(relative, line.number) })
    }
  }

  const kind = inferKind(relative, text)
  const sample = `${relative}\n${text.slice(0, 12000)}`
  let roles = []
  if (declaredRestrictions.length > 0) roles.push('semantic_reference')
  if (/测试用例|测试步骤|预期结果|test[ _-]?case|expected result/i.test(sample)) roles.push('example_reference')
  if (kind === 'requirement' || kind === 'design') roles.push('input_candidate')
  if (kind === 'methodology' || (kind === 'protocol' && /关注|检查|生命周期|协商|异常|恢复|清理/.test(sample))) {
    roles.push('methodology_candidate')
  }
  if (kind === 'protocol' && declaredRestrictions.length === 0) roles.push('semantic_reference')
  if (roles.length === 0) roles.push('unclassified')
  if (Array.isArray(override?.suggested_roles)) roles = override.suggested_roles
  roles = limited(roles.filter(role => ALLOWED_ROLES.has(role)))
  if (roles.length === 0) roles = ['unclassified']

  return {
    kind: cleanText(override?.kind, kind),
    suggested_roles: roles,
    suggestion_source: override ? 'user_override' : 'plugin_analysis',
    summary: firstSummary(lines),
    headings: headings.slice(0, 80),
    requirement_ids: limited(requirements.map(item => item.id), 100),
    requirements: requirements.slice(0, 120),
    applicability_hints: { symbols: limited(symbols, 80) },
    declared_restrictions: declaredRestrictions.slice(0, 40),
    methodology_points: methodologyPoints.slice(0, 80),
  }
}

function automationAnalysis(relative, text, override = undefined) {
  const lines = lineRecords(text)
  const parameters = []
  const environmentVariables = []
  const phaseLocations = { prechecks: [], setup: [], actions: [], assertions: [], cleanup: [] }
  let entrypoint = false
  for (const line of lines) {
    if (/^\s*#!|if\s+__name__\s*==\s*['"]__main__['"]|\bmain\s*\(|"scripts"\s*:/.test(line.text)) entrypoint = true
    for (const match of line.text.matchAll(/add_argument\(\s*['"]([^'"]+)['"]|\.option\(\s*['"]([^'"]+)['"]/g)) {
      parameters.push(match[1] ?? match[2])
    }
    for (const match of line.text.matchAll(/(?:os\.(?:getenv|environ\.get)\(\s*['"]([A-Z][A-Z0-9_]*)|process\.env\.([A-Z][A-Z0-9_]*)|\$\{([A-Z][A-Z0-9_]*)\})/g)) {
      environmentVariables.push(match[1] ?? match[2] ?? match[3])
    }
    const location = relativeLocation(relative, line.number)
    if (/precheck|preflight|health.?check|前置检查/i.test(line.text)) phaseLocations.prechecks.push(location)
    if (/\bsetup(?:_|\b)|prepare|初始化|配置环境/i.test(line.text)) phaseLocations.setup.push(location)
    if (/\bassert|expect\(|verify|验证|断言/i.test(line.text)) phaseLocations.assertions.push(location)
    if (/\bcleanup(?:_|\b)|teardown|finally|清理|恢复环境/i.test(line.text)) phaseLocations.cleanup.push(location)
    if (/execute|\brun\b|invoke|操作步骤|执行步骤/i.test(line.text)) phaseLocations.actions.push(location)
  }
  let roles = ['automation_capability']
  if (Array.isArray(override?.suggested_roles)) roles = override.suggested_roles
  roles = limited(roles.filter(role => ALLOWED_ROLES.has(role)))
  if (roles.length === 0) roles = ['unclassified']
  return {
    kind: cleanText(override?.kind, 'automation'),
    suggested_roles: roles,
    suggestion_source: override ? 'user_override' : 'plugin_analysis',
    language: path.extname(relative).replace(/^\./, '') || 'unknown',
    entrypoint_candidate: entrypoint,
    parameters: limited(parameters, 80),
    environment_variables: limited(environmentVariables, 80),
    phase_locations: Object.fromEntries(Object.entries(phaseLocations).map(([key, values]) => [key, limited(values, 40)])),
  }
}

async function walkFiles(root) {
  const files = []
  async function visit(current) {
    if (files.length >= MAX_FILES) return
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      if (files.length >= MAX_FILES || IGNORED_PARTS.has(entry.name)) continue
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.isFile() && DISCOVERABLE_SUFFIXES.has(path.extname(entry.name).toLowerCase())) files.push(absolute)
    }
  }
  await visit(root)
  return files
}

async function readAssetText(absolute) {
  const info = await stat(absolute)
  const suffix = path.extname(absolute).toLowerCase()
  if (!TEXT_SUFFIXES.has(suffix)) return { status: 'unsupported', size_bytes: info.size, text: '' }
  if (info.size > MAX_TEXT_BYTES) return { status: 'too_large', size_bytes: info.size, text: '' }
  const buffer = await readFile(absolute)
  if (buffer.includes(0)) return { status: 'binary', size_bytes: info.size, text: '' }
  return { status: 'parsed', size_bytes: info.size, text: buffer.toString('utf8') }
}

async function readAssetContent({ absolute, relative, assetId, group }) {
  const suffix = path.extname(absolute).toLowerCase()
  if (group === 'inbox' && NORMALIZABLE_SUFFIXES.has(suffix)) {
    return normalizeDocument({ absolute, relative, assetId })
  }
  return readAssetText(absolute)
}

async function pathKind(value) {
  try { return (await stat(value)).isDirectory() ? 'directory' : 'other' } catch { return 'missing' }
}

export async function discoverDataRoot(cwd, explicitDataRoot = undefined) {
  if (cleanText(explicitDataRoot)) {
    const resolved = path.resolve(explicitDataRoot)
    if (await pathKind(resolved) !== 'directory') throw new Error(`PANGEA data root does not exist: ${resolved}`)
    return resolved
  }
  if (!cleanText(cwd)) throw new Error('workspace cwd or data_root is required')
  let current = path.resolve(cwd)
  while (true) {
    if (path.basename(current) === 'pangea-data' && await pathKind(current) === 'directory') return current
    const candidate = path.join(current, 'pangea-data')
    if (await pathKind(candidate) === 'directory') return candidate
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error(`No pangea-data directory found from workspace: ${cwd}`)
}

async function loadOverrides(outputRoot) {
  try {
    const value = JSON.parse(await readFile(path.join(outputRoot, 'overrides.json'), 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch { return {} }
}

async function scanGroup({ root, dataRoot, group, overrides, diagnostics, includeNormalizedContent }) {
  if (await pathKind(root) !== 'directory') {
    diagnostics.push({ severity: 'info', kind: 'missing_input_directory', path: path.relative(dataRoot, root).split(path.sep).join('/') })
    return []
  }
  const files = await walkFiles(root)
  if (files.length >= MAX_FILES) diagnostics.push({ severity: 'warning', kind: 'file_limit_reached', path: path.relative(dataRoot, root).split(path.sep).join('/'), limit: MAX_FILES })
  const assets = []
  const usedIds = new Set()
  for (const absolute of files) {
    const relative = path.relative(dataRoot, absolute).split(path.sep).join('/')
    const baseId = safeId(group === 'inbox' ? 'material' : 'automation', relative)
    let id = baseId
    let suffix = 2
    while (usedIds.has(id)) id = `${baseId}-${suffix++}`
    usedIds.add(id)
    let record
    try { record = await readAssetContent({ absolute, relative, assetId: id, group }) } catch (error) {
      diagnostics.push({ severity: 'warning', kind: 'read_failed', path: relative, error: error instanceof Error ? error.message : String(error) })
      continue
    }
    if (record.status !== 'parsed') {
      diagnostics.push({
        severity: record.status === 'parsed_with_warnings' ? 'info' : 'warning',
        kind: record.status === 'parsed_with_warnings' ? 'content_parsed_with_warnings' : 'content_not_parsed',
        path: relative,
        parse_status: record.status,
        ...(record.normalization?.error_code ? { error_code: record.normalization.error_code } : {}),
        ...(record.normalization?.error ? { error: record.normalization.error } : {}),
        ...(record.normalization?.warnings?.length ? { warnings: record.normalization.warnings } : {}),
      })
    }
    const analysisPath = record.normalization?.markdown_path ?? relative
    const analysis = group === 'inbox'
      ? materialAnalysis(analysisPath, record.text, overrides[id])
      : automationAnalysis(relative, record.text, overrides[id])
    assets.push({
      asset_id: id,
      source_path: relative,
      source_group: group,
      file_type: path.extname(relative).replace(/^\./, '').toLowerCase(),
      parse_status: record.status,
      size_bytes: record.size_bytes,
      ...(record.normalization ? { normalization: record.normalization } : {}),
      ...(includeNormalizedContent && record.normalization && record.text ? { _normalized_markdown: record.text } : {}),
      non_binding: true,
      ...analysis,
    })
  }
  return assets
}

export async function scanAssets({ cwd, dataRoot, includeNormalizedContent = false } = {}) {
  const resolvedDataRoot = await discoverDataRoot(cwd, dataRoot)
  const outputRoot = path.join(resolvedDataRoot, OUTPUT_DIR)
  const overrides = await loadOverrides(outputRoot)
  const diagnostics = []
  const materials = await scanGroup({ root: path.join(resolvedDataRoot, 'inbox'), dataRoot: resolvedDataRoot, group: 'inbox', overrides, diagnostics, includeNormalizedContent })
  const automations = await scanGroup({ root: path.join(resolvedDataRoot, 'test-automation'), dataRoot: resolvedDataRoot, group: 'test-automation', overrides, diagnostics, includeNormalizedContent })
  const assets = [...materials, ...automations]
  const methodologyCandidates = materials
    .filter(asset => asset.suggested_roles.includes('methodology_candidate'))
    .map(asset => ({
      candidate_id: `method-${asset.asset_id}`,
      status: 'draft',
      non_binding: true,
      source_asset_ids: [asset.asset_id],
      source_paths: [asset.source_path],
      title: asset.headings?.[0]?.title ?? path.basename(asset.source_path),
      candidate_rules: asset.methodology_points,
      applicability_hints: asset.applicability_hints,
      declared_restrictions: asset.declared_restrictions,
      review_required: true,
    }))
  const automationCapabilities = automations.filter(asset => (
    asset.entrypoint_candidate
    || asset.parameters.length > 0
    || Object.values(asset.phase_locations).some(locations => locations.length > 0)
  )).map(asset => ({
    capability_id: `cap-${asset.asset_id}`,
    status: 'suggested',
    non_binding: true,
    source_asset_id: asset.asset_id,
    source_path: asset.source_path,
    language: asset.language,
    entrypoint_candidate: asset.entrypoint_candidate,
    parameters: asset.parameters,
    environment_variables: asset.environment_variables,
    phase_locations: asset.phase_locations,
  }))
  const counts = {
    total: assets.length,
    materials: materials.length,
    automations: automations.length,
    methodology_candidates: methodologyCandidates.length,
    normalizable_documents: materials.filter(asset => asset.normalization).length,
    normalized_documents: materials.filter(asset => asset.normalization?.status === 'converted' || asset.normalization?.status === 'converted_with_warnings').length,
    normalization_failures: materials.filter(asset => asset.normalization?.status === 'failed' || asset.normalization?.status === 'too_large').length,
    diagnostics: diagnostics.length,
    unclassified: assets.filter(asset => asset.suggested_roles.includes('unclassified')).length,
  }
  return {
    status: 'ok',
    schema_version: '1.0',
    generator: 'dsh-pangea-asset-catalog',
    generated_files_are_non_binding: true,
    data_root: resolvedDataRoot,
    output_root: outputRoot,
    generated_at: new Date().toISOString(),
    counts,
    assets,
    methodology_candidates: methodologyCandidates,
    automation_capabilities: automationCapabilities,
    diagnostics,
  }
}

async function writeJsonAtomic(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, destination)
}

async function writeTextAtomic(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}`
  await writeFile(temporary, `${value.trim()}\n`, 'utf8')
  await rename(temporary, destination)
}

async function removeStaleMaterialFiles(directory, expectedNames) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || expectedNames.has(entry.name)) continue
    await unlink(path.join(directory, entry.name))
  }
}


async function removeStaleNormalizedFiles(directory, expectedNames) {
  let entries
  try { entries = await readdir(directory, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || expectedNames.has(entry.name)) continue
    await unlink(path.join(directory, entry.name))
  }
}

async function normalizedFilesReferencedByIssues(outputRoot) {
  const names = new Set()
  let entries
  try { entries = await readdir(path.join(outputRoot, 'historical-issues'), { withFileTypes: true }) } catch { return names }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      const value = JSON.parse(await readFile(path.join(outputRoot, 'historical-issues', entry.name), 'utf8'))
      if (typeof value.normalized_path === 'string') names.add(path.basename(value.normalized_path))
    } catch {}
  }
  return names
}

async function preserveConfirmedMethodology(outputRoot, generatedAt) {
  const destination = path.join(outputRoot, 'methodology-candidates.json')
  try {
    const value = JSON.parse(await readFile(destination, 'utf8'))
    if (value?.source === 'confirmed_historical_issues') return
  } catch {}
  await writeJsonAtomic(destination, {
    schema_version: '1.0', generated_at: generatedAt, source: 'confirmed_historical_issues',
    non_binding: true, confirmed_issue_ids: [], candidates: [],
  })
}

function publicAsset(asset) {
  const { _normalized_markdown: _ignored, ...value } = asset
  return value
}

export async function generateCatalog(options = {}) {
  const snapshot = await scanAssets({ ...options, includeNormalizedContent: true })
  const outputRoot = snapshot.output_root
  const materialRoot = path.join(outputRoot, 'materials')
  const normalizedRoot = path.join(outputRoot, 'normalized')
  await mkdir(materialRoot, { recursive: true })
  await mkdir(normalizedRoot, { recursive: true })
  const assets = snapshot.assets.map(publicAsset)
  const catalog = {
    schema_version: snapshot.schema_version,
    generator: snapshot.generator,
    generated_at: snapshot.generated_at,
    generated_files_are_non_binding: true,
    data_root: snapshot.data_root,
    counts: snapshot.counts,
    assets: assets.map(asset => ({
      asset_id: asset.asset_id,
      source_path: asset.source_path,
      source_group: asset.source_group,
      file_type: asset.file_type,
      parse_status: asset.parse_status,
      size_bytes: asset.size_bytes,
      ...(asset.normalization ? { normalization: asset.normalization } : {}),
      kind: asset.kind,
      suggested_roles: asset.suggested_roles,
      suggestion_source: asset.suggestion_source,
      non_binding: true,
    })),
  }
  const expectedNames = new Set()
  const expectedNormalizedNames = new Set()
  for (const asset of snapshot.assets.filter(item => item.source_group === 'inbox')) {
    const name = `${asset.asset_id}.json`
    expectedNames.add(name)
    await writeJsonAtomic(path.join(materialRoot, name), {
      schema_version: '1.0', generated_at: snapshot.generated_at, non_binding: true, ...publicAsset(asset),
    })
    if (asset._normalized_markdown && asset.normalization?.markdown_path) {
      const markdownName = path.basename(asset.normalization.markdown_path)
      expectedNormalizedNames.add(markdownName)
      await writeTextAtomic(path.join(normalizedRoot, markdownName), asset._normalized_markdown)
    }
  }
  for (const name of await normalizedFilesReferencedByIssues(outputRoot)) expectedNormalizedNames.add(name)
  await removeStaleMaterialFiles(materialRoot, expectedNames)
  await removeStaleNormalizedFiles(normalizedRoot, expectedNormalizedNames)
  await writeJsonAtomic(path.join(outputRoot, 'catalog.json'), catalog)
  await preserveConfirmedMethodology(outputRoot, snapshot.generated_at)
  await writeJsonAtomic(path.join(outputRoot, 'automation-capabilities.json'), {
    schema_version: '1.0', generated_at: snapshot.generated_at, non_binding: true, capabilities: snapshot.automation_capabilities,
  })
  await writeJsonAtomic(path.join(outputRoot, 'diagnostics.json'), {
    schema_version: '1.0', generated_at: snapshot.generated_at, diagnostics: snapshot.diagnostics,
  })
  return { ...snapshot, assets }
}

export async function saveOverride({ cwd, dataRoot, assetId, suggestedRoles, kind } = {}) {
  if (!cleanText(assetId)) throw new Error('asset_id is required')
  if (!Array.isArray(suggestedRoles) || suggestedRoles.length === 0 || suggestedRoles.some(role => !ALLOWED_ROLES.has(role))) {
    throw new Error('suggested_roles must contain supported role names')
  }
  const resolvedDataRoot = await discoverDataRoot(cwd, dataRoot)
  const outputRoot = path.join(resolvedDataRoot, OUTPUT_DIR)
  const overrides = await loadOverrides(outputRoot)
  overrides[assetId] = {
    suggested_roles: unique(suggestedRoles),
    ...(cleanText(kind) ? { kind: kind.trim() } : {}),
  }
  await writeJsonAtomic(path.join(outputRoot, 'overrides.json'), overrides)
  return generateCatalog({ dataRoot: resolvedDataRoot })
}

export async function readGeneratedState({ cwd, dataRoot } = {}) {
  const snapshot = await scanAssets({ cwd, dataRoot })
  let generated = null
  try {
    const info = await stat(path.join(snapshot.output_root, 'catalog.json'))
    generated = { catalog_path: path.join(snapshot.output_root, 'catalog.json'), modified_at: info.mtime.toISOString() }
  } catch {}
  const assets = await Promise.all(snapshot.assets.map(async asset => {
    if (!asset.normalization?.markdown_path) return asset
    const openPath = path.join(snapshot.data_root, asset.normalization.markdown_path)
    try {
      const info = await stat(openPath)
      return { ...asset, normalization: { ...asset.normalization, persisted: true, open_path: openPath, modified_at: info.mtime.toISOString() } }
    } catch {
      return { ...asset, normalization: { ...asset.normalization, persisted: false } }
    }
  }))
  return { ...snapshot, assets, generated }
}

export { ALLOWED_ROLES }
