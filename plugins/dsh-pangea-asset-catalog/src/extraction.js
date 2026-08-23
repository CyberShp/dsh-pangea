import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { discoverDataRoot, scanAssets } from './catalog.js'

const OUTPUT_DIR = 'asset-catalog'
const MAX_ISSUES = 100
const MAX_CANDIDATES = 100
const MAX_LIST_ITEMS = 50
const MAX_FIELD_LENGTH = 4000
const MAX_EXCERPT_LENGTH = 600
const CONFIDENCE = new Set(['high', 'medium', 'low'])
const REVIEW_DECISIONS = new Set(['confirmed', 'excluded'])

function request(payload) {
  return { rpcId: `pangea-asset-${randomUUID()}`, payload }
}

function apiFailure(error) {
  return new Error(`${error.code}: ${error.message}`)
}

function cleanString(value, field, { allowEmpty = true, max = MAX_FIELD_LENGTH } = {}) {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  const output = value.trim()
  if (!allowEmpty && output === '') throw new Error(`${field} must not be empty`)
  if (output.length > max) throw new Error(`${field} exceeds ${max} characters`)
  return output
}

function cleanStringList(value, field, { min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > MAX_LIST_ITEMS) {
    throw new Error(`${field} must contain ${min}-${MAX_LIST_ITEMS} strings`)
  }
  return [...new Set(value.map((item, index) => cleanString(item, `${field}[${index}]`, { allowEmpty: false })))]
}

function sourceRef(relative) {
  return encodeURI(relative).replace(/--/g, '%2D%2D')
}

function annotateText(text, relative) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let start = 0
  for (let index = 0; index <= lines.length; index += 1) {
    if (index < lines.length && lines[index].trim() !== '') continue
    const block = lines.slice(start, index).join('\n').trim()
    if (block) blocks.push(`<!-- source: ${sourceRef(relative)}#line=${start + 1} -->\n${block}`)
    start = index + 1
  }
  return blocks.join('\n\n')
}

function evidenceSegments(markdown, sourcePath) {
  const prefix = `${sourceRef(sourcePath)}#`
  const matches = [...markdown.matchAll(/<!-- source: ([^\n]+?) -->/g)]
    .filter(match => match[1].startsWith(prefix))
  const segments = new Map()
  for (const [index, match] of matches.entries()) {
    const location = match[1]
    const start = (match.index ?? 0) + match[0].length
    const end = matches[index + 1]?.index ?? markdown.length
    segments.set(location, markdown.slice(start, end))
  }
  return segments
}

