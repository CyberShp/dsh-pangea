import path from 'node:path'

import { runPangea, workspaceRoot } from './pangea-api.js'

const DEFAULT_PAGE_SIZE = 20

function rpc(payload) {
  return { rpcId: `pangea-workbench-${Date.now()}-${Math.random()}`, payload }
}

function apiValue(response) {
  if (!response?.result?.ok) {
    throw new Error(response?.result?.error?.message ?? 'DSH API request failed')
  }
  return response.result.value
}

function dataRootFor(root, explicit) {
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return path.isAbsolute(explicit) ? path.resolve(explicit) : path.resolve(root, explicit)
  }
  return path.join(root, 'pangea-data')
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}

function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean))]
    : []
}

function normalizeAnalysisInput(value, capabilities, allowEmptySourceScope) {
  const repository = typeof value?.repository === 'string' ? value.repository.trim() : ''
  const target = typeof value?.target === 'string' ? value.target.trim() : ''
  const sourceScope = stringList(value?.source_scope)
  if (!repository) throw new Error('repository is required')
  if (!target) throw new Error('target is required')
  if (sourceScope.length === 0 && !allowEmptySourceScope) {
    throw new Error('source_scope must contain at least one path')
  }
  if (Array.isArray(capabilities?.repositories) && !capabilities.repositories.includes(repository)) {
    throw new Error(`repository is not registered: ${repository}`)
  }
  return {
    repository,
    target,
    source_scope: sourceScope,
    focus: stringList(value?.focus),
    asset_ids: stringList(value?.asset_ids),
    test_case_examples: stringList(value?.test_case_examples),
  }
}

export function normalizeRunInput(value, capabilities) {
  return normalizeAnalysisInput(value, capabilities, false)
}

export async function workbenchSnapshot({ cwd, dataRoot, runId, cursor = 0, limit = DEFAULT_PAGE_SIZE, runner = runPangea }) {
  const root = workspaceRoot(cwd)
  const resolvedDataRoot = dataRootFor(root, dataRoot)
  const pageCursor = boundedInteger(cursor, 0, 0, Number.MAX_SAFE_INTEGER)
  const pageLimit = boundedInteger(limit, DEFAULT_PAGE_SIZE, 1, 100)
  try {
    const capabilities = await runner({
      cwd: root,
      args: ['system', 'capabilities', '--data-root', resolvedDataRoot],
    })
    const runs = await runner({
      cwd: root,
      args: ['runs', 'list', '--data-root', resolvedDataRoot, '--cursor', String(pageCursor), '--limit', String(pageLimit)],
    })
    const requestedRunId = typeof runId === 'string' ? runId.trim() : ''
    let run = null
    let runDetail = null
    if (requestedRunId) {
      try {
        run = await runner({
          cwd: root,
          args: ['runs', 'get', '--data-root', resolvedDataRoot, '--run-id', requestedRunId],
        })
        runDetail = { run_id: requestedRunId, status: 'ok', error: null }
      } catch (error) {
        runDetail = { run_id: requestedRunId, status: 'error', error: error instanceof Error ? error.message : String(error) }
      }
    }
    return {
      status: 'ok',
      data_root: resolvedDataRoot,
      compatibility: { compatible: true, api_version: '1.0' },
      capabilities,
      runs,
      run,
      run_detail: runDetail,
      pagination: { cursor: pageCursor, limit: pageLimit },
    }
  } catch (error) {
    return {
      status: 'ok',
      data_root: resolvedDataRoot,
      compatibility: {
        compatible: false,
        api_version: null,
        error: error instanceof Error ? error.message : String(error),
      },
      capabilities: null,
      runs: { items: [], next_cursor: null, total: 0 },
      run: null,
      run_detail: null,
      pagination: { cursor: pageCursor, limit: pageLimit },
    }
  }
}

async function createDshSession(api, root, title) {
  let payload = { cwd: root }
  if (api.workspace?.list) {
    const workspaces = apiValue(await api.workspace.list(rpc({}))).items
    const workspace = workspaces.find(item => path.resolve(item.path) === root)
    if (!workspace) throw new Error(`current DSH workspace is not registered: ${root}`)
    payload = { workspaceId: workspace.workspaceId }
  }
  const sessionId = apiValue(await api.sessions.create(rpc(payload))).sessionId
  apiValue(await api.sessions.rename(rpc({ sessionId, title })))
  return sessionId
}

export async function launchAnalysisSession(api, { cwd, dataRoot, input }, runner = runPangea, onSession = async () => {}) {
  const root = workspaceRoot(cwd)
  const resolvedDataRoot = dataRootFor(root, dataRoot)
  const capabilities = await runner({
    cwd: root,
    args: ['system', 'capabilities', '--data-root', resolvedDataRoot],
  })
  const request = normalizeAnalysisInput(input, capabilities, true)
  const sessionId = await createDshSession(api, root, `PANGEA 分析 · ${request.target}`)
  await onSession({ session_id: sessionId, input: request, data_root: resolvedDataRoot })
  const scopeInstructions = request.source_scope.length > 0
    ? ['用户已经指定 source_scope，逐字使用下面输入中的路径，不得自行扩大范围。']
    : [
        '用户没有手工指定 source_scope。调用 pangea_run_create 前，仅可在已选仓库中列目录、按文件名搜索或 grep 符号，以确定与 target 直接相关的最小源码路径集合。',
        '不得为确定范围而 Read、分段读取或通读业务源码，也不得读取历史 Run、PANGEA CLI、graph 或 schema。',
        '能够确定唯一合理范围时，直接补全非空 source_scope 并调用 pangea_run_create，不要再次要求用户填写。若存在多个明显不同且无法安全选择的范围，先在当前会话列出候选并等待用户确认。',
      ]
  const agentInput = request.source_scope.length > 0
    ? request
    : Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'source_scope'))
  const prompt = [
    '创建一个新的 PANGEA 模块分析并走完完整 action 流程，直到生成最终报告。',
    '必须读取 .agents/pangea/dsh.md，并直接调用 pangea_run_create；不得手写 pending contract 或自行推进 graph。',
    ...scopeInstructions,
    '',
    '[PANGEA Run 输入]',
    JSON.stringify({ ...agentInput, data_root: resolvedDataRoot }, null, 2),
  ].join('\n')
  apiValue(await api.sessions.prompt(rpc({
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: prompt }],
  })))
  return { status: 'ok', session_id: sessionId, input: request, data_root: resolvedDataRoot }
}

export async function createTaskConversation(api, { cwd, title }) {
  const root = workspaceRoot(cwd)
  const sessionId = await createDshSession(api, root, textTitle(title))
  return { status: 'ok', session_id: sessionId }
}

function textTitle(value) {
  const title = typeof value === 'string' ? value.trim() : ''
  return title || 'PANGEA 任务会话'
}

export async function stopAnalysisRun({ cwd, dataRoot, runId, runner = runPangea }) {
  const root = workspaceRoot(cwd)
  const resolvedDataRoot = dataRootFor(root, dataRoot)
  if (typeof runId !== 'string' || runId.trim() === '') throw new Error('run_id is required')
  const run = await runner({
    cwd: root,
    args: ['runs', 'stop', '--data-root', resolvedDataRoot, '--run-id', runId.trim()],
  })
  return { status: 'ok', data_root: resolvedDataRoot, run }
}

export { dataRootFor }
