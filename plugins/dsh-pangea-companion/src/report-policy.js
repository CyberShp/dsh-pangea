import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { runAdapter } from './pangea-api.js'

export const name = 'dsh-pangea-companion-report-policy'
export const inject = ['subagents', 'tools', 'systemPrompt']

const PANGEA_WORKSPACE_MARKER = join('.agents', 'pangea', 'dsh.md')
const REPORT_SECTION_ORDER = 117
const PANGEA_CLI = '-m pangea_agent.cli.main '
const PENDING_CONTRACT_SUFFIX = 'pangea-data/.pangea/pending-task-contract.json'

function pangeaWorkspaceRoot(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return undefined
  let current = resolve(cwd)
  while (true) {
    if (existsSync(join(current, PANGEA_WORKSPACE_MARKER))) return current
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
    return readFileSync(join(root, PANGEA_WORKSPACE_MARKER), 'utf8')
  } catch {
    return ''
  }
}

export function reportDeliveryForWorkspace(cwd) {
  return isPangeaWorkspace(cwd) ? 'quiet' : 'next-step'
}

function workspaceCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() !== '' ? cwd : undefined
}

function commandOf(exec) {
  return exec?.name === 'bash' && typeof exec.arguments?.command === 'string'
    ? exec.arguments.command
    : undefined
}

function isPangeaCliCommand(command, fragment) {
  return typeof command === 'string' && command.includes(`${PANGEA_CLI}${fragment}`)
}

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function commandHasFlagValue(command, flag, value) {
  if (typeof command !== 'string' || typeof value !== 'string' || value === '') return false
  const quotedValue = escapedPattern(value)
  return new RegExp(`(?:^|\\s)${escapedPattern(flag)}(?:=|\\s+)(["']?)${quotedValue}\\1(?=\\s|$)`).test(command)
}

function commandText(value) {
  if (typeof value === 'string') return value
  if (typeof value?.stdout?.text === 'string') return value.stdout.text
  return ''
}

function bashSucceeded(value) {
  if (typeof value === 'string') return !/\[(?:exit code|shell exited: code):?\s*[1-9]\d*\]/i.test(value)
  return value?.kind === 'foreground'
    && value.exitCode === 0
    && value.timedOut !== true
    && value.aborted !== true
}

function validationFeedback(value) {
  const errors = Array.isArray(value?.errors) && value.errors.length > 0
    ? value.errors
    : [{
        loc: [],
        type: 'validation_error',
        message: typeof value?.error === 'string' ? value.error : '结果契约校验未通过',
      }]
  return JSON.stringify({
    result_path: value?.result_path ?? null,
    expected_contract: value?.expected_contract ?? null,
    errors,
  }, null, 2)
}

function parseWorkflowResult(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return workflowResult(value)
  }
  const lines = commandText(value).split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const envelope = JSON.parse(lines[index])
      if (envelope?.ok !== true || !envelope.result || typeof envelope.result !== 'object') continue
      return workflowResult(envelope.result)
    } catch {
      // stdout must contain one valid JSON envelope; unrelated lines are ignored here.
    }
  }
  return null
}

function workflowResult(result) {
  const actions = [
    ...(Array.isArray(result.agent_actions) ? result.agent_actions : []),
    ...(Array.isArray(result.actions) ? result.actions : []),
    ...(result.action && typeof result.action === 'object' ? [result.action] : []),
  ].filter(action => (
    typeof action?.action_id === 'string'
    && typeof action?.task_path === 'string'
    && (action.action === 'dispatch_agent' || action.action === 'continue_agent')
  ))
  return {
    actions,
    runId: typeof result.run_id === 'string' ? result.run_id : undefined,
    dataRoot: typeof result.data_root === 'string' ? result.data_root : undefined,
    assetId: typeof result.asset?.asset_id === 'string' ? result.asset.asset_id : undefined,
    lifecycleStatus: result.lifecycle_status,
  }
}

function actionKey(action) {
  return action.action_id
}

function continuableSubagentId(value) {
  const candidate = value?.subagentId ?? value?.subagent_id
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate : undefined
}

function pendingActionFor(state, exec) {
  for (const [key, action] of state.pendingActions) {
    if (
      exec.name === 'pangea_action_dispatch'
      && exec.arguments?.action_id === action.action_id
    ) return { key, action }
  }
  return undefined
}