function cleanEvidence(value, field, segments) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIST_ITEMS) {
    throw new Error(`${field} must contain 1-${MAX_LIST_ITEMS} evidence entries`)
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${field}[${index}] must be an object`)
    let location = cleanString(item.location, `${field}[${index}].location`, { allowEmpty: false, max: 1000 })
    const excerpt = cleanString(item.excerpt, `${field}[${index}].excerpt`, { allowEmpty: false, max: MAX_EXCERPT_LENGTH })
    const segment = segments.get(location)
    if (segment?.includes(excerpt)) return { location, excerpt }
    const exactMatches = [...segments.entries()].filter(([, content]) => content.includes(excerpt))
    if (exactMatches.length === 1) {
      location = exactMatches[0][0]
      return { location, excerpt }
    }
    if (segment === undefined) throw new Error(`${field}[${index}].location is not a source marker from this asset`)
    if (exactMatches.length > 1) {
      throw new Error(`${field}[${index}].excerpt appears at multiple source markers; choose a more specific verbatim excerpt`)
    }
    throw new Error(`${field}[${index}].excerpt is not an exact substring at its source marker; use a shorter verbatim excerpt and preserve Markdown characters such as backticks`)
  })
}

function cleanIssue(value, index, segments) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`issues[${index}] must be an object`)
  const confidence = cleanString(value.confidence, `issues[${index}].confidence`, { allowEmpty: false, max: 20 })
  if (!CONFIDENCE.has(confidence)) throw new Error(`issues[${index}].confidence must be high, medium, or low`)
  return {
    title: cleanString(value.title, `issues[${index}].title`, { allowEmpty: false }),
    symptom: cleanString(value.symptom, `issues[${index}].symptom`),
    trigger_conditions: cleanStringList(value.trigger_conditions, `issues[${index}].trigger_conditions`),
    impact: cleanStringList(value.impact, `issues[${index}].impact`),
    root_causes: cleanStringList(value.root_causes, `issues[${index}].root_causes`),
    resolutions: cleanStringList(value.resolutions, `issues[${index}].resolutions`),
    verification: cleanStringList(value.verification, `issues[${index}].verification`),
    limitations: cleanStringList(value.limitations, `issues[${index}].limitations`),
    missing_fields: cleanStringList(value.missing_fields, `issues[${index}].missing_fields`),
    confidence,
    evidence: cleanEvidence(value.evidence, `issues[${index}].evidence`, segments),
  }
}

function pairKey(evidence) {
  return `${evidence.location}\n${evidence.excerpt}`
}

function cleanCandidate(value, index, confirmedById) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`candidates[${index}] must be an object`)
  const sourceIssueIds = cleanStringList(value.source_issue_ids, `candidates[${index}].source_issue_ids`, { min: 1 })
  const sources = sourceIssueIds.map(id => {
    const issue = confirmedById.get(id)
    if (!issue) throw new Error(`candidates[${index}] references an unconfirmed issue: ${id}`)
    return issue
  })
  const allowedEvidence = new Set(sources.flatMap(issue => issue.evidence.map(pairKey)))
  if (!Array.isArray(value.evidence) || value.evidence.length === 0 || value.evidence.length > MAX_LIST_ITEMS) {
    throw new Error(`candidates[${index}].evidence must contain 1-${MAX_LIST_ITEMS} entries`)
  }
  const evidence = value.evidence.map((item, evidenceIndex) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`candidates[${index}].evidence[${evidenceIndex}] must be an object`)
    const output = {
      location: cleanString(item.location, `candidates[${index}].evidence[${evidenceIndex}].location`, { allowEmpty: false, max: 1000 }),
      excerpt: cleanString(item.excerpt, `candidates[${index}].evidence[${evidenceIndex}].excerpt`, { allowEmpty: false, max: MAX_EXCERPT_LENGTH }),
    }
    if (!allowedEvidence.has(pairKey(output))) throw new Error(`candidates[${index}].evidence[${evidenceIndex}] is not supplied by its confirmed issues`)
    return output
  })
  return {
    title: cleanString(value.title, `candidates[${index}].title`, { allowEmpty: false }),
    applicable_when: cleanStringList(value.applicable_when, `candidates[${index}].applicable_when`),
    checks: cleanStringList(value.checks, `candidates[${index}].checks`, { min: 1 }),
    expected_signals: cleanStringList(value.expected_signals, `candidates[${index}].expected_signals`),
    failure_signals: cleanStringList(value.failure_signals, `candidates[${index}].failure_signals`),
    exceptions: cleanStringList(value.exceptions, `candidates[${index}].exceptions`),
    source_issue_ids: sourceIssueIds,
    evidence,
  }
}

async function writeJsonAtomic(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, destination)
}

async function writeTextAtomic(destination, value) {
  await mkdir(path.dirname(destination), { recursive: true })
  const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`
  await writeFile(temporary, `${value.trim()}\n`, 'utf8')
  await rename(temporary, destination)
}

async function readJson(destination, fallback) {
  try { return JSON.parse(await readFile(destination, 'utf8')) } catch { return fallback }
}

async function fileInfo(destination) {
  try {
    const info = await stat(destination)
    return { path: destination, modified_at: info.mtime.toISOString() }
  } catch { return null }
}

function issueFile(dataRoot, assetId) {
  return path.join(dataRoot, OUTPUT_DIR, 'historical-issues', `${assetId}.json`)
}

function reviewFile(dataRoot) {
  return path.join(dataRoot, OUTPUT_DIR, 'historical-issue-reviews.json')
}

function methodologyFile(dataRoot) {
  return path.join(dataRoot, OUTPUT_DIR, 'methodology-candidates.json')
}

