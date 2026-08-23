import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export const name = 'dsh-pangea-companion-report-policy'
export const inject = ['subagents', 'tools', 'systemPrompt']

const PANGEA_WORKSPACE_MARKER = join('.agents', 'pangea', 'dsh.md')
const REPORT_SECTION_ORDER = 117
const PANGEA_CLI = '-m pangea_agent.cli.main '
const PENDING_CONTRACT_SUFFIX = 'pangea-data/.pangea/pending-task-contract.json'

export function isPangeaWorkspace(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return false
  let current = resolve(cwd)
  while (true) {
    if (existsSync(join(current, PANGEA_WORKSPACE_MARKER))) return true
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
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

function isPangeaCliCommand(command, subcommand) {
  return typeof command === 'string' && command.includes(`${PANGEA_CLI}${subcommand}`)
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
  if (typeof value === 'string') {
    return !/\[(?:exit code|shell exited: code):?\s*[1-9]\d*\]/i.test(value)
  }
  return value?.kind === 'foreground'
    && value.exitCode === 0
    && value.timedOut !== true
    && value.aborted !== true
}

function parseGraphOutput(value) {
  const actions = []
  let runId
  let dataRoot
  let phase
  for (const line of commandText(value).split(/\r?\n/)) {
    if (line.startsWith('run_id=')) runId = line.slice('run_id='.length).trim()
    else if (line.startsWith('data_root=')) dataRoot = line.slice('data_root='.length).trim()
    else if (line.startsWith('phase=')) phase = line.slice('phase='.length).trim()
    else if (line.startsWith('action=')) {
      try {
        const action = JSON.parse(line.slice('action='.length))
        if (
          (action.action === 'dispatch_agent' || action.action === 'continue_agent')
          && typeof action.task_path === 'string'
          && action.task_path !== ''
        ) actions.push(action)
      } catch {
        // The CLI owns the action contract. A malformed line is not guessed here.
      }
    }
  }
  return { actions, runId, dataRoot, phase }
}

function actionKey(action) {
  return `${action.action}\u0000${action.task_path}\u0000${action.task_id ?? ''}`
}

function pendingActionFor(state, exec) {
  for (const [key, action] of state.pendingActions) {
    if (
      action.action === 'dispatch_agent'
      && exec.name === 'subagent'
      && exec.arguments?.run_in_background === true
      && exec.arguments?.prompt === action.task_path
    ) return { key, action }
    if (
      action.action === 'continue_agent'
      && exec.name === 'send_message'
      && exec.arguments?.subagent_id === action.task_id
      && exec.arguments?.message === action.task_path
    ) return { key, action }
  }
  return undefined
}

function recordTargetFor(state, exec) {
  const command = commandOf(exec)
  if (!isPangeaCliCommand(command, 'record-agent-session')) return undefined
  for (const [childId, child] of state.activeChildren) {
    if (!child.recorded && commandHasFlagValue(command, '--task-id', childId)) {
      return { childId, child }
    }
  }
  return undefined
}

function isBoundResume(state, exec) {
  const command = commandOf(exec)
  if (!isPangeaCliCommand(command, 'resume-run')) return false
  if (state.runId && !commandHasFlagValue(command, '--run-id', state.runId)) return false
  if (state.dataRoot && !commandHasFlagValue(command, '--data-root', state.dataRoot)) return false
  return true
}

function requiredResumeMessage(state) {
  const runFlag = state.runId ? ` --run-id ${state.runId}` : ''
  const dataRootFlag = state.dataRoot ? ` --data-root ${state.dataRoot}` : ''
  return (
    'PANGEA 子 Agent 已结束；下一步只能执行当前 Run 的一次 resume-run，由 Graph 决定后续 action。'
    + ` 请原样执行：python -m pangea_agent.cli.main resume-run${runFlag}${dataRootFlag}`
  )
}

function isPendingContractCleanup(exec) {
  const command = commandOf(exec)?.trim()
  if (!command) return false
  const posix = command.match(/^rm\s+-f\s+(?:--\s+)?(?:"([^"]+)"|'([^']+)'|(\S+))$/)
  const powershell = command.match(
    /^Remove-Item\s+(?:-Force\s+)?-LiteralPath\s+(?:"([^"]+)"|'([^']+)')(?:\s+-Force)?$/i,
  )
  const path = posix?.slice(1).find(Boolean) ?? powershell?.slice(1).find(Boolean)
  return typeof path === 'string'
    && path.replaceAll('\\', '/').endsWith(PENDING_CONTRACT_SUFFIX)
}

function normalizedPath(value) {
  return value.replaceAll('\\', '/')
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
      task.independent_result_path,
      ...(Array.isArray(task.analysis_results)
        ? task.analysis_results.map(item => item?.result_path)
        : []),
    ]
      .filter(value => typeof value === 'string' && value !== '')
      .map(value => resolve(cwd, value))
      .filter(value => value !== allowedResult)
    return { allowedResult, protectedPaths }
  } catch {
    return undefined
  }
}

