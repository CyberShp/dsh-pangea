export function uiWorkbenchFixture(dataRoot, scene = 'running', count = 40) {
  const cases = Array.from({ length: count }, (_, index) => ({ test_case_id: `unit-tls/case-${index + 1}`, display_id: `TC-${String(index + 1).padStart(3, '0')}`, unit_id: index % 2 ? 'unit-cleanup' : 'unit-tls',
    title: ['握手超时后释放连接并允许再次建链', '密钥过期后报告原因并保持恢复入口', '无效认证参数被拒绝且业务不受影响', '链路恢复后重新建立 TLS 连接'][index % 4],
    case_type: index % 2 ? 'business_blackbox' : 'developer_assisted', readiness: index % 5 ? 'ready' : 'needs_setup',
    verification_goal: '观察异常后的连接状态与恢复能力。此为界面验证数据。',
    readiness_reason: index % 5 ? '通过主机命令与外部连接状态进行验证。' : '需要准备链路故障注入环境。',
    preconditions: ['主机与测试阵列网络可达', '已准备有效的测试密钥与独立测试子系统'],
    step_pairs: [{ action: '使用有效参数建立连接并确认业务可用', expected: '连接成功，业务读写正常' }, { action: '注入测试条件并记录主机侧错误及连接状态', expected: '失败原因可识别，既有连接按预期清理' }, { action: '恢复测试条件后重新发起连接', expected: '连接恢复，后续业务可继续' }],
    observability: ['主机连接状态与错误日志', '阵列端连接计数及资源释放情况'], cleanup: ['撤销故障注入，清理测试连接'],
    linked_risk_ids: ['risk-cleanup'], linked_flow_ids: ['flow-tls'], evidence: [{ location: 'storage:tls/handshake.c:1', quote: '/* UI verification fixture */' }] }))
  const risks = [{ risk_id: 'risk-cleanup', title: '连接失败后的资源释放路径需要实测验证', trigger: '握手过程被外部链路条件中断', narrative: '需要结合环境验证释放与重连行为；当前未执行测试。', severity: 'medium', linked_test_case_ids: cases.slice(0, 2).map(item => item.test_case_id), evidence: [{ location: 'storage:tls/handshake.c:1' }] }]
  const graph = { format_version: 'behavior-flow-v1', title: 'TLS 建链与异常恢复',
    nodes: [{ id: 'start', kind: 'entry', label: '发起连接' }, { id: 'handshake', kind: 'main', label: '执行 TLS 握手' }, { id: 'verify', kind: 'branch', label: '握手是否成功' }, { id: 'ready', kind: 'exit', label: '连接可用' }, { id: 'cleanup', kind: 'main', label: '释放失败连接' }, { id: 'retry', kind: 'exit', label: '保留重新建链入口' }],
    edges: [{ edge_id: 'e1', source_step_key: 'start', target_step_key: 'handshake' }, { edge_id: 'e2', source_step_key: 'handshake', target_step_key: 'verify' }, { edge_id: 'e3', source_step_key: 'verify', target_step_key: 'ready', label: '成功' }, { edge_id: 'e4', source_step_key: 'verify', target_step_key: 'cleanup', label: '超时或认证失败' }, { edge_id: 'e5', source_step_key: 'cleanup', target_step_key: 'retry' }],
    paths: [{ path_id: 'normal', label: '正常建链', node_ids: ['start', 'handshake', 'verify', 'ready'], edge_ids: ['e1', 'e2', 'e3'] }, { path_id: 'failure', label: '失败清理与恢复', node_ids: ['start', 'handshake', 'verify', 'cleanup', 'retry'], edge_ids: ['e1', 'e2', 'e4', 'e5'] }] }
  const flow = { flow_id: 'flow-tls', unit_id: 'unit-tls', title: 'TLS 握手与失败恢复', ...graph,
    branches: Array.from({ length: 27 }, (_, index) => ({ branch_id: `branch-${index + 1}`, from_step_id: 'verify', to_step_id: index % 2 ? 'ready' : 'cleanup', condition: index % 2 ? `有效输入组合 ${index + 1}` : `异常输入组合 ${index + 1}`, processing: '按对应分支进行连接状态处理', branch_type: index % 2 ? 'normal' : 'exception' })),
    mainline_steps: graph.nodes.map(item => ({ step_id: item.id, title: item.label, node_kind: item.kind })), transitions: graph.edges.map(item => ({ from_step_id: item.source_step_key, to_step_id: item.target_step_key, condition: item.label })), source_record: { kind: 'flow', record_id: 'flow-record', body: graph } }
  const complete = ['complete', 'partial'].includes(scene), failed = scene === 'failed', stopping = scene === 'stopping'
  const units = [{ unit_id: 'unit-tls', title: 'TLS 握手与失败恢复', status: complete ? 'accepted' : failed ? 'failed' : 'dispatched' }, { unit_id: 'unit-cleanup', title: '连接清理与重新建链', status: 'accepted' }]
  const steps = ['准备输入', '规划分析单元', '源码与业务分析', '复核与定向修正', '整理报告'].map((title, index) => ({ step: index + 1, title, stage: ['preparing', 'planning', 'analyzing', 'reviewing', 'reporting'][index], status: complete || index < 2 ? 'completed' : index === 2 ? failed ? 'failed' : 'running' : 'pending' }))
  const run = { run_id: 'ui-tls-run', task_id: 'ui-task', data_root: dataRoot, target: 'TLS 建链分析', repository: 'storage', source_scope: ['tls'], scenario: 'module-analysis', mode: 'depth', workflow_version: 'source-first-v1',
    lifecycle_status: failed ? 'failed' : complete ? 'complete' : 'running', phase: failed ? 'FAILED' : complete ? 'COMPLETE' : 'ANALYZING', phase_title: '源码与业务分析', terminal: failed || complete,
    started_at: '2026-10-21T04:00:00Z', ...(failed || complete ? { ended_at: '2026-10-21T04:16:00Z' } : {}),
    publication: { state: complete ? 'final' : 'draft', revision: 1 }, partial_delivery: scene === 'partial',
    analysis: { total: 12, completed: complete ? 12 : 8 }, source_snapshot: { file_count: 42, status: 'manifest_verified' }, input_materials: [{ asset_id: 'design', title: 'TLS 设计资料', revision: 2 }],
    counts: { business_flows: 1, risks: 1, test_cases: cases.length }, details: { test_cases: cases, risks, business_flows: [flow], notes: [], evidence: [] },
    workflow: { steps, current_step: complete ? 5 : 3, units, actions: [{ action_id: 'action-tls', unit_id: 'unit-tls', stage: 'unit_analysis', status: failed ? 'failed' : 'running', title: 'TLS 握手与失败恢复' }], unresolved: scene === 'partial' ? [{ id: 'pending-1', message: '异常条件仍需在测试环境中验证' }] : [] },
    reader_health: { status: 'ok', collection_status: { test_cases: 'readable', risks: 'readable', business_flows: 'readable' }, count_checks: {} },
    state_read: { observed_at: Date.now(), updated_at: '2026-10-21T04:12:00Z' }, report_available: complete, artifacts: complete ? { report_html: 'report.html' } : {},
    summary: '界面验证场景：优先检查握手失败清理、密钥过期和重新建链行为。此数据不代表实际测试结论。' }
  const task = { task_id: 'ui-task', title: 'TLS 建链分析', target: run.target, repository: 'storage', workspace: 'ui-workspace', data_root: dataRoot, run_id: run.run_id, source_scope: ['tls'], workflow_version: run.workflow_version, provider: 'pangea-codeagent', agent_model: 'fixture-model', attempt_id: 'attempt-1',
    status: failed ? 'failed' : complete ? 'completed' : 'running', execution_status: stopping ? 'stopping' : failed ? 'failed' : complete ? 'completed' : 'running', can_resume: failed, updated_at: '2026-10-21T04:12:00Z', launch_error: failed ? '界面测试：模拟连接中断，已有产物保留。' : null }
  return { run, task }
}
