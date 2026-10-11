import path from 'node:path'
import { readFile } from 'node:fs/promises'

// A PID is used only to prove absence. A reused PID or permission error must
// block recovery, never authorize terminating an unrelated process.
export function processPresence(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return 'unknown'
  try { process.kill(pid, 0); return 'present' }
  catch (error) { return error?.code === 'ESRCH' ? 'absent' : 'unknown' }
}

export function acpBindingsPath(dataRoot, runId) {
  if (!runId || runId === '.' || runId === '..' || /[\\/]/.test(runId)) throw new Error('无效 run_id')
  return path.join(path.resolve(dataRoot), 'runs', runId, 'acp-workers.json')
}

export async function readAcpBindings(dataRoot, runId) {
  try {
    const saved = JSON.parse(await readFile(acpBindingsPath(dataRoot, runId), 'utf8'))
    if (saved.runId !== runId || !saved.workers || typeof saved.workers !== 'object' || Array.isArray(saved.workers)) throw new Error('ACP 会话记录与 Run 不一致')
    return saved
  } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}

export function inspectAcpBindings(saved, { currentInstanceId, presence = processPresence } = {}) {
  const blocked = reason => ({ can_resume: false, blocked_reason: reason, summary: '已保存结果保留；旧执行尚未确认结束' })
  if (!saved) return blocked('缺少 ACP 执行记录，无法确认旧请求已结束')
  const owner = saved.owner
  if (owner?.active && owner.instance_id !== currentInstanceId && presence(owner.pid) !== 'absent') {
    return blocked('原宿主进程仍存在或无法确认已退出，不能重复派发')
  }
  if (owner?.pending_starts?.length) return blocked('ACP 会话创建尚未完成身份落盘，需确认原执行已结束')
  const workers = Object.values(saved.workers)
  if (!owner && !workers.length) return blocked('缺少原宿主与 worker 的执行身份，不能确认旧执行已结束')
  for (const binding of workers) {
    if (binding.quiescent === true) continue
    if (presence(binding.process_id) !== 'absent') return blocked('原 ACP 请求或工具仍可能运行；进程结束尚未确认')
  }
  return { can_resume: true, blocked_reason: null, summary: '旧执行已静止；保留结果并续接原 worker 会话' }
}
