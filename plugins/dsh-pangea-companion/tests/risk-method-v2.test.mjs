import test from 'node:test'
import assert from 'node:assert/strict'

import { sourceFirstProjection } from '../src/source-first-projection.js'
import { classifyInjectionCandidate, extractRiskInjectionCandidates } from '../src/fault-injection-candidates.js'
import { listDtsPatterns, ingestDtsFile, setDtsPatternStatus } from '../src/pangea-api.js'

test('risk-method-v2 projection preserves two-tier verification, DTS matches, and promotes needs_runtime_verification into explicit injection candidates', () => {
  const projected = sourceFirstProjection([
    {
      action_id: 'run-v2:analysis:U-CONC',
      task_id: 'task-conc',
      stage: 'unit_analysis',
      status: 'accepted',
      revision: 1,
      result_path: '/tmp/conc.json',
      task: {
        unit_id: 'U-CONC',
        risk_track: 'concurrency_timing',
        record_contracts: { risk: 'behavior-risk-v3', check: 'behavior-check-v2' },
      },
      records: [
        {
          record_id: 'rec-0001',
          kind: 'risk',
          created_revision: 1,
          body: {
            format_version: 'behavior-risk-v3',
            risk_id: 'R-CONC-001',
            track: 'concurrency_timing',
            verification_status: 'needs_runtime_verification',
            severity: 'High',
            entity_ref: 'CTX-001',
            matched_dts_pattern_ids: ['DTS20260001'],
            title: '超时清理与晚到回调并发释放后使用',
            trigger: 'AUTH_PENDING 超时并同时回包',
            interleaving_or_path: ['Timer L142 free', 'Recv L88 deref'],
            system_result: 'UAF 崩溃',
            runtime_uncertainty: '外部库 disconnect 是否同步排空在途回调未知',
            external_observation: 'ASAN 报错',
            exclusion_condition: 'disconnect 同步排空回调',
            source_evidence: ['repo:src/sess.c:138-149'],
            evidence_quotes: [{ ref: 'repo:src/sess.c:138-149', snippet: 'free(sess->auth_ctx);' }],
            instrumentation: {
              points: [
                {
                  id: 'INJ-001',
                  kind: 'race_window_delay',
                  repo_id: 'repo',
                  path: 'src/sess.c',
                  symbol: 'session_TimerCb',
                  action: '释放后注入 50ms 延迟',
                  observe: 'ASAN heap-use-after-free',
                },
              ],
            },
            linked_test_case_ids: [],
          },
        },
        {
          record_id: 'rec-0002',
          kind: 'risk',
          created_revision: 1,
          body: {
            format_version: 'behavior-risk-v3',
            risk_id: 'R-ERR-002',
            track: 'error_rollback',
            verification_status: 'static_proven',
            severity: 'Medium',
            title: '错误路径漏解锁',
            trigger: 'recv 失败提前返回',
            interleaving_or_path: ['L10 lock', 'L15 return -2'],
            system_result: '死锁',
            external_observation: '后续请求永久卡死',
            exclusion_condition: '无',
            source_evidence: ['repo:src/sess.c:10-16'],
            evidence_quotes: [{ ref: 'repo:src/sess.c:10-16', snippet: 'return -2;' }],
          },
        },
      ],
    },
  ])

  assert.equal(projected.risks.length, 2)
  const runtimeRisk = projected.risks.find(r => r.display_id === 'R-CONC-001')
  assert.equal(runtimeRisk.track, 'concurrency_timing')
  assert.equal(runtimeRisk.verification_status, 'needs_runtime_verification')
  assert.deepEqual(runtimeRisk.matched_dts_pattern_ids, ['DTS20260001'])
  assert.equal(runtimeRisk.instrumentation.points.length, 1)

  const classified = classifyInjectionCandidate(runtimeRisk)
  assert.equal(classified.tier, 'explicit')
  assert.equal(classified.selectable, true)
  assert.match(classified.label, /待动态实锤/)

  const candidates = extractRiskInjectionCandidates(projected.risks)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].display_id, 'R-CONC-001')
  assert.equal(candidates[0].classification.tier, 'explicit')
})

test('pangea-api DTS pattern wrappers build expected CLI arguments', async t => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const pangeaCwd = await mkdtemp(path.join(tmpdir(), 'pangea-risk-v2-'))
  t.after(() => rm(pangeaCwd, { recursive: true, force: true }))
  await mkdir(path.join(pangeaCwd, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(pangeaCwd, '.agents', 'pangea', 'dsh.md'), '# marker\n', 'utf8')
  const calls = []
  const runner = async ({ args }) => {
    calls.push(args)
    return { ok: true, result: { items: [] } }
  }
  await listDtsPatterns(pangeaCwd, { dataRoot: '/data', track: 'concurrency_timing', status: 'enabled' }, runner)
  await ingestDtsFile(pangeaCwd, { dataRoot: '/data', filePath: '/tmp/dts.csv', sourceKind: 'offline_file_with_git' }, runner)
  await setDtsPatternStatus(pangeaCwd, { dataRoot: '/data', patternId: 'DTS-1', status: 'disabled' }, runner)

  assert.deepEqual(calls[0], ['dts-patterns', 'list', '--data-root', '/data', '--track', 'concurrency_timing', '--status', 'enabled'])
  assert.deepEqual(calls[1], ['dts-patterns', 'ingest', '--path', '/tmp/dts.csv', '--data-root', '/data', '--source-kind', 'offline_file_with_git'])
  assert.deepEqual(calls[2], ['dts-patterns', 'set-status', '--pattern-id', 'DTS-1', '--status', 'disabled', '--data-root', '/data'])
})

