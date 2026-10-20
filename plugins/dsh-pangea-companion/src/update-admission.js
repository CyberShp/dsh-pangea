// The standalone plugins also run without Desktop. Resolve the optional host
// service at call time so service replacement cannot leave an old lock behind.
export function updateAdmission(ctx) {
  // Cordis permits explicit lookup of optional services. Property access on a
  // plugin context requires inject, even when the service is not installed.
  if (typeof ctx?.get === 'function') return ctx.get('pangeaUpdateAdmission')
  return ctx?.pangeaUpdateAdmission
}

export function registerUpdateParticipant(ctx, id, check) {
  const register = owner => {
    const service = updateAdmission(owner)
    if (!service) return
    if (owner.effect) owner.effect(() => service.registerParticipant(id, check), `${id}: update admission`)
    else return service.registerParticipant(id, check)
  }
  // An optional injection follows both late service activation and disposal.
  if (ctx.inject) return ctx.inject(['pangeaUpdateAdmission'], register)
  return register(ctx)
}

export function guardUpdateMethods(ctx, target, methods, { synchronous = false } = {}) {
  for (const name of methods) {
    const original = target[name]
    target[name] = function (...args) {
      const admission = updateAdmission(ctx)
      if (synchronous) {
        admission?.assertOpen()
        return original.apply(this, args)
      }
      return admission ? admission.run(() => original.apply(this, args)) : original.apply(this, args)
    }
  }
}

export function companionUpdateBusy({ operations, launchLocks, sourceFirstBusy, nativeDiagramBusy, ssh }) {
  return Boolean(launchLocks.size || operations.launches.size || operations.stops.size || operations.deletions.size
    || sourceFirstBusy() || nativeDiagramBusy() || [...(ssh?.jobs?.values() ?? [])].some(job => job.running))
}
