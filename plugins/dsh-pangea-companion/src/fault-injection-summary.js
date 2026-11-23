import { readdir, readFile, realpath } from 'node:fs/promises'
import path from 'node:path'

const validId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)
const inside = (root, file) => {
  const rel = path.relative(root, file)
  return Boolean(rel && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
}

export async function summarizeRunVerifications(dataRoot, runId) {
  const empty = {
    injection_by_case: {},
    injection_counts: { instrumented: 0, verified: 0, passed: 0, failed: 0, not_triggered: 0 },
  }
  if (!dataRoot || !validId(runId)) return empty
  let root, runDir
  try {
    root = await realpath(dataRoot)
    runDir = path.join(root, '.pangea', 'fault-injection', runId)
    if (!inside(root, runDir)) return empty
  } catch {
    return empty
  }
  let entries
  try {
    entries = await readdir(runDir, { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return empty
    throw error
  }
  const tasks = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !validId(entry.name)) continue
    try {
      const record = JSON.parse(await readFile(path.join(runDir, entry.name, 'task.json'), 'utf8'))
      if (record && record.id === entry.name && record.run_id === runId) tasks.push(record)
    } catch (error) {
      if (error.code !== 'ENOENT') continue
    }
  }
  const pushedByTask = new Map()
  try {
    const buildsRoot = path.join(root, '.pangea', 'fault-injection-builds')
    if (inside(root, buildsRoot)) {
      const buildEntries = await readdir(buildsRoot, { withFileTypes: true })
      const builds = []
      for (const entry of buildEntries) {
        if (!entry.isDirectory() || !validId(entry.name)) continue
        try {
          const build = JSON.parse(await readFile(path.join(buildsRoot, entry.name, 'build.json'), 'utf8'))
          if (build && build.id === entry.name && build.status === 'pushed') builds.push(build)
        } catch {}
      }
      builds.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      for (const build of builds) {
        const branch = [...new Set((build.repositories || []).map(repo => repo.remote_branch || repo.personal_branch).filter(Boolean))].join('、')
        for (const item of Array.isArray(build.items) ? build.items : []) {
          if (item?.run_id === runId && validId(item.task_id)) pushedByTask.set(item.task_id, { branch, at: build.updated_at || build.created_at || '' })
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') { /* Ignore unreadable builds dir in summary projection */ }
  }
  // Oldest first so newer tasks and newer verification records win cleanly.
  tasks.sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
  const byCase = Object.create(null)
  for (const task of tasks) {
    const pushedBuild = pushedByTask.get(task.id)
    const effectiveStatus = task.status === 'ready' && pushedBuild ? 'pushed' : task.status
    const effectiveBranch = pushedBuild?.branch || task.branch || ''
    const caseKeys = Array.isArray(task.case_keys) ? task.case_keys : []
    for (const caseKey of caseKeys) {
      if (!caseKey) continue
      const existing = byCase[caseKey]
      // Only update task-level status if no actual verification result is recorded yet,
      // or if this task also has a newer verification below.
      if (!existing || !existing.verified) {
        if (['ready', 'pushed', 'generating', 'preparing'].includes(effectiveStatus)) {
          byCase[caseKey] = {
            case_key: caseKey,
            task_id: task.id,
            task_name: task.name || '',
            task_status: effectiveStatus,
            branch: effectiveBranch,
            verified: false,
            result: 'not_run',
            hits: '',
            at: pushedBuild?.at || task.updated_at || task.created_at || '',
          }
        }
      }
    }
    for (const item of Array.isArray(task.verification) ? task.verification : []) {
      if (!item?.case_key || !['passed', 'failed', 'not_triggered', 'not_run'].includes(item.result)) continue
      if (item.result === 'not_run' && byCase[item.case_key]?.verified) continue
      const prevAt = byCase[item.case_key]?.verified ? String(byCase[item.case_key].at || '') : ''
      const nextAt = String(item.at || task.updated_at || '')
      if (!prevAt || nextAt >= prevAt) {
        byCase[item.case_key] = {
          case_key: item.case_key,
          task_id: task.id,
          task_name: task.name || '',
          task_status: effectiveStatus,
          branch: effectiveBranch,
          verified: item.result !== 'not_run',
          result: item.result,
          hits: String(item.hits || ''),
          notes: String(item.notes || ''),
          build_package_id: String(item.build?.package_id || ''),
          build_url: String(item.build?.url || ''),
          at: nextAt,
        }
      }
    }
  }
  const values = Object.values(byCase)
  return {
    injection_by_case: byCase,
    injection_counts: {
      instrumented: values.length,
      verified: values.filter(v => v.verified).length,
      passed: values.filter(v => v.result === 'passed').length,
      failed: values.filter(v => v.result === 'failed').length,
      not_triggered: values.filter(v => v.result === 'not_triggered').length,
    },
  }
}
