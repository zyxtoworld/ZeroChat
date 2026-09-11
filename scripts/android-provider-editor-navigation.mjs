const phases = new Set(['rewind', 'scan'])

export function planAndroidProviderEditorStep(state) {
  if (!state || !phases.has(state.phase)) {
    throw new TypeError('Android Provider editor navigation requires a valid phase.')
  }

  const targetEditorObserved = Boolean(
    state.targetEditorObserved ||
    state.editorVisible ||
    state.providerNameEditorVisible,
  )

  if (targetEditorObserved && state.providerKeyVisible) {
    return { action: 'resolved', targetEditorObserved }
  }

  if (state.providerSpecificExpandVisible) {
    return {
      action: 'tap-provider-specific-expand',
      captureCompactEvidence: true,
      targetEditorObserved,
    }
  }

  if (state.taggedExpandVisible) {
    return {
      action: 'tap-tagged-expand',
      captureCompactEvidence: true,
      targetEditorObserved,
    }
  }

  if (state.phase === 'scan' && state.showMoreVisible) {
    return { action: 'tap-show-more', targetEditorObserved }
  }

  if (
    state.phase === 'rewind' &&
    !targetEditorObserved &&
    !state.listTopVisible
  ) {
    return { action: 'rewind', targetEditorObserved }
  }

  return { action: 'scan-forward', targetEditorObserved }
}