function commandReferencesPath(command, cwd, target) {
  const normalized = normalizedPath(command)
  const absolute = normalizedPath(target)
  const local = normalizedPath(relative(cwd, target))
  return normalized.includes(absolute) || (local !== '' && normalized.includes(local))
}

function childArtifactMutationBlock(taskPath, exec) {
  const cwd = workspaceCwd(exec)
  if (!cwd) return undefined
  const policy = childTaskWritePolicy(taskPath, cwd)
  if (!policy) return undefined

  if (exec.name === 'write') {
    return 'PANGEA 正式结果必须由 CLI 先生成骨架，再用 Edit 局部修改；禁止整文件 Write。'
  }

  if (exec.name === 'edit') {
    const target = exec.arguments?.file_path ?? exec.arguments?.path
    if (typeof target !== 'string' || resolve(cwd, target) !== policy.allowedResult) {
      return `PANGEA 子 Agent 只能编辑当前 Graph task 的 result_path：${policy.allowedResult}`
    }
    return undefined
  }

  const command = commandOf(exec)
  if (!command || isPangeaCliCommand(command, 'prepare-worker-result')
    || isPangeaCliCommand(command, 'prepare-review-result')
    || isPangeaCliCommand(command, 'validate-worker-result')
    || isPangeaCliCommand(command, 'check-review-artifact')
    || isPangeaCliCommand(command, 'read-material')) return undefined
  const canMutate = /(?:^|\s)(?:python(?:3)?|perl|ruby|node|tee|cp|mv|rm)(?:\s|$)|sed\s+-i|(?:^|[^>])>{1,2}(?:[^>]|$)|Set-Content|Out-File/i.test(command)
  const formalArtifacts = [policy.allowedResult, ...policy.protectedPaths]
  if (canMutate && formalArtifacts.some(target => commandReferencesPath(command, cwd, target))) {
    return 'PANGEA 子 Agent 不得通过 Bash 修改正式 JSON；当前 result_path 只能用 Edit 局部修改。'
  }
  return undefined
}

function hasUnrecordedChild(state) {
  return [...state.activeChildren.values()].some(child => !child.recorded)
}

function hasRunningChild(state) {
  return [...state.activeChildren.values()].some(child => child.status === 'running')
}

function shouldEndDispatchTurn(state) {
  return state.pendingActions.size === 0
    && !hasUnrecordedChild(state)
    && !state.resumeRequired
    && hasRunningChild(state)
}

function acceptedValue(result, downstream) {
  if (downstream.kind === 'accept' && Object.hasOwn(downstream, 'value')) return downstream.value
  return result.value
}

function acceptAndConclude(exec, value, downstream) {
  exec.concludeTurn()
  return {
    kind: 'accept',
    value,
    ...(downstream.additionalContexts ? { additionalContexts: downstream.additionalContexts } : {}),
  }
}

