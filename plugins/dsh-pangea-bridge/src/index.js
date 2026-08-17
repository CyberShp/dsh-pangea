import { execFile } from 'node:child_process'
import { constants as fsConstants } from 'node:fs'
import { access, mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const name = 'dsh-pangea-bridge'
export const inject = ['tools', 'subagents']

const DEFAULT_PANGEA_ROOT = '/Volumes/Media/pangea-agent'
const SUBAGENT_PROVIDER = 'spawn'
const CHILD_AGENT_TOOLS = [
  'subagent',
  'subagent_fork',
  'send_message',
  'interrupt_agent',
  'list_agents',
  'workflow',
  'ralph',
  'pangea_run',
  'pangea_analyze',
]

const RUN_PHASES = [
  'PREPARING',
  'WAITING_ANALYSIS',
  'WAITING_REVIEW',
  'WAITING_REWORK',
  'WAITING_REWORK_REVIEW',
  'READY_TO_FINALIZE',
  'COMPLETE',
  'INCOMPLETE',
]

const TERMINAL_PHASES = new Set(['COMPLETE', 'INCOMPLETE'])

const RUN_TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['pangea_root', 'contract_path'],
  properties: {
    pangea_root: {
      type: 'string',
      description: 'Absolute path to the existing pangea-agent checkout.',
    },
    contract_path: {
      type: 'string',
      description: 'Absolute path to a PANGEA task contract, or a path relative to pangea_root.',
    },
    python_executable: {
      type: 'string',
      description: 'Optional Python executable. By default the bridge uses pangea_root/.venv.',
    },
  },
}

const ANALYZE_TOOL_PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  required: ['data_root', 'repository', 'target', 'source_scope'],
  properties: {
    pangea_root: {
      type: 'string',
      description: `PANGEA checkout path. Omit to use ${DEFAULT_PANGEA_ROOT}.`,
    },
    data_root: {
      type: 'string',
      description: 'Absolute PANGEA data directory containing repositories/, inbox/, coverage/, and runs/.',
    },
    repository: {
      type: 'string',
      description: 'Repository id under data_root/repositories, not an arbitrary source path.',
    },
    target: {
      type: 'string',
      description: 'The module, API, or behavior to analyze.',
    },
    source_scope: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'Repository-relative source files or directories that anchor the analysis.',
    },
    focus: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
      description: 'Optional analysis focus. Defaults to the target.',
    },
    run_id: {
      type: 'string',
      description: 'Optional readable run id. Reuse it to resume that run; omit it to generate one.',
    },
    python_executable: {
      type: 'string',
      description: 'Optional Python executable. By default the bridge uses pangea_root/.venv.',
    },
  },
}

const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'status',
    'run_id',
    'phase',
    'resumed',
    'pangea_root',
    'contract_path',
    'data_root',
    'run_directory',
    'progress_path',
    'task_paths',
    'report_paths',
  ],
  properties: {
    status: { type: 'string', const: 'ok' },
    run_id: { type: 'string' },
    phase: { type: 'string', enum: RUN_PHASES },
    resumed: { type: 'boolean' },
    pangea_root: { type: 'string' },
    contract_path: { type: 'string' },
    data_root: { type: 'string' },
    run_directory: { type: 'string' },
    progress_path: { type: 'string' },
    task_paths: { type: 'array', items: { type: 'string' } },
    report_paths: { type: 'array', items: { type: 'string' } },
  },
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requireNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`)
  }
  return value
}

function requireStringArray(value, field) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${field} must be a non-empty array`)
  }
  return value.map((item, index) => requireNonEmptyString(item, `${field}[${index}]`))
}

async function pathKind(filePath) {
  try {
    const details = await stat(filePath)
    if (details.isFile()) return 'file'
    if (details.isDirectory()) return 'directory'
    return 'other'
  }
  catch (error) {
    if (error && error.code === 'ENOENT') return 'missing'
    throw error
  }
}

async function requirePathKind(filePath, expected, label) {
  const actual = await pathKind(filePath)
  if (actual !== expected) {
    throw new Error(`${label} must be an existing ${expected}: ${filePath}`)
  }
}