function roleInstructions(exec, action) {
  const root = pangeaWorkspaceRoot(workspaceCwd(exec))
  if (!root) throw new Error('PANGEA workspace not found')
  const rulePaths = {
    planning: [join('.agents', 'pangea', 'planning-worker.md')],
    analysis: [
      join('.agents', 'pangea', 'analysis-worker.md'),
      join('.opencode', 'agents', 'analysis-worker.md'),
    ],
    rework: [
      join('.agents', 'pangea', 'analysis-worker.md'),
      join('.opencode', 'agents', 'analysis-worker.md'),
    ],
    review: [
      join('.agents', 'pangea', 'review-worker.md'),
      join('.opencode', 'agents', 'review-worker.md'),
    ],
    closure: [join('.agents', 'pangea', 'closure-worker.md')],
  }
  const candidates = rulePaths[action.role]
  if (!candidates) throw new Error(`unsupported PANGEA action role: ${action.role}`)
  const rulePath = candidates.map(candidate => join(root, candidate)).find(existsSync)
  if (!rulePath) throw new Error(`PANGEA worker rules not found for role: ${action.role}`)
  return readFileSync(rulePath, 'utf8')
}

function targetFlag(state) {
  return state.assetId ? ['--asset-id', state.assetId] : ['--run-id', state.runId]
}

function adapterTarget(state, exec, subcommand) {
  if (exec.name === `pangea_action_${subcommand}`) {
    if (exec.arguments?.run_id !== state.runId || exec.arguments?.data_root !== state.dataRoot) return undefined
    const child = [...state.activeChildren.entries()]
      .find(([, item]) => item.action.action_id === exec.arguments?.action_id)
    if (!child) return undefined
    const [childId, childState] = child
    if (subcommand === 'bind' && exec.arguments?.task_id === childId) return { childId, child: childState }
    if (subcommand === 'validate' && childState.status === 'settled' && childState.bound && !childState.validated) {
      return { childId, child: childState }
    }
    if (subcommand === 'settle' && childState.status === 'settled' && childState.bound) return { childId, child: childState }
    return undefined
  }
  const command = commandOf(exec)
  if (!isPangeaCliCommand(command, `adapter ${subcommand}`)) return undefined
  const [flag, value] = targetFlag(state)
  if (!value || !commandHasFlagValue(command, flag, value)) return undefined
  for (const [childId, child] of state.activeChildren) {
    if (!commandHasFlagValue(command, '--action-id', child.action.action_id)) continue
    if (subcommand === 'bind' && commandHasFlagValue(command, '--task-id', childId)) {
      return { childId, child }
    }
    if (subcommand === 'validate' && child.status === 'settled' && child.bound && !child.validated) {
      return { childId, child }
    }
    if (subcommand === 'settle' && child.status === 'settled' && child.bound) {
      return { childId, child }
    }
  }
  return undefined
}

function repairTarget(state, exec) {
  if (exec.name !== 'send_message') return undefined
  const child = state.activeChildren.get(exec.arguments?.subagent_id)
  if (!child || child.status !== 'settled' || child.validated) return undefined
  return { childId: exec.arguments.subagent_id, child }
}

function referencesPendingContract(exec) {
  let serialized
  try {
    serialized = JSON.stringify(exec.arguments ?? {})
  } catch {
    return false
  }
  return serialized.replaceAll('\\\\', '/').replaceAll('\\', '/').includes(PENDING_CONTRACT_SUFFIX)
}

function rootLifecycleMutationBlock(exec) {
  if (referencesPendingContract(exec)) {
    return 'PANGEA pending contract 由 pangea_run_create 独占管理；根 Agent 不得读取、创建、编辑或删除。'
  }
  if (exec.name === 'pangea_action_bind') {
    return 'PANGEA action 必须用 pangea_action_dispatch 派发；该工具会自动绑定真实 subagent_id。'
  }
  const command = commandOf(exec)
  if (
    isPangeaCliCommand(command, 'runs create')
    || isPangeaCliCommand(command, 'module-analysis')
  ) {
    return 'PANGEA 新 Run 必须调用 pangea_run_create；不得手写 contract 或直接调用创建 Run 的 CLI。'
  }
  if (
    isPangeaCliCommand(command, 'record-agent-session')
    || isPangeaCliCommand(command, 'resume-run')
    || isPangeaCliCommand(command, 'adapter bind')
    || isPangeaCliCommand(command, 'adapter validate')
    || isPangeaCliCommand(command, 'adapter settle')
  ) {
    return 'PANGEA action 生命周期必须使用 pangea_action_dispatch 和 pangea_action_settle。'
  }
  return undefined
}

