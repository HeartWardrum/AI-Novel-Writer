import { ipc } from './ipc-client'
import type { ProjectSessionContext } from '../shared/ipc-channels'
import type {
  BlueprintNextInput,
  BlueprintNextRecovery,
} from '../shared/blueprint-next-options'
import type { MainGenerationRunHandle } from './generation/generation-runtime'

const sameRun = (a: MainGenerationRunHandle, b: MainGenerationRunHandle) =>
  a.projectId === b.projectId && a.rootActionId === b.rootActionId && a.runId === b.runId

export function canExecuteBlueprintNext(recovery: BlueprintNextRecovery) {
  return recovery.sourceStatus === 'current'
    && recovery.view.status !== 'cancelled'
    && recovery.attemptCount === 0
    && !recovery.options
}

/** Navigation only: main owns sources, tasks and option identity. Apply is client-side. */
export function createBlueprintNextGeneration(sessionInput: ProjectSessionContext) {
  const session = Object.freeze({ ...sessionInput })
  let recovery: BlueprintNextRecovery | undefined
  let detached = false
  let cancelled = false
  let opening: Promise<BlueprintNextRecovery> | undefined
  let cancelPromise: Promise<void> | undefined

  const validate = (value: BlueprintNextRecovery, handle?: MainGenerationRunHandle) => {
    if (value.view.handle.projectId !== session.projectId || value.context.projectId !== session.projectId
      || !value.view.handle.epoch
      || handle && !sameRun(handle, value.view.handle)
      || value.context.input.chapterNumber !== value.context.blueprint.chapterNumber) {
      throw new Error('BLUEPRINT_NEXT_IDENTITY_MISMATCH')
    }
    return value
  }

  const read = async () => {
    if (!recovery) throw new Error('BLUEPRINT_NEXT_NOT_OPEN')
    recovery = validate(
      await ipc.invokeWithProjectSession(session, 'blueprint-next:read-recovery', { handle: recovery.view.handle }),
      recovery.view.handle,
    )
    return recovery
  }

  const cancelKnown = async () => {
    if (!recovery) return
    if (!cancelPromise) {
      cancelPromise = (async () => {
        const view = await ipc.invokeWithProjectSession(session, 'blueprint-next:cancel', { handle: recovery!.view.handle })
        if (!sameRun(view.handle, recovery!.view.handle)) throw new Error('BLUEPRINT_NEXT_IDENTITY_MISMATCH')
        recovery!.view = view
      })()
    }
    await cancelPromise
  }

  return {
    read,
    open(request: { input: BlueprintNextInput; modelId: string; uiActionNonce: string } | { handle: MainGenerationRunHandle }) {
      if (opening) throw new Error('BLUEPRINT_NEXT_ALREADY_OPEN')
      opening = (async () => {
        recovery = validate(
          'handle' in request
            ? await ipc.invokeWithProjectSession(session, 'blueprint-next:read-recovery', request)
            : await ipc.invokeWithProjectSession(session, 'blueprint-next:begin', request),
          'handle' in request ? request.handle : undefined,
        )
        if ('input' in request && JSON.stringify(recovery.context.input) !== JSON.stringify(request.input)) {
          throw new Error('BLUEPRINT_NEXT_CONTEXT_MISMATCH')
        }
        if (cancelled) {
          await cancelKnown()
          throw new Error('BLUEPRINT_NEXT_CANCELLED')
        }
        if (detached) throw new Error('BLUEPRINT_NEXT_DETACHED')
        return recovery
      })()
      return opening
    },
    async execute() {
      if (!opening) throw new Error('BLUEPRINT_NEXT_NOT_OPEN')
      await opening
      if (!recovery || cancelled || detached) throw new Error('BLUEPRINT_NEXT_NOT_EXECUTABLE')
      if (recovery.options) return read()
      if (!canExecuteBlueprintNext(recovery)) throw new Error('BLUEPRINT_NEXT_OUTCOME_UNKNOWN')
      const handle = recovery.view.handle
      const receipt = await ipc.invokeWithProjectSession(session, 'blueprint-next:execute', { handle })
      if (!sameRun(handle, receipt.run.handle)) throw new Error('BLUEPRINT_NEXT_IDENTITY_MISMATCH')
      recovery.view = receipt.run
      if (cancelled || detached) throw new Error('BLUEPRINT_NEXT_CANCELLED')
      return read()
    },
    async cancel() {
      cancelled = true
      if (opening) await opening.catch(() => {})
      await cancelKnown()
    },
    detach() { detached = true },
  }
}
