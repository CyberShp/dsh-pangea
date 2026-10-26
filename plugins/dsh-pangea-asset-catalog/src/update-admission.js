import { guardUpdateMethods, registerUpdateParticipant } from '../../dsh-pangea-companion/src/update-admission.js'

const CLOSED = new Set(['completed', 'failed', 'needs_attention', 'interrupted', 'stopped', 'cancelled'])

export function assetCatalogUpdateBusy(runtime) {
  const queue = runtime.queue
  return Boolean(queue.active.size || queue.archiving.size
    || queue.pending.some(entry => entry.state === 'waiting')
    || [...runtime.jobs.values()].some(job => !CLOSED.has(job.status) || job.commandPending || (job.cleanupPending && !job.cleanupConfirmed))
    || [...runtime.methodologies.jobs.values()].some(job => !['completed', 'failed'].includes(job.status)))
}

export function installAssetUpdateAdmission(ctx, runtime) {
  guardUpdateMethods(ctx, runtime, ['start'])
  guardUpdateMethods(ctx, runtime.methodologies, ['start'])
  // Enqueue publishes its pending record before returning and has no await.
  guardUpdateMethods(ctx, runtime.queue, ['enqueue'], { synchronous: true })
  return registerUpdateParticipant(ctx, 'asset-catalog', () => assetCatalogUpdateBusy(runtime), async () => {
    // Mark all queued entries first, before a cancellation can free a slot.
    const pending = runtime.queue.pending.filter(entry => entry.state === 'waiting')
    const queuedStops = pending.map(entry => runtime.queue.stop(entry.params))
    const jobs = [...runtime.jobs.values()].filter(job => !CLOSED.has(job.status) || !job.cleanupConfirmed)
    const results = await Promise.allSettled([...queuedStops, ...jobs.map(job =>
      runtime.queue.stop({ cwd: job.cwd, dataRoot: job.dataRoot, assetId: job.assetId })),
      runtime.methodologies.stopForUpdate()])
    const failures = results.filter(result => result.status === 'rejected')
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), '资料任务停止尚未确认')
    runtime.queue.schedule()
  })
}