async function prepareAsset({ cwd, dataRoot, assetId }) {
  const snapshot = await scanAssets({ cwd, dataRoot, includeNormalizedContent: true })
  const asset = snapshot.assets.find(item => item.asset_id === assetId)
  if (!asset || asset.source_group !== 'inbox') throw new Error(`inbox asset not found: ${assetId}`)
  if (!['parsed', 'parsed_with_warnings'].includes(asset.parse_status)) throw new Error(`asset is not extractable: ${asset.parse_status}`)
  const normalizedRelative = asset.normalization?.markdown_path ?? `${OUTPUT_DIR}/normalized/${asset.asset_id}.md`
  const normalizedAbsolute = path.join(snapshot.data_root, normalizedRelative)
  let markdown = asset._normalized_markdown
  if (!markdown) {
    const sourceAbsolute = path.join(snapshot.data_root, asset.source_path)
    const sourceText = await readFile(sourceAbsolute, 'utf8')
    markdown = annotateText(sourceText, asset.source_path)
  }
  if (!markdown.trim()) throw new Error('asset contains no extractable text')
  await writeTextAtomic(normalizedAbsolute, markdown)
  const segments = evidenceSegments(markdown, asset.source_path)
  if (segments.size === 0) throw new Error('normalized asset contains no source markers')
  return { snapshot, asset, markdown, segments, normalizedRelative, normalizedAbsolute }
}

async function loadReviews(dataRoot) {
  const value = await readJson(reviewFile(dataRoot), null)
  return value && typeof value === 'object' && value.reviews && typeof value.reviews === 'object'
    ? value
    : { schema_version: '1.0', updated_at: null, reviews: {} }
}

async function loadConfirmedIssues(dataRoot) {
  const reviews = await loadReviews(dataRoot)
  return Object.values(reviews.reviews)
    .filter(review => review?.decision === 'confirmed' && review.issue)
    .map(review => review.issue)
}

