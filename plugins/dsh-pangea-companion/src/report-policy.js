import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { runAdapter } from './pangea-api.js'

export const name = 'dsh-pangea-companion-report-policy'
export const inject = ['subagents', 'tools', 'systemPrompt']

const PANGEA_MARKER = join('.agents', 'pangea', 'dsh.md')
const SOURCE_TOOLS = new Set([
  'pangea_task_open',
  'pangea_input_read',
  'pangea_source_index',
  'pangea_source_read',
  'pangea_source_search',
  'pangea_plan_write',
  'pangea_result_write',
  'pangea_result_read',
  'pangea_result_repair',
  'pangea_comparison_read',
  'pangea_work_finish',
  'pangea_review_decide',
])
const LIFECYCLE_TOOLS = new Set([
  'pangea_run_create',
  'pangea_run_resume',
  'pangea_action_next',
  'pangea_action_bind',
  'pangea_action_settle',
  'pangea_action_dispatch',
])

function pangeaWorkspaceRoot(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return undefined
  let current = resolve(cwd)
  while (true) {
    if (existsSync(join(current, PANGEA_MARKER))) return current
    const parent = dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

export function isPangeaWorkspace(cwd) {
  return pangeaWorkspaceRoot(cwd) !== undefined
}

export function workspaceInstructions(context) {
  const header = context?.agent?.session?.header
  if (header?.origin === 'subagent') return ''
  const root = pangeaWorkspaceRoot(header?.cwd)
  if (!root) return ''
  try {
    return readFileSync(join(root, PANGEA_MARKER), 'utf8')
  } catch {
    return ''
  }
}

function workspaceCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

function actionFrom(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null
}

function workflowResult(value) {
  const result = actionFrom(value)
  if (!result) return null
  const actions = [
    ...(Array.isArray(result.agent_actions) ? result.agent_actions : []),
    ...(Array.isArray(result.actions) ? result.actions : []),
    ...(actionFrom(result.action) ? [result.action] : []),
  ].filter(action => (
    typeof action.action_id === 'string'
    && typeof action.task_path === 'string'
    && ['dispatch_agent', 'continue_agent'].includes(action.action)
  ))
  return {
    workflowVersion: result.workflow_version,
    runId: typeof result.run_id === 'string' ? result.run_id : undefined,
    dataRoot: typeof result.data_root === 'string' ? result.data_root : undefined,
    actions,
  }
}

function childIdFrom(value) {
  const candidate = value?.subagent_id ?? value?.subagentId ?? value?.childId
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate : undefined
}

function roleRulePaths(role) {
  const common = {
    planning: ['.agents/pangea/planning-worker.md'],
    analysis: ['.agents/pangea/analysis-worker.md'],
    review: ['.agents/pangea/review-worker.md'],
    closure: ['.agents/pangea/closure-worker.md'],
  }
  return common[role]
}

function roleInstructions(exec, action) {
  const root = pangeaWorkspaceRoot(workspaceCwd(exec))
  if (!root) throw new Error('PANGEA workspace not found')
  const candidates = roleRulePaths(action.role)
  if (!candidates) throw new Error(`unsupported source-first action role: ${action.role}`)
  const selected = candidates.map(item => join(root, item)).find(existsSync)
  if (!selected) throw new Error(`source-first worker rules not found for role: ${action.role}`)
  return readFileSync(selected, 'utf8')
}

function taskScope(root, action) {
  const taskPath = resolve(root, action.task_path)
  let task
  try {
    task = JSON.parse(readFileSync(taskPath, 'utf8'))
  } catch (error) {
    throw new Error(`source-first task 不可读取：${taskPath}；${error instanceof Error ? error.message : String(error)}`)
  }
  const resultPath = typeof task.result_path === 'string' && task.result_path !== ''
    ? resolve(root, task.result_path)
    : undefined
  if (!resultPath) throw new Error(`source-first task 缺少 result_path：${taskPath}`)
  return {
    taskPath,
    resultPath,
    actionId: typeof task.action_id === 'string' ? task.action_id : action.action_id,
    runId: typeof task.run_id === 'string' ? task.run_id : undefined,
  }
}

function sourceArguments(exec) {
  return exec?.arguments ?? {}
}

function scopeError(scope, args) {
  const expected = {
    run_id: scope.runId,
    action_id: scope.actionId,
    task_id: scope.childId,
  }
  const checks = [
    ['run_id', expected.run_id],
    ['action_id', expected.action_id],
    ['task_id', expected.task_id],
  ]
  for (const [key, value] of checks) {
    if (typeof value === 'string' && args[key] !== value) {
      return `source-first 子 Agent 只能使用当前 task 的 ${key}：expected=${value} actual=${args[key] ?? null}`
    }
  }
  if (typeof args.data_root === 'string' && resolve(args.data_root) !== resolve(scope.dataRoot)) {
    return 'source-first 子 Agent 只能使用当前 Run 的 data_root'
  }
  return undefined
}

function targetPath(exec) {
  return exec?.arguments?.file_path ?? exec?.arguments?.path
}

function childMutationError(child, exec) {
  if (LIFECYCLE_TOOLS.has(exec.name)) return 'source-first 生命周期只能由根 Agent 推进；子 Agent 只读源码并写当前 task 结果。'
  if (SOURCE_TOOLS.has(exec.name)) return scopeError(child, sourceArguments(exec))
  if (exec.name === 'bash') return 'source-first worker 使用已绑定的 source/result 工具；不得从 shell 绕过冻结输入或结果路径。'
  if (exec.name === 'read') {
    const target = targetPath(exec)
    if (typeof target === 'string' && resolve(workspaceCwd(exec), target) === child.taskPath) return undefined
    return 'source-first worker 使用 pangea_source_index/pangea_source_read；只允许 read 当前 task JSON。'
  }
  if (exec.name === 'write' || exec.name === 'edit') {
    return 'source-first worker 只能写当前 task，且必须通过已绑定的 result/plan/review 工具提交结果。'
  }
  return undefined
}

function pendingActionFor(state, exec) {
  if (exec.name !== 'pangea_action_dispatch') return undefined
  const action = state.pendingActions.get(exec.arguments?.action_id)
  return action ? { action } : undefined
}

function settleActionFor(state, exec) {
  if (exec.name !== 'pangea_action_settle') return undefined
  for (const [childId, child] of state.activeChildren) {
    if (
      child.status === 'settled'
      && exec.arguments?.action_id === child.action.action_id
      && exec.arguments?.run_id === state.runId
      && resolve(exec.arguments?.data_root) === resolve(state.dataRoot)
    ) return { childId, child }
  }
  return undefined
}

function acceptedValue(result, downstream) {
  if (downstream?.kind === 'accept' && Object.hasOwn(downstream, 'value')) return downstream.value
  return result?.value
}

function settleGuidance(state) {
  const waiting = [...state.activeChildren.entries()]
    .filter(([, child]) => child.status === 'settled')
    .map(([childId, child]) => `- pangea_action_settle({ data_root: ${JSON.stringify(state.dataRoot)}, run_id: ${JSON.stringify(state.runId)}, action_id: ${JSON.stringify(child.action.action_id)} }) · subagent_id=${childId}`)
  return [
    'source-first 有已结束 action 待 settle。一次只对一个 exact action_id 调用 pangea_action_settle。',
    ...waiting,
  ].join('\\n')
}

function continuationContent(action, state, childId, { initial = false } = {}) {
  const detail = action.validation_error ?? action.pending_repair?.error ?? action.error
  return [{
    type: 'text',
    text: [
      action.task_path,
      '',
      `宿主绑定：data_root=${JSON.stringify(state.dataRoot)} run_id=${JSON.stringify(state.runId)} action_id=${JSON.stringify(action.action_id)} task_id=${JSON.stringify(childId)}`,
      initial
        ? 'Graph bind 已完成。现在先用以上精确绑定调用 pangea_task_open，再执行当前 task。'
        : '先用以上精确绑定调用 pangea_task_open，读取本轮 task 和冻结输入，再按本轮阶段要求完成工作。若附有修复诊断，保留已有原文 notes，只修正所列问题；完成后使用当前 revision 调用 pangea_work_finish。',
      detail ? `确定性诊断：${JSON.stringify(detail, null, 2)}` : '',
    ].filter(Boolean).join('\\n'),
  }]
}

function conclude(exec, value, downstream) {
  if (typeof exec.concludeTurn === 'function') exec.concludeTurn()
  return {
    kind: 'accept',
    value,
    ...(downstream?.additionalContexts ? { additionalContexts: downstream.additionalContexts } : {}),
  }
}

function addActions(state, result) {
  if (!result) return
  if (result.runId) state.runId = result.runId
  if (result.dataRoot) state.dataRoot = result.dataRoot
  for (const action of result.actions) state.pendingActions.set(action.action_id, action)
}

function createState(result) {
  return {
    runId: result.runId,
    dataRoot: result.dataRoot,
    pendingActions: new Map(result.actions.map(action => [action.action_id, action])),
    activeChildren: new Map(),
    dispatchAttempts: new Map(),
  }
}

function rootDirectMutationError(exec) {
  if (exec.name === 'pangea_action_bind') {
    return '请使用 pangea_action_dispatch；它会创建或续接真实 task 后执行 exact bind。'
  }
  if (exec.name === 'pangea_action_settle') return undefined
  if (exec.name === 'bash') {
    const command = String(exec.arguments?.command ?? '')
    if (/pangea_agent\.cli\.main\s+(?:runs\s+create|module-analysis|resume-run|adapter\s+(?:bind|settle)|task-open|input-read|source-(?:index|read|search)|result-(?:write|read|repair)|plan-write|comparison-read|work-finish|review-decide)/.test(command)) {
      return '请使用已注册的 source-first 工具；生命周期和结果绑定由 Graph 与当前 Agent task 管理。'
    }
  }
  return undefined
}

export function installPangeaLifecyclePolicy(ctx, adapter = runAdapter) {
  const states = new Map()
  const childScopes = new Map()

  ctx.tools.register({
    name: 'pangea_action_dispatch',
    description: '按 Graph 返回的 exact action_id 创建或续接一个 source-first 子 Agent，并在同一次调用中绑定真实 task_id；不允许替换 continue_agent 的原 task。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action_id'],
      properties: { action_id: { type: 'string', minLength: 1 } },
    },
    isConcurrencySafe: () => false,
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'subagent_id', 'action_id', 'bound'],
        properties: {
          kind: { type: 'string' },
          subagent_id: { type: 'string' },
          action_id: { type: 'string' },
          bound: { type: 'boolean' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: `已绑定 source-first action ${value.action_id} · task=${value.subagent_id}` }],
    },
    async execute(args, exec) {
      const state = states.get(exec.agent?.id)
      if (!state) throw new Error('当前会话没有绑定的 source-first Run')
      const action = state.pendingActions.get(args.action_id)
      if (!action) throw new Error(`source-first action 当前不可派发：${args.action_id}`)
      const previous = state.dispatchAttempts.get(action.action_id)
      if (previous) {
        await adapter(workspaceCwd(exec), 'bind', {
          data_root: state.dataRoot,
          run_id: state.runId,
          action_id: action.action_id,
          task_id: previous.childId,
        })
        childScopes.set(previous.childId, {
          action,
          status: 'running',
          bound: true,
          dataRoot: state.dataRoot,
          ...taskScope(workspaceCwd(exec), action),
          childId: previous.childId,
        })
        previous.status = 'running'
        await ctx.subagents.followup(
          exec.agent,
          previous.childId,
          continuationContent(action, state, previous.childId, { initial: action.action !== 'continue_agent' }),
          { source: { kind: 'coordinator', form: 'relay', senderSessionId: exec.agent.id }, signal: exec.signal },
        )
        return { kind: 'continuable', subagent_id: previous.childId, action_id: action.action_id, bound: true }
      }

      let childId
      if (action.action === 'continue_agent') {
        if (typeof action.task_id !== 'string' || action.task_id === '') {
          throw new Error(`continue_agent 缺少原 task_id：${action.action_id}`)
        }
        childId = action.task_id
        state.dispatchAttempts.set(action.action_id, { childId, status: 'running' })
      } else {
        const started = await ctx.subagents.startContinuable({
          provider: 'spawn',
          label: `PANGEA source-first ${action.role}`,
          request: {
            label: `PANGEA source-first ${action.role}`,
            prompt: [{ type: 'text', text: '等待宿主完成 Graph bind；此刻不要调用工具。绑定完成后按下一条宿主消息执行。' }],
            parent: exec.agent,
            persona: roleInstructions(exec, action),
            agentOptions: { ...exec.agent.options },
            toolFilter: { allow: [...SOURCE_TOOLS, 'report'] },
          },
          signal: exec.signal,
        })
        childId = childIdFrom(started)
        if (!childId) throw new Error('DSH 未返回可续接的 subagent_id')
        state.dispatchAttempts.set(action.action_id, { childId, status: 'running' })
      }

      await adapter(workspaceCwd(exec), 'bind', {
        data_root: state.dataRoot,
        run_id: state.runId,
        action_id: action.action_id,
        task_id: childId,
      })
      childScopes.set(childId, {
        action,
        status: 'running',
        bound: true,
        dataRoot: state.dataRoot,
        ...taskScope(workspaceCwd(exec), action),
        childId,
      })
      const attempt = state.dispatchAttempts.get(action.action_id)
      if (attempt) attempt.status = 'running'
      await ctx.subagents.followup(
        exec.agent,
        childId,
        continuationContent(action, state, childId, { initial: action.action !== 'continue_agent' }),
        { source: { kind: 'coordinator', form: 'relay', senderSessionId: exec.agent.id }, signal: exec.signal },
      )
      return { kind: 'continuable', subagent_id: childId, action_id: action.action_id, bound: true }
    },
  })

  ctx.tools.guard(exec => {
    const child = exec?.agent ? childScopes.get(exec.agent.id) : undefined
    if (child) return childMutationError(child, exec)
    if (exec?.agent?.session?.header?.origin === 'subagent' && SOURCE_TOOLS.has(exec.name)) {
      return 'source-first 子 Agent 尚未完成 Graph bind；绑定完成后重试当前工具。'
    }

    const direct = rootDirectMutationError(exec)
    if (direct) return direct

    const state = exec?.agent ? states.get(exec.agent.id) : undefined
    if (!state) return undefined

    const pending = pendingActionFor(state, exec)
    if (pending) return undefined
    const settle = settleActionFor(state, exec)
    if (settle) return undefined

    const hasUnbound = [...state.activeChildren.values()].some(item => !item.bound)
    if (hasUnbound) return 'source-first task 尚未完成 Graph bind；请使用相同 action_id 重试 pangea_action_dispatch。'
    const running = [...state.activeChildren.values()].some(item => item.status === 'running')
    if (running) return 'source-first 子 Agent 仍在运行；等待其结束后按 exact action_id settle。'
    const settled = [...state.activeChildren.values()].some(item => item.status === 'settled')
    if (settled) return settleGuidance(state)
    if (state.pendingActions.size > 0) return 'Graph 已返回待执行 action；下一步必须调用 pangea_action_dispatch，并传入返回的 exact action_id。'
    return undefined
  })

  const noticeSettled = ({ agent, message }) => {
    if (message?.source?.kind !== 'subagent-settled') return
    const state = states.get(agent?.id)
    const childId = message.source.senderSessionId
    const child = state?.activeChildren.get(childId)
    if (child?.status === 'running') child.status = 'settled'
    if (!child && state) {
      for (const attempt of state.dispatchAttempts.values()) {
        if (attempt.childId === childId) attempt.status = 'settled'
      }
    }
  }
  ctx.on('agent/inbox/inserted', noticeSettled)
  ctx.on('agent/inbox/claimed', noticeSettled)

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = typeof next === 'function' ? await next() : { kind: 'accept', value: result?.value }
    if (downstream?.kind === 'block' || result?.isError || !exec?.agent) return downstream
    const value = acceptedValue(result, downstream)
    const runStart = ['pangea_run_create', 'pangea_run_resume', 'pangea_action_next'].includes(exec.name)
    const actionSettle = exec.name === 'pangea_action_settle'
    let state = states.get(exec.agent.id)

    if (runStart && value && typeof value === 'object') {
      const parsed = workflowResult(value)
      if (parsed && (parsed.actions.length > 0 || parsed.workflowVersion === 'source-first-v1')) {
        state = state && exec.name === 'pangea_action_next' ? state : createState(parsed)
        if (state !== states.get(exec.agent.id)) states.set(exec.agent.id, state)
        addActions(state, parsed)
      }
    }

    if (!state) return downstream
    const pending = pendingActionFor(state, exec)
    if (pending && value && !result?.isError) {
      const childId = childIdFrom(value) ?? (pending.action.action === 'continue_agent' ? pending.action.task_id : undefined)
      if (!childId) return downstream
      const attempt = state.dispatchAttempts.get(pending.action.action_id)
      state.pendingActions.delete(pending.action.action_id)
      state.dispatchAttempts.delete(pending.action.action_id)
      state.activeChildren.set(childId, {
        action: pending.action,
        status: attempt?.status === 'settled' ? 'settled' : 'running',
        bound: value.bound === true || pending.action.action === 'continue_agent',
        dataRoot: state.dataRoot,
        ...taskScope(workspaceCwd(exec), pending.action),
        childId,
      })
      childScopes.set(childId, state.activeChildren.get(childId))
      if (state.pendingActions.size === 0) return conclude(exec, value, downstream)
      return downstream
    }

    if (actionSettle && !result?.isError) {
      const settled = settleActionFor(state, exec)
      if (!settled) return downstream
      state.activeChildren.delete(settled.childId)
      childScopes.delete(settled.childId)
      const parsed = workflowResult(value)
      if (parsed) addActions(state, parsed)
      if (state.pendingActions.size === 0 && state.activeChildren.size === 0) states.delete(exec.agent.id)
      else if (state.pendingActions.size === 0 && [...state.activeChildren.values()].some(item => item.status === 'running')) {
        return conclude(exec, value, downstream)
      }
    }
    return downstream
  })

  return () => {}
}

export function apply(ctx, adapter = runAdapter) {
  ctx.systemPrompt?.section({
    name: 'pangea:dsh-workspace',
    order: 116,
    text: workspaceInstructions,
  })
  // DSH's standard `@deepseek-ai/dsh-tool-subagent-report` setup already
  // owns the child-scoped `report` tool and its `tool:report` prompt section.
  // Registering another setup here makes every source-first dispatch fail
  // when both setups mount into the same continuable child scope.
  installPangeaLifecyclePolicy(ctx, adapter)
}