async function readJsonObject(filePath, label) {
  let value
  try {
    value = JSON.parse(await readFile(filePath, 'utf8'))
  }
  catch (error) {
    throw new Error(`${label} is not readable JSON: ${filePath}: ${error.message}`, { cause: error })
  }
  if (!isPlainObject(value)) {
    throw new Error(`${label} must contain a JSON object: ${filePath}`)
  }
  return value
}

function resolveFromRoot(root, inputPath) {
  return path.resolve(root, inputPath)
}

async function resolvePythonExecutable(pangeaRoot, requested) {
  if (requested !== undefined) {
    const value = requireNonEmptyString(requested, 'python_executable')
    const executable = path.isAbsolute(value) ? value : resolveFromRoot(pangeaRoot, value)
    await access(executable, fsConstants.X_OK)
    return executable
  }

  const candidates = process.platform === 'win32'
    ? [path.join(pangeaRoot, '.venv', 'Scripts', 'python.exe')]
    : [path.join(pangeaRoot, '.venv', 'bin', 'python')]

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    }
    catch (error) {
      if (!error || (error.code !== 'ENOENT' && error.code !== 'EACCES')) throw error
    }
  }
  throw new Error(`PANGEA virtual-environment Python was not found under ${pangeaRoot}; provide python_executable explicitly`)
}

async function listJsonFiles(directory) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => path.join(directory, entry.name))
      .sort()
  }
  catch (error) {
    if (error && error.code === 'ENOENT') return []
    throw error
  }
}

async function existingFiles(paths) {
  const found = []
  for (const filePath of paths) {
    if (await pathKind(filePath) === 'file') found.push(filePath)
  }
  return found
}

async function phaseTaskPaths(runDirectory, phase) {
  const taskRoot = path.join(runDirectory, 'agent-tasks')
  switch (phase) {
    case 'WAITING_ANALYSIS':
      return listJsonFiles(path.join(taskRoot, 'analysis'))
    case 'WAITING_REVIEW':
      return existingFiles([path.join(taskRoot, 'review.json')])
    case 'WAITING_REWORK':
      return listJsonFiles(path.join(taskRoot, 'rework'))
    case 'WAITING_REWORK_REVIEW':
      return existingFiles([path.join(taskRoot, 'rework-review.json')])
    default:
      return []
  }
}

function subprocessFailure(error, executable) {
  const stderr = typeof error.stderr === 'string' ? error.stderr.trim() : ''
  const stdout = typeof error.stdout === 'string' ? error.stdout.trim() : ''
  const details = [stderr, stdout].filter(Boolean).join('\n')
  const suffix = details === '' ? '' : `\n${details}`
  return new Error(`PANGEA CLI failed via ${executable}: ${error.message}${suffix}`, { cause: error })
}

async function runCli(pangeaRoot, pythonExecutable, args, signal) {
  try {
    return await execFileAsync(
      pythonExecutable,
      ['-m', 'pangea_agent.cli.main', ...args],
      {
        cwd: pangeaRoot,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        signal,
      },
    )
  }
  catch (error) {
    throw subprocessFailure(error, pythonExecutable)
  }
}

async function readRunSnapshot(pangeaRoot, contractPath, runId, dataRoot, resumed) {
  const runDirectory = path.join(dataRoot, 'runs', runId)
  const progressPath = path.join(runDirectory, 'progress.json')
  const progress = await readJsonObject(progressPath, 'PANGEA progress')
  if (progress.run_id !== runId) {
    throw new Error(`PANGEA progress run_id does not match the contract: ${String(progress.run_id)} != ${runId}`)
  }
  if (!RUN_PHASES.includes(progress.phase)) {
    throw new Error(`PANGEA progress contains an unknown phase: ${String(progress.phase)}`)
  }

  return {
    status: 'ok',
    run_id: runId,
    phase: progress.phase,
    resumed,
    pangea_root: pangeaRoot,
    contract_path: contractPath,
    data_root: dataRoot,
    run_directory: runDirectory,
    progress_path: progressPath,
    task_paths: await phaseTaskPaths(runDirectory, progress.phase),
    report_paths: await existingFiles([
      path.join(runDirectory, 'report.md'),
      path.join(runDirectory, 'report.html'),
    ]),
  }
}