function jobView(job) {
  if (!job) return null
  return {
    kind: job.kind,
    status: job.status,
    session_id: job.sessionId,
    started_at: job.startedAt,
    ...(job.completedAt ? { completed_at: job.completedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
  }
}

export class AssetExtractionRuntime {
  constructor(api) {
    this.api = api
    this.jobs = new Map()
    this.latest = new Map()
  }

  key(dataRoot, assetId = 'methodology') {
    return `${path.resolve(dataRoot)}\n${assetId}`
  }

  latestJob(dataRoot, assetId) {
    return jobView(this.latest.get(this.key(dataRoot, assetId)))
  }

  async createSession(cwd, title) {
    const created = await this.api.sessions.create(request({ cwd }))
    if (!created.result.ok) throw apiFailure(created.result.error)
    const sessionId = created.result.value.sessionId
    const renamed = await this.api.sessions.rename(request({ sessionId, title }))
    if (!renamed.result.ok) throw apiFailure(renamed.result.error)
    return sessionId
  }

  async promptSession(job, prompt) {
    this.jobs.set(job.sessionId, job)
    this.latest.set(this.key(job.dataRoot, job.assetId), job)
    const prompted = await this.api.sessions.prompt(request({
      sessionId: job.sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: prompt }],
    }))
    if (!prompted.result.ok) {
      job.status = 'failed'
      job.error = `${prompted.result.error.code}: ${prompted.result.error.message}`
      throw apiFailure(prompted.result.error)
    }
  }

  async startHistoricalIssues({ cwd, dataRoot, assetId }) {
    const prepared = await prepareAsset({ cwd, dataRoot, assetId })
    const sessionId = await this.createSession(prepared.snapshot.data_root, `资产提取 · ${prepared.asset.source_path}`)
    const job = {
      kind: 'historical_issues', status: 'queued', started: false, sessionId,
      startedAt: new Date().toISOString(), dataRoot: prepared.snapshot.data_root,
      assetId, asset: prepared.asset, normalizedRelative: prepared.normalizedRelative,
      normalizedAbsolute: prepared.normalizedAbsolute, segments: prepared.segments,
    }
    await this.promptSession(job, [
      '/pangea-extract-historical-issues',
      '这是用户在资产目录中明确触发的单份历史问题提取任务。',
      `asset_id: ${assetId}`,
      `source_path: ${prepared.asset.source_path}`,
      `normalized_markdown: ${prepared.normalizedAbsolute}`,
      'evidence.location 应逐字复制 Markdown 注释中的位置；excerpt 可缩短，但必须逐字保留反引号、标点和空格。唯一匹配的行号误差会由插件纠正，失败时仍不得读取原始 source_path。',
      '严格按已注入 Skill 工作，并通过 pangea_asset_issue_submit 提交结果。',
    ].join('\n'))
    return { status: 'queued', session_id: sessionId, asset_id: assetId, normalized_path: prepared.normalizedAbsolute }
  }

  async startMethodology({ cwd, dataRoot }) {
    const resolvedDataRoot = await discoverDataRoot(cwd, dataRoot)
    const confirmed = await loadConfirmedIssues(resolvedDataRoot)
    if (confirmed.length === 0) throw new Error('no confirmed historical issues are available')
    const sessionId = await this.createSession(resolvedDataRoot, `方法论候选 · ${confirmed.length} 条已确认问题`)
    const inputPath = path.join(resolvedDataRoot, OUTPUT_DIR, '.model-input', `${sessionId}.json`)
    await writeJsonAtomic(inputPath, { schema_version: '1.0', confirmed_issues: confirmed })
    const job = {
      kind: 'methodology', status: 'queued', started: false, sessionId,
      startedAt: new Date().toISOString(), dataRoot: resolvedDataRoot,
      assetId: 'methodology', inputPath, confirmed,
    }
    await this.promptSession(job, [
      '/pangea-derive-methodology-candidates',
      '这是用户在资产目录中明确触发的方法论候选生成任务。',
      `confirmed_issues_json: ${inputPath}`,
      `confirmed_issue_count: ${confirmed.length}`,
      '严格按已注入 Skill 工作，并通过 pangea_asset_methodology_submit 提交结果。',
    ].join('\n'))
    return { status: 'queued', session_id: sessionId, confirmed_issue_count: confirmed.length }
  }

  jobFromExec(exec, kind) {
    const sessionId = exec?.agent?.session?.id
    const job = sessionId ? this.jobs.get(sessionId) : undefined
    if (!job || job.kind !== kind || !['queued', 'running'].includes(job.status)) {
      throw new Error(`no active ${kind} job belongs to this session`)
    }
    return job
  }

  async submitHistoricalIssues(args, exec) {
    const job = this.jobFromExec(exec, 'historical_issues')
    if (args.asset_id !== job.assetId) throw new Error('asset_id does not match the active extraction job')
    if (!Array.isArray(args.issues) || args.issues.length > MAX_ISSUES) throw new Error(`issues must contain 0-${MAX_ISSUES} entries`)
    const previous = await readJson(issueFile(job.dataRoot, job.assetId), {})
    const revision = Number.isInteger(previous.extraction_revision) ? previous.extraction_revision + 1 : 1
    const issues = args.issues.map((item, index) => ({
      issue_id: `${job.assetId}-r${revision}-issue-${String(index + 1).padStart(3, '0')}`,
      status: 'draft',
      non_binding: true,
      review_required: true,
      ...cleanIssue(item, index, job.segments),
    }))
    const destination = issueFile(job.dataRoot, job.assetId)
    await writeJsonAtomic(destination, {
      schema_version: '1.0', generator: 'dsh-pangea-asset-catalog', generated_at: new Date().toISOString(),
      model_session_id: job.sessionId, non_binding: true, asset_id: job.assetId,
      source_path: job.asset.source_path, normalized_path: job.normalizedRelative,
      extraction_revision: revision, extraction_status: issues.length > 0 ? 'completed' : 'no_issues', issues,
    })
    job.status = 'completed'
    job.completedAt = new Date().toISOString()
    return { status: 'ok', asset_id: job.assetId, issue_count: issues.length, output_path: destination, non_binding: true }
  }

  async submitMethodology(args, exec) {
    const job = this.jobFromExec(exec, 'methodology')
    if (!Array.isArray(args.candidates) || args.candidates.length > MAX_CANDIDATES) throw new Error(`candidates must contain 0-${MAX_CANDIDATES} entries`)
    const confirmedById = new Map(job.confirmed.map(issue => [issue.issue_id, issue]))
    const previous = await readJson(methodologyFile(job.dataRoot), {})
    const revision = Number.isInteger(previous.generation_revision) ? previous.generation_revision + 1 : 1
    const candidates = args.candidates.map((item, index) => ({
      candidate_id: `method-r${revision}-${String(index + 1).padStart(3, '0')}`,
      status: 'draft', non_binding: true, review_required: true,
      ...cleanCandidate(item, index, confirmedById),
    }))
    const destination = methodologyFile(job.dataRoot)
    await writeJsonAtomic(destination, {
      schema_version: '1.0', generator: 'dsh-pangea-asset-catalog', generated_at: new Date().toISOString(),
      model_session_id: job.sessionId, source: 'confirmed_historical_issues', generation_revision: revision,
      non_binding: true, confirmed_issue_ids: [...confirmedById.keys()], candidates,
    })
    job.status = 'completed'
    job.completedAt = new Date().toISOString()
    await this.cleanupJobInput(job)
    return { status: 'ok', candidate_count: candidates.length, output_path: destination, non_binding: true }
  }

  async cleanupJobInput(job) {
    if (!job.inputPath) return
    try { await unlink(job.inputPath) } catch {}
  }

  handleAgentStatus(agent, status) {
    const job = this.jobs.get(agent?.session?.id)
    if (!job || ['completed', 'failed'].includes(job.status)) return
    if (status === 'running') {
      job.started = true
      job.status = 'running'
    } else if (status === 'idle' && job.started) {
      job.status = 'failed'
      job.error = 'DSH model finished without submitting a valid result'
      job.completedAt = new Date().toISOString()
      void this.cleanupJobInput(job)
    }
  }

  handleAgentError(agent, error) {
    const job = this.jobs.get(agent?.session?.id)
    if (!job || ['completed', 'failed'].includes(job.status)) return
    job.status = 'failed'
    job.error = error instanceof Error ? error.message : String(error)
    job.completedAt = new Date().toISOString()
    void this.cleanupJobInput(job)
  }

  async decorateState(snapshot) {
    const reviews = await loadReviews(snapshot.data_root)
    const assets = await Promise.all(snapshot.assets.map(async asset => {
      if (asset.source_group !== 'inbox' || !['parsed', 'parsed_with_warnings'].includes(asset.parse_status)) {
        return { ...asset, historical_extraction: { available: false } }
      }
      const destination = issueFile(snapshot.data_root, asset.asset_id)
      const result = await readJson(destination, null)
      const output = await fileInfo(destination)
      const issues = Array.isArray(result?.issues) ? result.issues.map(issue => ({
        ...issue,
        review: reviews.reviews[issue.issue_id] ?? null,
      })) : []
      return {
        ...asset,
        historical_extraction: {
          available: true,
          job: this.latestJob(snapshot.data_root, asset.asset_id),
          ...(result ? {
            result: { ...result, issues }, output_path: output?.path, modified_at: output?.modified_at,
            normalized_open_path: path.join(snapshot.data_root, result.normalized_path),
          } : {}),
        },
      }
    }))
    const confirmedIssues = Object.values(reviews.reviews).filter(review => review?.decision === 'confirmed' && review.issue)
    const excludedIssues = Object.values(reviews.reviews).filter(review => review?.decision === 'excluded')
    const methodPath = methodologyFile(snapshot.data_root)
    const methodology = await readJson(methodPath, null)
    const methodInfo = await fileInfo(methodPath)
    const reviewInfo = await fileInfo(reviewFile(snapshot.data_root))
    const confirmedIds = new Set(confirmedIssues.map(review => review.issue.issue_id))
    const methodologyStale = Array.isArray(methodology?.confirmed_issue_ids)
      ? methodology.confirmed_issue_ids.some(id => !confirmedIds.has(id)) || methodology.confirmed_issue_ids.length !== confirmedIds.size
      : false
    return {
      ...snapshot,
      assets,
      historical_issue_reviews: {
        confirmed: confirmedIssues.length,
        excluded: excludedIssues.length,
        path: reviewInfo?.path ?? null,
        modified_at: reviewInfo?.modified_at ?? null,
      },
      methodology_generation: {
        available: confirmedIssues.length > 0,
        job: this.latestJob(snapshot.data_root, 'methodology'),
        ...(methodology ? { result: methodology, output_path: methodInfo?.path, modified_at: methodInfo?.modified_at, stale: methodologyStale } : {}),
      },
    }
  }
}