export function installPangeaLifecyclePolicy(ctx) {
  const states = new Map()
  const childTasks = new Map()

  const stateFor = agent => agent ? states.get(agent.id) : undefined
  const saveState = (agent, state) => states.set(agent.id, state)
  const deleteState = agent => states.delete(agent.id)

  ctx.tools.guard(exec => {
    const childTask = exec?.agent ? childTasks.get(exec.agent.id) : undefined
    if (childTask) {
      const blocked = childArtifactMutationBlock(childTask, exec)
      if (blocked) return blocked
    }
    const state = stateFor(exec.agent)
    if (!state || !isPangeaWorkspace(workspaceCwd(exec))) return undefined

    if (state.protocolError) {
      if (isBoundResume(state, exec)) return undefined
      return 'PANGEA Graph 仍在等待阶段，但客户端没有解析到合法 action；只能对当前 Run 重试一次 resume-run，不得读取产物、猜阶段或自行派发。'
    }

    if (hasUnrecordedChild(state)) {
      if (recordTargetFor(state, exec)) return undefined
      if (pendingActionFor(state, exec)) return undefined
      return 'PANGEA 已派发子 Agent；下一步只能用 record-agent-session 绑定真实 subagent_id。'
    }
    if (state.resumeRequired) {
      if (isBoundResume(state, exec)) return undefined
      return requiredResumeMessage(state)
    }
    if (state.pendingActions.size > 0) {
      if (isPendingContractCleanup(exec)) return undefined
      if (pendingActionFor(state, exec)) return undefined
      return 'PANGEA Graph 已返回待执行 action；只能按其 task_path 派发或续接对应子 Agent。'
    }
    if (hasRunningChild(state)) {
      return 'PANGEA 子 Agent 仍在运行；禁止轮询、催促、读取产物或提前 resume-run，请等待 subagent-settled。'
    }
    return undefined
  })

  const noticeSettled = ({ agent, message }) => {
    if (message?.source?.kind !== 'subagent-settled') return
    const state = stateFor(agent)
    const childId = message.source.senderSessionId
    const child = state?.activeChildren.get(childId)
    if (!state || !child || child.status !== 'running') return
    child.status = 'settled'
    state.resumeRequired = true
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

    if (
      exec.name === 'bash'
      && bashSucceeded(value)
      && (isPangeaCliCommand(command, 'module-analysis') || isPangeaCliCommand(command, 'resume-run'))
    ) {
      const parsed = parseGraphOutput(value)
      if (isPangeaCliCommand(command, 'module-analysis')) {
        state = {
          runId: parsed.runId,
          dataRoot: parsed.dataRoot,
          pendingActions: new Map(parsed.actions.map(action => [actionKey(action), action])),
          activeChildren: new Map(),
          resumeRequired: false,
          protocolError: parsed.actions.length === 0 && parsed.phase?.startsWith('WAITING_'),
        }
        if (state.pendingActions.size > 0 || state.protocolError) saveState(exec.agent, state)
        return downstream
      }
      if ((state?.resumeRequired || state?.protocolError) && isBoundResume(state, exec)) {
        for (const [childId, child] of state.activeChildren) {
          if (child.status === 'settled') state.activeChildren.delete(childId)
        }
        state.resumeRequired = false
        state.runId = parsed.runId || state.runId
        state.dataRoot = parsed.dataRoot || state.dataRoot
        state.pendingActions = new Map(parsed.actions.map(action => [actionKey(action), action]))
        state.protocolError = parsed.actions.length === 0 && parsed.phase?.startsWith('WAITING_')
        if (state.protocolError) return downstream
        if (state.pendingActions.size === 0 && state.activeChildren.size === 0) {
          deleteState(exec.agent)
          return downstream
        }
        if (state.pendingActions.size === 0 && hasRunningChild(state)) {
          return acceptAndConclude(exec, value, downstream)
        }
        return downstream
      }
    }

    if (!state) return downstream
    const pending = pendingActionFor(state, exec)
    if (pending && !result.isError) {
      if (pending.action.action === 'dispatch_agent') {
        if (value?.kind !== 'continuable' || typeof value.subagentId !== 'string') return downstream
        state.pendingActions.delete(pending.key)
        state.activeChildren.set(value.subagentId, {
          taskPath: pending.action.task_path,
          recorded: false,
          status: 'running',
        })
        childTasks.set(value.subagentId, pending.action.task_path)
        return downstream
      }
      state.pendingActions.delete(pending.key)
      state.activeChildren.set(pending.action.task_id, {
        taskPath: pending.action.task_path,
        recorded: true,
        status: 'running',
      })
      childTasks.set(pending.action.task_id, pending.action.task_path)
      if (shouldEndDispatchTurn(state)) return acceptAndConclude(exec, value, downstream)
      return downstream
    }

    const recordTarget = recordTargetFor(state, exec)
    if (recordTarget && bashSucceeded(value)) {
      recordTarget.child.recorded = true
      if (shouldEndDispatchTurn(state)) return acceptAndConclude(exec, value, downstream)
    }
    return downstream
  })
}

export function installReportTool(childCtx, ctx) {
  const disposeSection = childCtx.systemPrompt.section({
    name: 'tool:report',
    order: REPORT_SECTION_ORDER,
    text: 'Deliver your result with the report tool before you finish: call it once with a self-contained answer. The agent that started you shares your workspace but does not automatically receive your transcript, tool output, or reasoning, so a closing remark such as "done" leaves it nothing it can use. Report earlier as well whenever a partial finding changes what that agent should do next; reporting never ends your turn.',
  })
  const disposeTool = childCtx.tools.register({
    name: 'report',
    description: 'Report selected content to the agent that started you. Reporting does not end your turn or finish your work.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        output: {
          type: 'string',
          description: 'Actionable content for your parent; summarize conclusions and reference relevant shared paths.',
        },
      },
      required: ['output'],
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { messageId: { type: 'string' } },
        required: ['messageId'],
      },
      render: (_args, value) => [{
        type: 'text',
        text: `report accepted by the agent that started you as message ${value.messageId}`,
      }],
    },
    async execute(args, exec) {
      const delivery = reportDeliveryForWorkspace(workspaceCwd(exec))
      const messageId = await ctx.subagents.reportFrom(
        exec.agent,
        [{ type: 'text', text: args.output }],
        { delivery, signal: exec.signal },
      )
      return { messageId }
    },
  })

  return () => {
    disposeTool()
    disposeSection()
  }
}

export function apply(ctx) {
  ctx.subagents.registerContinuableSetup(childCtx => installReportTool(childCtx, ctx))
  installPangeaLifecyclePolicy(ctx)
}