function childTaskWritePolicy(taskPath, cwd) {
  try {
    const absoluteTaskPath = resolve(cwd, taskPath)
    const task = JSON.parse(readFileSync(absoluteTaskPath, 'utf8'))
    if (typeof task.result_path !== 'string' || task.result_path === '') return undefined
    const allowedResult = resolve(cwd, task.result_path)
    const protectedPaths = [
      absoluteTaskPath,
      task.prior_result_path,
      task.original_result_path,
      task.original_task_path,
    ].filter(value => typeof value === 'string' && value !== '')
      .map(value => resolve(cwd, value))
      .filter(value => value !== allowedResult)
    return { allowedResult, protectedPaths }
  } catch {
    return undefined
  }
}

function commandReferencesPath(command, cwd, target) {
  const normalized = command.replaceAll('\\', '/')
  const absolute = target.replaceAll('\\', '/')
  const local = relative(cwd, target).replaceAll('\\', '/')
  return normalized.includes(absolute) || (local !== '' && normalized.includes(local))
}

function shellLiteralPattern(value) {
  const escaped = escapedPattern(value)
  const alternatives = [`"${escaped}"`, `'${escaped}'`]
  if (!/\s/.test(value)) alternatives.push(escaped)
  return `(?:${alternatives.join('|')})`
}

function isReadOnlyResultCheck(command, taskPath, cwd) {
  const absoluteTaskPath = resolve(cwd, taskPath)
  const taskPatterns = [absoluteTaskPath, relative(cwd, absoluteTaskPath)]
    .filter((value, index, values) => value !== '' && values.indexOf(value) === index)
    .map(shellLiteralPattern)
    .join('|')
  const cwdPattern = shellLiteralPattern(cwd)
  const localPythonCandidates = [
    join(cwd, '.venv', 'bin', 'python'),
    join(cwd, '.venv', 'Scripts', 'python.exe'),
  ]
  const pythonPatterns = [
    'python(?:3(?:\\.\\d+)?)?',
    ...localPythonCandidates.flatMap(value => {
      const local = relative(cwd, value)
      return [value, local, `.${local.includes('\\') ? '\\' : '/'}${local}`]
        .map(shellLiteralPattern)
    }),
  ].join('|')
  const pattern = new RegExp([
    '^\\s*',
    `(?:cd\\s+${cwdPattern}\\s*&&\\s*)?`,
    `(?:${pythonPatterns})\\s+-m\\s+pangea_agent\\.cli\\.main\\s+`,
    `check-result-json\\s+--task(?:=|\\s+)(?:${taskPatterns})`,
    '\\s*(?:2>&1\\s*)?(?:\\|\\|\\s*true\\s*)?$',
  ].join(''))
  return pattern.test(command)
}

function childArtifactMutationBlock(taskPath, exec) {
  const cwd = workspaceCwd(exec)
  if (!cwd) return undefined
  const policy = childTaskWritePolicy(taskPath, cwd)
  if (!policy) return undefined
  if (exec.name === 'write' || exec.name === 'edit') {
    const target = exec.arguments?.file_path ?? exec.arguments?.path
    if (typeof target !== 'string' || resolve(cwd, target) !== policy.allowedResult) {
      return `PANGEA 子 Agent 只能写当前 task 的 result_path：${policy.allowedResult}`
    }
    return undefined
  }
  const command = commandOf(exec)
  if (!command) return undefined
  if (isReadOnlyResultCheck(command, taskPath, cwd)) return undefined
  const canMutate = /(?:^|\s)(?:python(?:3)?|perl|ruby|node|tee|cp|mv|rm)(?:\s|$)|sed\s+-i|(?:^|[^>])>{1,2}(?:[^>]|$)|Set-Content|Out-File/i.test(command)
  if (canMutate && policy.protectedPaths
    .some(target => commandReferencesPath(command, cwd, target))) {
    return `PANGEA 子 Agent 只能修改当前 task 的 result_path：${policy.allowedResult}`
  }
  return undefined
}