export async function saveHistoricalIssueReview({ cwd, dataRoot, assetId, issueId, decision, correctedIssue } = {}) {
  if (!REVIEW_DECISIONS.has(decision)) throw new Error('decision must be confirmed or excluded')
  const resolvedDataRoot = await discoverDataRoot(cwd, dataRoot)
  const extraction = await readJson(issueFile(resolvedDataRoot, assetId), null)
  const source = extraction?.issues?.find(issue => issue.issue_id === issueId)
  const reviews = await loadReviews(resolvedDataRoot)
  if (!source && !reviews.reviews[issueId]) throw new Error(`historical issue not found: ${issueId}`)
  const now = new Date().toISOString()
  if (decision === 'excluded') {
    reviews.reviews[issueId] = { issue_id: issueId, asset_id: assetId, decision, reviewed_at: now }
  } else {
    if (!source) throw new Error('confirmed review requires the current extracted issue')
    let issue = source
    if (correctedIssue !== undefined) {
      const fields = cleanIssue({ ...correctedIssue, evidence: source.evidence }, 0, new Map(source.evidence.map(item => [item.location, item.excerpt])))
      issue = { ...source, ...fields, evidence: source.evidence, status: 'confirmed', review_required: false }
    } else {
      issue = { ...source, status: 'confirmed', review_required: false }
    }
    reviews.reviews[issueId] = { issue_id: issueId, asset_id: assetId, decision, reviewed_at: now, issue }
  }
  reviews.updated_at = now
  await writeJsonAtomic(reviewFile(resolvedDataRoot), reviews)
  return reviews.reviews[issueId]
}

