function request(payload) {
  return { rpcId: `pangea-executor-${crypto.randomUUID()}`, payload }
}

function failure(error) {
  return new Error(`${error.code}: ${error.message}`)
}

function promptForExecution(input, environment) {
  return [
    '这是用户已经确认启动的 PANGEA 用例执行任务，不需要再次询问是否执行。',
    '先读取 `.agents/pangea/executor-dsh.md`，严格按独立 Executor Graph 返回的 action 工作；不要启动或修改原 module-analysis Graph。',
    `分析 Run：${input.analysis_run_id}`,
    `选中用例：${input.test_case_ids.join(', ')}`,
    `环境：${environment.id}`,
    `自动化仓库：${environment.automation_id}`,
    `PANGEA 数据目录：${input.data_root}`,
    '创建 Executor Run 后，派发 pangea-executor 子 Agent完成计划与执行；每条用例失败后完成清理，再继续下一条。',
  ].join('\n')
}

export async function launchExecution(api, input, environment) {
  const created = await api.sessions.create(request({
    ...(input.workspace_id ? { workspaceId: input.workspace_id } : {}),
  }))
  if (!created.result.ok) throw failure(created.result.error)
  const sessionId = created.result.value.sessionId
  const title = `PANGEA 执行 · ${input.test_case_ids.length} 条用例 · ${environment.name}`
  const renamed = await api.sessions.rename(request({ sessionId, title }))
  if (!renamed.result.ok) throw failure(renamed.result.error)
  const prompted = await api.sessions.prompt(request({
    sessionId,
    mode: 'queue',
    content: [{ type: 'text', text: promptForExecution(input, environment) }],
  }))
  if (!prompted.result.ok) throw failure(prompted.result.error)
  return { session_id: sessionId, title }
}