function childLifecycleMutationBlock(exec) {
  if (
    exec.name === 'pangea_action_dispatch'
    || exec.name === 'pangea_action_bind'
    || exec.name === 'pangea_action_validate'
    || exec.name === 'pangea_action_settle'
  ) {
    return 'PANGEA action 生命周期只能由根 Agent 推进；子 Agent 只提交当前 task 的结果。'
  }
  const command = commandOf(exec)
  if (
    isPangeaCliCommand(command, 'adapter bind')
    || isPangeaCliCommand(command, 'adapter validate')
    || isPangeaCliCommand(command, 'adapter settle')
  ) {
    return 'PANGEA action 生命周期只能由根 Agent 推进；子 Agent 只提交当前 task 的结果。'
  }
  return undefined
}

function hasRunningChild(state) {
  return [...state.activeChildren.values()].some(child => child.status === 'running')
}

function hasUnboundChild(state) {
  return [...state.activeChildren.values()].some(child => !child.bound)
}

function settledActionGuidance(state) {
  const actions = [...state.activeChildren.entries()]
    .filter(([, child]) => child.status === 'settled')
    .map(([childId, child]) => ({
      childId,
      actionId: child.action.action_id,
    }))
  const calls = actions.map(item => (
    `- pangea_action_settle(${JSON.stringify({
      data_root: state.dataRoot,
      run_id: state.runId,
      action_id: item.actionId,
    })})，subagent_id=${item.childId}`
  ))
  return [
    'PANGEA 有已结束 action 待处理。一次只对一个 action 直接调用 settle；settle 会校验当前结果并推进 Workflow。',
    '不得调用 validate、resume-run、status、Bash 或其他工具。',
    ...calls,
  ].join('\n')
}

function continuationContent(action) {
  const feedback = action.validation_error ?? action.error
  if (!feedback) return [{ type: 'text', text: action.task_path }]
  return [{ type: 'text', text: [
    action.task_path,
    '',
    '上一次提交未通过确定性契约校验。重新打开同一 task 的 result_path，保留有效语义并修正下面列出的全部错误后结束本回合。',
    `validation_error=${JSON.stringify(feedback, null, 2)}`,
  ].join('\n') }]
}

function acceptedValue(result, downstream) {
  return downstream.kind === 'accept' && Object.hasOwn(downstream, 'value')
    ? downstream.value
    : result.value
}

function acceptAndConclude(exec, value, downstream) {
  exec.concludeTurn()
  return {
    kind: 'accept',
    value,
    ...(downstream.additionalContexts ? { additionalContexts: downstream.additionalContexts } : {}),
  }
}

function workflowStart(exec) {
  return exec.name === 'pangea_run_create'
}