const STRING_ARRAY = { type: 'array', items: { type: 'string' } }
const EVIDENCE_ARRAY = {
  type: 'array', minItems: 1,
  items: {
    type: 'object', additionalProperties: false, required: ['location', 'excerpt'],
    properties: { location: { type: 'string' }, excerpt: { type: 'string' } },
  },
}

export const ISSUE_SUBMISSION_PARAMETERS = {
  type: 'object', additionalProperties: false, required: ['asset_id', 'issues'],
  properties: {
    asset_id: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'symptom', 'trigger_conditions', 'impact', 'root_causes', 'resolutions', 'verification', 'limitations', 'missing_fields', 'confidence', 'evidence'],
        properties: {
          title: { type: 'string' }, symptom: { type: 'string' },
          trigger_conditions: STRING_ARRAY, impact: STRING_ARRAY, root_causes: STRING_ARRAY,
          resolutions: STRING_ARRAY, verification: STRING_ARRAY, limitations: STRING_ARRAY,
          missing_fields: STRING_ARRAY, confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          evidence: EVIDENCE_ARRAY,
        },
      },
    },
  },
}

export const METHODOLOGY_SUBMISSION_PARAMETERS = {
  type: 'object', additionalProperties: false, required: ['candidates'],
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'applicable_when', 'checks', 'expected_signals', 'failure_signals', 'exceptions', 'source_issue_ids', 'evidence'],
        properties: {
          title: { type: 'string' }, applicable_when: STRING_ARRAY, checks: STRING_ARRAY,
          expected_signals: STRING_ARRAY, failure_signals: STRING_ARRAY, exceptions: STRING_ARRAY,
          source_issue_ids: STRING_ARRAY, evidence: EVIDENCE_ARRAY,
        },
      },
    },
  },
}

export { loadConfirmedIssues, loadReviews, prepareAsset }
