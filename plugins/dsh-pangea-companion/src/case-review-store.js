import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import path from 'node:path'
import { writeTaskStoreFile } from './task-store.js'
import { caseIdentity, reviewProjection } from './case-review-projection.js'

const queues = new Map()
const fields = ['title', 'case_type', 'test_level', 'verification_goal', 'entry', 'preconditions', 'step_pairs', 'steps', 'expected_result', 'expected_results', 'observability', 'external_observations', 'cleanup', 'variants', 'execution_readiness', 'readiness', 'readiness_reason', 'missing_execution_conditions', 'unit_id', 'linked_risk_ids', 'linked_flow_ids', 'coverage_refs', 'evidence']
const error = (statusCode, code, message) => Object.assign(new Error(message), { statusCode, code })
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value ?? null
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
export function caseContentHash(item) {
  return digest({ ...Object.fromEntries(fields.map(key => [key, item[key] ?? null])),
    source_record: Object.fromEntries(['record_id', 'kind', 'body', 'evidence', 'relates_to'].map(key => [key, item.source_record?.[key] ?? null])) })
}
export function caseSet(items) {
  const hashes = Object.create(null), duplicates = new Set()
  for (const item of items) {
    const key = caseIdentity(item)
    if (!key) continue
    if (Object.hasOwn(hashes, key)) duplicates.add(key)
    hashes[key] = caseContentHash(item)
  }
  return { hashes, duplicates, revision: digest(items.map(item => [caseIdentity(item), caseContentHash(item)]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))) }
}

export class CaseReviewStore {
  constructor({ dataRoot, runId, write = writeTaskStoreFile }) {
    if (!/^[A-Za-z0-9._-]+$/.test(runId || '')) throw error(400, 'invalid_run_id', 'run_id 无效')
    this.dataRoot = dataRoot; this.runId = runId; this.write = write
  }
  async file() {
    const root = await realpath(this.dataRoot)
    return path.join(root, '.pangea', 'case-reviews', `${this.runId}.json`)
  }
  async read() {
    try {
      const value = JSON.parse(await readFile(await this.file(), 'utf8'))
      if (value.schema_version !== 1 || value.run_id !== this.runId || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.decisions || Array.isArray(value.decisions) || typeof value.decisions !== 'object') throw new Error('评审存储格式不受支持')
      for (const saved of Object.values(value.decisions)) if (!saved || !['adopted', 'excluded'].includes(saved.decision) || typeof saved.content_hash !== 'string') throw new Error('评审决定损坏')
      return value
    } catch (reason) {
      if (reason.code === 'ENOENT') return { schema_version: 1, content_hash_version: 1, run_id: this.runId, revision: 0, decisions: {} }
      throw error(422, 'invalid_review_store', `评审记录不可读取：${reason.message}`)
    }
  }
  async project(items) {
    const saved = await this.read(), set = caseSet(items)
    const decisions = saved.content_hash_version === 1 ? saved.decisions : Object.fromEntries(Object.entries(saved.decisions).map(([key, value]) => [key, { ...value, content_hash: '' }]))
    return { status: 'ok', run_id: this.runId, revision: saved.revision, case_set_revision: set.revision, ...reviewProjection(items, decisions, set.hashes) }
  }
  async update(items, input) {
    if (!['adopted', 'excluded', 'unreviewed'].includes(input.decision)) throw error(400, 'invalid_decision', '评审决定无效')
    const file = await this.file(), previous = queues.get(file) ?? Promise.resolve()
    const operation = previous.catch(() => {}).then(async () => {
      const saved = await this.read(), set = caseSet(items), key = input.case_key
      if (!Number.isSafeInteger(input.expected_revision) || input.expected_revision !== saved.revision) throw error(409, 'review_changed', '评审已更新，请重新确认')
      if (!key || !Object.hasOwn(set.hashes, key) || set.duplicates.has(key)) throw error(422, 'invalid_case_identity', '用例没有唯一身份，无法保存评审')
      if (input.expected_content_hash !== set.hashes[key]) throw error(409, 'case_changed', '用例已更新，请重新确认')
      const decisions = Object.assign(Object.create(null), saved.content_hash_version === 1 ? saved.decisions : Object.fromEntries(Object.entries(saved.decisions).map(([id, value]) => [id, { ...value, content_hash: '' }])))
      if (input.decision === 'unreviewed') delete decisions[key]
      else decisions[key] = { decision: input.decision, content_hash: set.hashes[key], updated_at: new Date().toISOString() }
      await this.write(file, `${JSON.stringify({ schema_version: 1, content_hash_version: 1, run_id: this.runId, revision: saved.revision + 1, decisions }, null, 2)}\n`)
      return this.project(items)
    })
    queues.set(file, operation)
    try { return await operation } finally { if (queues.get(file) === operation) queues.delete(file) }
  }
}

export async function selectExportCases(items, input, store) {
  const scope = input.scope ?? 'all'
  if (!['all', 'filtered', 'selected', 'adopted'].includes(scope)) throw error(400, 'invalid_scope', '导出范围无效')
  const set = caseSet(items)
  if (input.case_set_revision !== set.revision) throw error(409, 'case_set_changed', '用例已更新，请重新确认导出范围')
  let keys = input.case_keys
  if (scope === 'adopted') {
    const review = await store.project(items)
    if (input.review_revision !== review.revision) throw error(409, 'review_changed', '评审已更新，请重新确认导出范围')
    keys = review.cases.filter(row => row.review_status === 'adopted').map(row => row.case_key)
  }
  if (scope === 'all') {
    if (!items.length) throw error(422, 'empty_export', '当前没有可导出的用例')
    return items
  }
  if (!Array.isArray(keys) || !keys.length) throw error(422, 'empty_export', '导出范围为空，请选择用例')
  if (new Set(keys).size !== keys.length || keys.some(key => !Object.hasOwn(set.hashes, key) || set.duplicates.has(key))) throw error(422, 'invalid_case_identity', '导出范围含无效或重复用例，请重新选择')
  const selected = new Set(keys)
  return items.filter(item => selected.has(caseIdentity(item)))
}