export function installPangeaLifecyclePolicy(ctx, adapter = runAdapter) {
  const states = new Map()
  const childTasks = new Map()
  const stateFor = agent => agent ? states.get(agent.id) : undefined

  ctx.tools.register({
    name: 'pangea_action_dispatch',
    description: '派发一个由 pangea_run_create 或 pangea_action_settle 返回的待执行 action。只传 action_id；工具会使用原始 task_path 和对应角色规则创建后台子 Agent。',
    parameters: {
      type: 'object', additionalProperties: false, required: ['action_id'],
      properties: { action_id: { type: 'string', minLength: 1 } },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          kind: { type: 'string' }, subagent_id: { type: 'string' }, action_id: { type: 'string' }, bound: { type: 'boolean' },
        },
        required: ['kind', 'subagent_id', 'action_id', 'bound'],
      },
      render: (_args, value) => [{ type: 'text', text: `已派发并绑定 ${value.action_id}，subagent_id=${value.subagent_id}` }],
    },
    // Agent 仍会并发运行；只把“创建子任务 + 绑定 action”串行化，
    // 避免多个 CLI 进程同时改写同一份 progress.json。
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const state = stateFor(exec.agent)
      const action = state?.pendingActions.get(args.action_id)
      if (!action) throw new Error(`PANGEA action 当前不可派发：${args.action_id}`)
      const previous = state.dispatchAttempts.get(action.action_id)
      if (previous) {
        await adapter(workspaceCwd(exec), 'bind', {
          data_root: state.dataRoot,
          run_id: state.runId,
          action_id: action.action_id,
          task_id: previous.childId,
        })
        return {
          kind: 'continuable', subagent_id: previous.childId,
          action_id: action.action_id, bound: true,
        }
      }
      if (action.action === 'continue_agent') {
        if (typeof action.task_id !== 'string' || action.task_id === '') {
          throw new Error(`PANGEA continue action 缺少原 subagent_id：${action.action_id}`)
        }
        await ctx.subagents.followup(
          exec.agent,
          action.task_id,
          continuationContent(action),
          {
            source: { kind: 'coordinator', form: 'relay', senderSessionId: exec.agent.id },
            signal: exec.signal,
          },
        )
        state.dispatchAttempts.set(action.action_id, { childId: action.task_id })
        await adapter(workspaceCwd(exec), 'bind', {
          data_root: state.dataRoot,
          run_id: state.runId,
          action_id: action.action_id,
          task_id: action.task_id,
        })
        return {
          kind: 'continuable', subagent_id: action.task_id,
          action_id: action.action_id, bound: true,
        }
      }
      const started = await ctx.subagents.startContinuable({
        provider: 'spawn',
        label: `PANGEA ${action.role}`,
        request: {
          label: `PANGEA ${action.role}`,
          prompt: [{ type: 'text', text: action.task_path }],
          parent: exec.agent,
          persona: roleInstructions(exec, action),
          agentOptions: { ...exec.agent.options },
        },
        signal: exec.signal,
      })
      state.dispatchAttempts.set(action.action_id, { childId: started.childId })
      await adapter(workspaceCwd(exec), 'bind', {
        data_root: state.dataRoot,
        run_id: state.runId,
        action_id: action.action_id,
        task_id: started.childId,
      })
      return { kind: 'continuable', subagent_id: started.childId, action_id: action.action_id, bound: true }
    },
  })

  ctx.tools.guard(exec => {
    const childTask = exec?.agent ? childTasks.get(exec.agent.id) : undefined
    if (childTask) {
      const lifecycleBlocked = childLifecycleMutationBlock(exec)
      if (lifecycleBlocked) return lifecycleBlocked
      const blocked = childArtifactMutationBlock(childTask, exec)
      if (blocked) return blocked
    }
    const state = stateFor(exec.agent)
    if (!isPangeaWorkspace(workspaceCwd(exec))) return undefined
    const lifecycleBlocked = rootLifecycleMutationBlock(exec)
    if (lifecycleBlocked) return lifecycleBlocked
    if (!state) return undefined

    if (hasUnboundChild(state)) {
      if (pendingActionFor(state, exec)) return undefined
      return 'PANGEA 子 Agent 的自动绑定尚未完成；请用同一 action_id 重试 pangea_action_dispatch。'
    }
    const hasSettled = [...state.activeChildren.values()].some(child => child.status === 'settled')
    if (hasSettled) {
      if (pendingActionFor(state, exec)) return undefined
      if (repairTarget(state, exec)) return undefined
      if (adapterTarget(state, exec, 'settle')) return undefined
      return settledActionGuidance(state)
    }
    if (state.pendingActions.size > 0) {
      if (pendingActionFor(state, exec)) return undefined
      return 'PANGEA 已返回待执行 action；下一步必须调用 pangea_action_dispatch，并传入返回的 action_id。'
    }
    if (hasRunningChild(state)) return 'PANGEA 子 Agent 仍在运行；请等待完成，不读取或修改其结果。'
    return undefined
  })

  const noticeSettled = ({ agent, message }) => {
    if (message?.source?.kind !== 'subagent-settled') return
    const state = stateFor(agent)
    const child = state?.activeChildren.get(message.source.senderSessionId)
    if (child?.status === 'running') child.status = 'settled'
  }
  ctx.on('agent/inbox/inserted', noticeSettled)
  ctx.on('agent/inbox/claimed', noticeSettled)

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const downstream = await next()
    if (downstream.kind === 'block' || result.isError || !exec.agent) return downstream
    if (!isPangeaWorkspace(workspaceCwd(exec))) return downstream
    const value = acceptedValue(result, downstream)
    const command = commandOf(exec)
    let state = stateFor(exec.agent)

    if ((exec.name !== 'bash' || bashSucceeded(value)) && workflowStart(exec)) {
      const parsed = parseWorkflowResult(value)
      if (!parsed || parsed.actions.length === 0) return downstream
      state = {
        runId: parsed.runId,
        dataRoot: parsed.dataRoot,
        assetId: parsed.assetId,
        pendingActions: new Map(parsed.actions.map(action => [actionKey(action), action])),
        activeChildren: new Map(),
        dispatchAttempts: new Map(),
      }
      states.set(exec.agent.id, state)
      return downstream
    }

    if (!state) return downstream
    const pending = pendingActionFor(state, exec)
    if (pending && !result.isError) {
      const childId = pending.action.action === 'dispatch_agent'
        ? continuableSubagentId(value)
        : pending.action.task_id
      if (!childId) return downstream
      state.pendingActions.delete(pending.key)
      state.dispatchAttempts.delete(pending.action.action_id)
      state.activeChildren.set(childId, {
        action: pending.action,
        bound: pending.action.action === 'continue_agent' || value?.bound === true,
        validated: false,
        status: 'running',
      })
      childTasks.set(childId, pending.action.task_path)
      if (state.pendingActions.size === 0 && !hasUnboundChild(state) && hasRunningChild(state)) {
        return acceptAndConclude(exec, value, downstream)
      }
      return downstream
    }

    const repair = repairTarget(state, exec)
    if (repair && !result.isError) {
      repair.child.status = 'running'
      return acceptAndConclude(exec, value, downstream)
    }

    const bind = adapterTarget(state, exec, 'bind')
    if (bind && (exec.name !== 'bash' || bashSucceeded(value))) {
      bind.child.bound = true
      if (state.pendingActions.size === 0 && hasRunningChild(state)) {
        return acceptAndConclude(exec, value, downstream)
      }
      return downstream
    }
    const validate = adapterTarget(state, exec, 'validate')
    if (validate && (exec.name !== 'bash' || bashSucceeded(value))) {
      if (value?.status === 'invalid') {
        const messageId = await ctx.subagents.followup(
          exec.agent,
          validate.childId,
          [{ type: 'text', text: [
            '结果契约校验未通过。只修正当前 task 的 result_path，不重新分析、不扩大范围。',
            `结构化错误：${validationFeedback(value)}`,
            '重新读取 expected_contract 和 task 的 selected_inputs_path，在同一 result_path 一次修正 errors 列出的全部字段后结束本回合。',
          ].join('\n') }],
          {
            source: { kind: 'coordinator', form: 'relay', senderSessionId: exec.agent.id },
            signal: exec.signal,
          },
        )
        validate.child.status = 'running'
        return acceptAndConclude(exec, { ...value, repair_message_id: messageId }, downstream)
      }
      validate.child.validated = true
      return downstream
    }
    const settle = adapterTarget(state, exec, 'settle')
    if (settle && (exec.name !== 'bash' || bashSucceeded(value))) {
      const parsed = parseWorkflowResult(value)
      state.activeChildren.delete(settle.childId)
      childTasks.delete(settle.childId)
      if (parsed) {
        state.runId = parsed.runId ?? state.runId
        state.dataRoot = parsed.dataRoot ?? state.dataRoot
        for (const action of parsed.actions) state.pendingActions.set(actionKey(action), action)
      }
      if (state.pendingActions.size === 0 && state.activeChildren.size === 0) states.delete(exec.agent.id)
      else if (state.pendingActions.size === 0 && hasRunningChild(state)) return acceptAndConclude(exec, value, downstream)
    }
    return downstream
  })
}