export async function runPangeaModuleAnalysis(input, options = {}) {
  if (!isPlainObject(input)) throw new TypeError('tool arguments must be an object')

  const pangeaRootInput = requireNonEmptyString(input.pangea_root, 'pangea_root')
  if (!path.isAbsolute(pangeaRootInput)) throw new Error('pangea_root must be an absolute path')
  const pangeaRoot = path.resolve(pangeaRootInput)
  await requirePathKind(pangeaRoot, 'directory', 'pangea_root')

  const contractInput = requireNonEmptyString(input.contract_path, 'contract_path')
  const contractPath = path.isAbsolute(contractInput)
    ? path.resolve(contractInput)
    : resolveFromRoot(pangeaRoot, contractInput)
  await requirePathKind(contractPath, 'file', 'contract_path')

  const contractBefore = await readJsonObject(contractPath, 'PANGEA task contract')
  const priorRunId = typeof contractBefore.run_id === 'string' && contractBefore.run_id !== ''
    ? contractBefore.run_id
    : undefined
  const priorDataRoot = typeof contractBefore.data_root === 'string' && contractBefore.data_root !== ''
    ? resolveFromRoot(pangeaRoot, contractBefore.data_root)
    : path.join(pangeaRoot, 'pangea-data')
  const priorProgressPath = priorRunId === undefined
    ? undefined
    : path.join(priorDataRoot, 'runs', priorRunId, 'progress.json')
  const resumed = priorProgressPath !== undefined && await pathKind(priorProgressPath) === 'file'

  const pythonExecutable = await resolvePythonExecutable(pangeaRoot, input.python_executable)
  await runCli(pangeaRoot, pythonExecutable, ['module-analysis', '--contract', contractPath], options.signal)

  const contractAfter = await readJsonObject(contractPath, 'PANGEA task contract')
  const runId = requireNonEmptyString(contractAfter.run_id, 'contract.run_id')
  if (priorRunId !== undefined && priorRunId !== runId) {
    throw new Error(`PANGEA changed the existing run_id from ${priorRunId} to ${runId}`)
  }
  const dataRoot = typeof contractAfter.data_root === 'string' && contractAfter.data_root !== ''
    ? resolveFromRoot(pangeaRoot, contractAfter.data_root)
    : path.join(pangeaRoot, 'pangea-data')
  return readRunSnapshot(pangeaRoot, contractPath, runId, dataRoot, resumed)
}

function readableRunId(target, now = new Date()) {
  const base = target
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'analysis'
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  return `${base}-${stamp}`
}

function validateRunId(value) {
  const runId = requireNonEmptyString(value, 'run_id')
  if (runId === '.' || runId === '..' || runId.includes('/') || runId.includes('\\')) {
    throw new Error('run_id must be a directory-safe name, not a path')
  }
  return runId
}

async function createOrResumeRun(input, signal) {
  if (!isPlainObject(input)) throw new TypeError('tool arguments must be an object')

  const pangeaRootInput = input.pangea_root ?? DEFAULT_PANGEA_ROOT
  if (!path.isAbsolute(pangeaRootInput)) throw new Error('pangea_root must be an absolute path')
  const pangeaRoot = path.resolve(requireNonEmptyString(pangeaRootInput, 'pangea_root'))
  await requirePathKind(pangeaRoot, 'directory', 'pangea_root')

  const dataRootInput = requireNonEmptyString(input.data_root, 'data_root')
  if (!path.isAbsolute(dataRootInput)) throw new Error('data_root must be an absolute path')
  const dataRoot = path.resolve(dataRootInput)
  await requirePathKind(dataRoot, 'directory', 'data_root')

  const repository = requireNonEmptyString(input.repository, 'repository')
  await requirePathKind(path.join(dataRoot, 'repositories', repository), 'directory', 'repository')
  const target = requireNonEmptyString(input.target, 'target')
  const sourceScope = requireStringArray(input.source_scope, 'source_scope')
  const focus = input.focus === undefined ? [target] : requireStringArray(input.focus, 'focus')
  const runId = input.run_id === undefined ? readableRunId(target) : validateRunId(input.run_id)
  const pythonExecutable = await resolvePythonExecutable(pangeaRoot, input.python_executable)
  const runDirectory = path.join(dataRoot, 'runs', runId)
  const progressPath = path.join(runDirectory, 'progress.json')
  const resumed = await pathKind(progressPath) === 'file'

  if (resumed) {
    const contractPath = path.join(runDirectory, 'inputs', 'task-contract.json')
    await requirePathKind(contractPath, 'file', 'frozen task contract')
    await runCli(pangeaRoot, pythonExecutable, [
      'resume-run', '--run-id', runId, '--data-root', dataRoot,
    ], signal)
    return {
      snapshot: await readRunSnapshot(pangeaRoot, contractPath, runId, dataRoot, true),
      pythonExecutable,
    }
  }

  const pendingDirectory = path.join(dataRoot, '.pangea')
  const contractPath = path.join(pendingDirectory, 'pending-task-contract.json')
  await mkdir(pendingDirectory, { recursive: true })
  await writeFile(contractPath, `${JSON.stringify({
    run_id: runId,
    data_root: dataRoot,
    mode: 'module_analysis',
    repository,
    target,
    source_scope: sourceScope,
    focus,
  }, null, 2)}\n`, 'utf8')
  await runCli(pangeaRoot, pythonExecutable, ['module-analysis', '--contract', contractPath], signal)
  const frozenContractPath = path.join(runDirectory, 'inputs', 'task-contract.json')
  await requirePathKind(frozenContractPath, 'file', 'frozen task contract')
  await unlink(contractPath)
  return {
    snapshot: await readRunSnapshot(pangeaRoot, frozenContractPath, runId, dataRoot, false),
    pythonExecutable,
  }
}