test('workbench normalizeRunInput forwards dts_context dts_ids and mr_urls for risk-analysis', async () => {
  const { normalizeRunInput } = await import('../src/workbench-api.js')
  const capabilities = {
    workflow_versions: ['source-first-v1'],
    repositories: ['demo-repo'],
    source_first: {
      version: 'source-first-v1',
      contract_fields: ['analysis_settings', 'analysis_profile', 'asset_revisions', 'source_investigation_policy'],
      analysis_options_by_profile: {
        'behavior-test-v2': {
          scenarios: ['risk-analysis'],
          modes: ['depth'],
          objectives: ['product-behavior'],
        },
      },
    },
  }
  const normalized = normalizeRunInput({
    repository: 'demo-repo',
    target: '风险分析测试',
    scenario: 'risk-analysis',
    mode: 'depth',
    objective: 'product-behavior',
    analysis_profile: 'behavior-test-v2',
    source_scope: ['src/sess'],
    dts_context: {
      dts_ids: ['DTS20260001', 'DTS20260002'],
      mr_urls: ['https://codehub.example/org/repo/merge_requests/42'],
    },
  }, capabilities)
  assert.deepEqual(normalized.dts_context, {
    dts_ids: ['DTS20260001', 'DTS20260002'],
    mr_urls: ['https://codehub.example/org/repo/merge_requests/42'],
  })
})

test('memory_corruption 4th track projects cleanly and Stage 1 risk-blueprint-v1 workerPrompt unblocks DTS-mcp / codehub-mcp', async () => {
  const { workerPrompt } = await import('../src/source-first-acp.js')

  const projected = sourceFirstProjection([
    {
      action_id: 'run-v2:analysis:U-MEM',
      task_id: 'task-mem',
      stage: 'unit_analysis',
      status: 'accepted',
      revision: 1,
      result_path: '/tmp/mem.json',
      task: {
        unit_id: 'U-MEM',
        risk_track: 'memory_corruption',
        record_contracts: { risk: 'behavior-risk-v3', check: 'behavior-check-v2' },
      },
      records: [
        {
          record_id: 'rec-mem-1',
          kind: 'risk',
          created_revision: 1,
          body: {
            format_version: 'behavior-risk-v3',
            risk_id: 'R-MEM-001',
            track: 'memory_corruption',
            verification_status: 'needs_runtime_verification',
            severity: 'Critical',
            entity_ref: 'MEM-SLOT-01',
            matched_dts_pattern_ids: ['DTS20260616'],
            title: '跨线程释放后重分配槽位导致异步回调踩内存',
            trigger: '销毁线程释放 slot 后工作线程晚到回调 memcpy',
            interleaving_or_path: ['T1 pool_free(c->slot)', 'T2 memcpy(c->slot->payload, buf, len)'],
            system_result: '踩坏重分配后的邻居会话内存',
            runtime_uncertainty: '底层调度器是否隐式排空回调待动态验证',
            external_observation: '毒化填充或 ASAN 捕获写入',
            exclusion_condition: '销毁前同步排空回调并置空指针',
            source_evidence: ['repo:src/chan_b.c:1-7'],
            evidence_quotes: [{ ref: 'repo:src/chan_b.c:1-7', snippet: 'memcpy(c->slot->payload, buf, len);' }],
            instrumentation: {
              points: [
                {
                  id: 'INJ-MEM-01',
                  kind: 'memory_poison_or_bound_probe',
                  repo_id: 'repo',
                  path: 'src/chan_b.c',
                  symbol: 'chan_b_teardown',
                  action: '释放前毒化 slot 并注入 50ms 窗口延迟',
                  observe: 'ASAN heap-use-after-free',
                },
              ],
            },
          },
        },
      ],
    },
  ])

  assert.equal(projected.risks.length, 1)
  assert.equal(projected.risks[0].track, 'memory_corruption')
  const candidates = extractRiskInjectionCandidates(projected.risks)
  assert.equal(candidates.length, 1)
  assert.equal(candidates[0].instrumentation.points[0].kind, 'memory_poison_or_bound_probe')

  const stage1Prompt = workerPrompt({
    action: { action_id: 'run-v2:planning', role: 'planning', stage: 'unit_planning', task_path: '/tmp/plan.json' },
    opened: {
      task: {
        scenario: 'risk-analysis',
        record_contracts: { blueprint: 'risk-blueprint-v1', risk: 'behavior-risk-v3', check: 'behavior-check-v2' },
      },
    },
    cwd: '/work',
    dataRoot: '/data',
    runId: 'run-v2',
    taskId: 'planner-1',
    python: 'python',
  })
  assert.match(stage1Prompt, /DTS-mcp \/ codehub-mcp/)
  assert.match(stage1Prompt, /memory_corruption/)
  assert.match(stage1Prompt, /显式点名认领/)
  assert.doesNotMatch(stage1Prompt, /不寻找插件或 MCP 配置/)
})