export function installReportTool(childCtx, ctx) {
  const disposeSection = childCtx.systemPrompt.section({
    name: 'tool:report',
    order: REPORT_SECTION_ORDER,
    text: 'Deliver your result with the report tool before you finish: call it once with a self-contained answer. The agent that started you shares your workspace but does not automatically receive your transcript, tool output, or reasoning. Reporting does not end your turn.',
  })
  const disposeTool = childCtx.tools.register({
    name: 'report',
    description: 'Report selected content to the agent that started you. Reporting does not end your turn.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { output: { type: 'string' } }, required: ['output'],
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: { messageId: { type: 'string' } }, required: ['messageId'],
      },
      render: (_args, value) => [{ type: 'text', text: `report accepted as message ${value.messageId}` }],
    },
    async execute(args, exec) {
      const messageId = await ctx.subagents.reportFrom(
        exec.agent,
        [{ type: 'text', text: args.output }],
        { delivery: reportDeliveryForWorkspace(workspaceCwd(exec)), signal: exec.signal },
      )
      return { messageId }
    },
  })
  return () => { disposeTool(); disposeSection() }
}

export function apply(ctx, adapter = runAdapter) {
  ctx.systemPrompt?.section({
    name: 'pangea:dsh-workspace',
    order: 116,
    text: workspaceInstructions,
  })
  ctx.subagents.registerContinuableSetup(childCtx => installReportTool(childCtx, ctx))
  installPangeaLifecyclePolicy(ctx, adapter)
}