function outputText(output) {
  return output
    .filter(item => item && item.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('\n')
}

function childFailure(label, endInfo) {
  const suffix = outputText(endInfo.output ?? endInfo.lastAssistantMessage ?? [])
  return new Error(`${label} ended with ${endInfo.stopReason}${suffix ? `:\n${suffix}` : ''}`)
}

function createSubagentCoordinator(ctx, parent, signal) {
  function endListener(onEnd) {
    return ctx.on('subagent/end', info => onEnd({
      id: info.id,
      stopReason: info.stopReason,
      output: info.lastAssistantMessage ?? [],
    }))
  }

  async function start(label, prompt, persona) {
    const ended = new Map()
    let resolveTarget
    const targetEnd = new Promise(resolve => { resolveTarget = resolve })
    let targetId
    const dispose = endListener((info) => {
      ended.set(info.id, info)
      if (info.id === targetId) resolveTarget(info)
    })
    try {
      const start = await ctx.subagents.startContinuable({
        provider: SUBAGENT_PROVIDER,
        label,
        request: {
          prompt: [{ type: 'text', text: prompt }],
          parent,
          maxDepth: 1,
          toolFilter: { deny: CHILD_AGENT_TOOLS },
          persona,
        },
        signal,
      })
      targetId = start.childId
      const completion = Promise.resolve(ended.get(targetId) ?? targetEnd)
        .then((endInfo) => {
          if (endInfo.stopReason !== 'completed') throw childFailure(label, endInfo)
          return endInfo
        })
        .finally(dispose)
      return { childId: targetId, completion }
    }
    catch (error) {
      dispose()
      throw error
    }
  }

  async function followupAndWait(childId, label, prompt) {
    let accepted = false
    let resolveTarget
    const targetEnd = new Promise(resolve => { resolveTarget = resolve })
    const dispose = endListener((info) => {
      if (accepted && info.id === childId) resolveTarget(info)
    })
    try {
      await ctx.subagents.followup(
        parent,
        childId,
        [{ type: 'text', text: prompt }],
        {
          source: {
            kind: 'coordinator',
            form: 'relay',
            senderSessionId: parent.session.id,
          },
          signal,
        },
      )
      accepted = true
      const endInfo = await targetEnd
      if (endInfo.stopReason !== 'completed') throw childFailure(label, endInfo)
      return endInfo
    }
    finally {
      dispose()
    }
  }

  return { start, followupAndWait }
}

async function readWorkerIdentity(taskPath) {
  const task = await readJsonObject(taskPath, 'PANGEA worker task')
  const unit = isPlainObject(task.unit) ? task.unit : {}
  return {
    unitId: requireNonEmptyString(unit.unit_id, 'worker task unit.unit_id'),
  }
}

function sessionKey(role, unitId) {
  return role === 'review' ? 'review' : `${role}:${unitId}`
}

async function recordAgentSession(snapshot, pythonExecutable, role, unitId, taskId, status, signal) {
  const args = [
    'record-agent-session',
    '--run-id', snapshot.run_id,
    '--data-root', snapshot.data_root,
    '--role', role,
    '--status', status,
  ]
  if (unitId !== undefined) args.push('--unit-id', unitId)
  if (taskId !== undefined) args.push('--task-id', taskId)
  await runCli(snapshot.pangea_root, pythonExecutable, args, signal)
}

async function validateWorker(snapshot, pythonExecutable, taskPath, signal) {
  try {
    const result = await runCli(
      snapshot.pangea_root,
      pythonExecutable,
      ['validate-worker-result', '--task', taskPath],
      signal,
    )
    return { ok: result.stdout.trim() === 'PASS', message: result.stdout.trim() }
  }
  catch (error) {
    return { ok: false, message: error.message }
  }
}

async function runWorkerTask({
  snapshot,
  pythonExecutable,
  taskPath,
  role,
  persona,
  coordinator,
  signal,
}) {
  const { unitId } = await readWorkerIdentity(taskPath)
  let progress = await readJsonObject(snapshot.progress_path, 'PANGEA progress')
  const key = sessionKey(role, unitId)
  let session = isPlainObject(progress.agent_sessions) ? progress.agent_sessions[key] : undefined
  let validation = await validateWorker(snapshot, pythonExecutable, taskPath, signal)

  if (!validation.ok) {
    let childId = typeof session?.task_id === 'string' && session.task_id !== '' ? session.task_id : undefined
    if (childId === undefined) {
      const started = await coordinator.start(`PANGEA ${role} ${unitId}`, taskPath, persona)
      childId = started.childId
      await recordAgentSession(snapshot, pythonExecutable, role, unitId, childId, 'dispatched', signal)
      await started.completion
    }
    else {
      await coordinator.followupAndWait(childId, `PANGEA ${role} ${unitId}`, taskPath)
    }

    validation = await validateWorker(snapshot, pythonExecutable, taskPath, signal)
    while (!validation.ok) {
      await coordinator.followupAndWait(
        childId,
        `PANGEA ${role} ${unitId} validation correction`,
        `继续处理同一个 PANGEA task，直到 validate-worker-result 返回 PASS。\nTask: ${taskPath}\nValidation output:\n${validation.message}`,
      )
      validation = await validateWorker(snapshot, pythonExecutable, taskPath, signal)
    }
  }

  progress = await readJsonObject(snapshot.progress_path, 'PANGEA progress')
  session = isPlainObject(progress.agent_sessions) ? progress.agent_sessions[key] : undefined
  const recordedTaskId = typeof session?.task_id === 'string' && session.task_id !== ''
    ? session.task_id
    : undefined
  await recordAgentSession(snapshot, pythonExecutable, role, unitId, recordedTaskId, 'completed', signal)
}

async function runReviewTask({
  snapshot,
  pythonExecutable,
  taskPath,
  persona,
  coordinator,
  signal,
  continuation,
}) {
  const progress = await readJsonObject(snapshot.progress_path, 'PANGEA progress')
  const review = isPlainObject(progress.agent_sessions) ? progress.agent_sessions.review : undefined
  const existingId = typeof review?.task_id === 'string' && review.task_id !== '' ? review.task_id : undefined
  let childId = existingId

  if (continuation) {
    if (childId === undefined) {
      throw new Error('PANGEA requires the original review-worker for rework verification, but its session id is missing')
    }
    await coordinator.followupAndWait(childId, 'PANGEA rework verification', taskPath)
  }
  else if (childId === undefined) {
    const started = await coordinator.start('PANGEA independent review', taskPath, persona)
    childId = started.childId
    await recordAgentSession(snapshot, pythonExecutable, 'review', undefined, childId, 'dispatched', signal)
    await started.completion
  }
  else if (review.status !== 'completed') {
    await coordinator.followupAndWait(childId, 'PANGEA independent review', taskPath)
  }

  await recordAgentSession(snapshot, pythonExecutable, 'review', undefined, childId, 'completed', signal)
}

async function resumeRun(snapshot, pythonExecutable, signal) {
  await runCli(snapshot.pangea_root, pythonExecutable, [
    'resume-run', '--run-id', snapshot.run_id, '--data-root', snapshot.data_root,
  ], signal)
  return readRunSnapshot(
    snapshot.pangea_root,
    path.join(snapshot.run_directory, 'inputs', 'task-contract.json'),
    snapshot.run_id,
    snapshot.data_root,
    true,
  )
}

async function runAtMost(items, limit, worker) {
  const pending = [...items]
  const runners = Array.from(
    { length: Math.min(limit, pending.length) },
    async () => {
      while (pending.length > 0) {
        await worker(pending.shift())
      }
    },
  )
  await Promise.all(runners)
}

export async function runPangeaEndToEnd(input, options) {
  const { coordinator, signal } = options
  const initialized = await createOrResumeRun(input, signal)
  let snapshot = initialized.snapshot
  const resumed = snapshot.resumed
  const pythonExecutable = initialized.pythonExecutable
  const analysisPersona = await readFile(
    path.join(snapshot.pangea_root, '.opencode', 'agents', 'analysis-worker.md'),
    'utf8',
  )
  const reviewPersona = await readFile(
    path.join(snapshot.pangea_root, '.opencode', 'agents', 'review-worker.md'),
    'utf8',
  )

  while (!TERMINAL_PHASES.has(snapshot.phase)) {
    switch (snapshot.phase) {
      case 'WAITING_ANALYSIS':
        await runAtMost(snapshot.task_paths, 4, taskPath => runWorkerTask({
          snapshot,
          pythonExecutable,
          taskPath,
          role: 'analysis',
          persona: analysisPersona,
          coordinator,
          signal,
        }))
        break
      case 'WAITING_REVIEW':
        await runReviewTask({
          snapshot,
          pythonExecutable,
          taskPath: snapshot.task_paths[0],
          persona: reviewPersona,
          coordinator,
          signal,
          continuation: false,
        })
        break
      case 'WAITING_REWORK':
        await runAtMost(snapshot.task_paths, 4, taskPath => runWorkerTask({
          snapshot,
          pythonExecutable,
          taskPath,
          role: 'rework',
          persona: analysisPersona,
          coordinator,
          signal,
        }))
        break
      case 'WAITING_REWORK_REVIEW':
        await runReviewTask({
          snapshot,
          pythonExecutable,
          taskPath: snapshot.task_paths[0],
          persona: reviewPersona,
          coordinator,
          signal,
          continuation: true,
        })
        break
      case 'PREPARING':
      case 'READY_TO_FINALIZE':
        break
      default:
        throw new Error(`PANGEA cannot be advanced from phase ${snapshot.phase}`)
    }
    snapshot = await resumeRun(snapshot, pythonExecutable, signal)
  }
  return { ...snapshot, resumed }
}

function renderResult(value) {
  const lines = [
    `PANGEA run: ${value.run_id}`,
    `Phase: ${value.phase}`,
    `Mode: ${value.resumed ? 'resumed existing run' : 'created or initialized run'}`,
    `Progress: ${value.progress_path}`,
  ]
  if (value.task_paths.length > 0) {
    lines.push('Agent tasks:', ...value.task_paths.map(item => `- ${item}`))
  }
  if (value.report_paths.length > 0) {
    lines.push('Reports:', ...value.report_paths.map(item => `- ${item}`))
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'pangea_run',
    description: 'Start or resume one existing PANGEA module-analysis contract and return its current phase and task paths. This low-level tool does not execute workers.',
    parameters: RUN_TOOL_PARAMETERS,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => renderResult(value),
    },
    timeoutMs: 10 * 60 * 1000,
    async execute(args, exec) {
      return runPangeaModuleAnalysis(args, { signal: exec.signal })
    },
  })

  ctx.tools.register({
    name: 'pangea_analyze',
    description: 'Run a complete PANGEA module analysis from a natural-language request. Ask the user for any missing data_root, repository id, target, or source_scope before calling. The tool creates or resumes the contract, runs up to four analysis workers, one independent reviewer, at most one PANGEA-directed rework, the same reviewer verification, and returns report.md/report.html.',
    parameters: ANALYZE_TOOL_PARAMETERS,
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: (_args, value) => renderResult(value),
    },
    timeoutMs: 2 * 60 * 60 * 1000,
    async execute(args, exec) {
      if (!exec.agent) throw new Error('pangea_analyze requires a calling DSH agent')
      return runPangeaEndToEnd(args, {
        signal: exec.signal,
        coordinator: createSubagentCoordinator(ctx, exec.agent, exec.signal),
      })
    },
  })
}