test('TaskStore persists and reloads dts_context for risk-analysis and deriveAnalysisInput preserves it', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const { TaskStore } = await import('../src/task-store.js')
  const { deriveAnalysisInput } = await import('../src/workbench-api.js')

  const dir = await mkdtemp(path.join(tmpdir(), 'pangea-dts-store-'))
  try {
    const storePath = path.join(dir, 'tasks-v1.json')
    const store1 = new TaskStore({ storePath })
    const created = await store1.create({
      workspace: dir,
      dataRoot: path.join(dir, 'pangea-data'),
      input: {
        repository: 'demo-repo',
        target: '内存泄漏核查',
        scenario: 'risk-analysis',
        analysis_profile: 'behavior-test-v2',
        objective: 'product-behavior',
        source_scope: ['src/cfg.c'],
        dts_context: {
          dts_ids: ['DTS20260099', 'DTS20260099'],
          mr_urls: ['https://codehub.example/org/repo/merge_requests/99'],
        },
      },
    })
    assert.deepEqual(created.dts_context, {
      dts_ids: ['DTS20260099'],
      mr_urls: ['https://codehub.example/org/repo/merge_requests/99'],
    })

    const store2 = new TaskStore({ storePath })
    const reloaded = await store2.get(created.task_id)
    assert.deepEqual(reloaded?.dts_context, {
      dts_ids: ['DTS20260099'],
      mr_urls: ['https://codehub.example/org/repo/merge_requests/99'],
    })

    const derived = deriveAnalysisInput(
      { ...reloaded, run_id: 'run-parent-1', provider: 'pangea-codex', agent_model: 'gpt-5' },
      { mode: 'supplement', selected_unit_ids: ['U1'], instruction: '补充核查 cfg 解析内存泄漏' },
      { can_derive: true, parent_run_id: 'run-parent-1', units: [{ unit_id: 'U1' }], records: [] },
    )
    assert.deepEqual(derived.dts_context, {
      dts_ids: ['DTS20260099'],
      mr_urls: ['https://codehub.example/org/repo/merge_requests/99'],
    })

    const nonRisk = await store1.create({
      workspace: dir,
      dataRoot: path.join(dir, 'pangea-data'),
      input: {
        repository: 'demo-repo',
        target: '分支分析',
        scenario: 'branch-analysis',
        source_scope: ['src/cfg.c'],
        dts_context: { dts_ids: ['DTS-IGNORED'] },
      },
    })
    assert.equal(nonRisk.dts_context, undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('#31/#32 DtsFeedbackSection uses dts-file picker purpose and cursor pagination forwards cursor/limit', async t => {
  const { readFile, mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const path = await import('node:path')
  const clientSrc = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')
  const indexSrc = await readFile(new URL('../src/index.js', import.meta.url), 'utf8')
  assert.match(clientSrc, /pick\(\{\s*purpose:\s*'dts-file'\s*\}\)/)
  assert.match(clientSrc, /加载更多/)
  assert.match(clientSrc, /append:\s*true,\s*cursor:\s*catalog\.next_cursor,\s*query:\s*appliedQuery/)
  assert.match(indexSrc, /const cursor = Number\.isInteger\(body\.cursor\)/)
  assert.match(indexSrc, /const limit = Number\.isInteger\(body\.limit\)/)

  const pangeaCwd = await mkdtemp(path.join(tmpdir(), 'pangea-dts-page-'))
  t.after(() => rm(pangeaCwd, { recursive: true, force: true }))
  await mkdir(path.join(pangeaCwd, '.agents', 'pangea'), { recursive: true })
  await writeFile(path.join(pangeaCwd, '.agents', 'pangea', 'dsh.md'), '# marker\n', 'utf8')
  const calls = []
  await listDtsPatterns(pangeaCwd, { dataRoot: '/data', cursor: 50, limit: 50, query: 'DTS-51' }, async ({ args }) => {
    calls.push(args)
    return { ok: true, result: { items: [], total: 53, next_cursor: null } }
  })
  assert.deepEqual(calls[0], ['dts-patterns', 'list', '--data-root', '/data', '--query', 'DTS-51', '--cursor', '50', '--limit', '50'])
})


