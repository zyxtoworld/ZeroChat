import type { FeatureHintId } from '../types'

export type FeatureHintPlacement = 'chat' | 'menu' | 'settings'

interface FeatureHintVisibilityOptions {
  dangerPromptOpen: boolean
  dismissedFeatureHints?: readonly FeatureHintId[]
  guideVisible: boolean
  id: FeatureHintId
  placement: FeatureHintPlacement
  settingsOpen: boolean
  syncFirstConflictPromptOpen: boolean
}

interface DismissFeatureHintResult {
  changed: boolean
  dismissedFeatureHints: FeatureHintId[]
}

export function featureHintDismissed(
  dismissedFeatureHints: readonly FeatureHintId[] | undefined,
  id: FeatureHintId,
): boolean {
  return Boolean(dismissedFeatureHints?.includes(id))
}

export function shouldShowFeatureHint({
  dangerPromptOpen,
  dismissedFeatureHints,
  guideVisible,
  id,
  placement,
  settingsOpen,
  syncFirstConflictPromptOpen,
}: FeatureHintVisibilityOptions): boolean {
  if (
    guideVisible ||
    dangerPromptOpen ||
    syncFirstConflictPromptOpen ||
    (settingsOpen && placement !== 'settings')
  ) {
    return false
  }

  return !featureHintDismissed(dismissedFeatureHints, id)
}

export function dismissFeatureHintId(
  dismissedFeatureHints: readonly FeatureHintId[] | undefined,
  id: FeatureHintId,
): DismissFeatureHintResult {
  if (featureHintDismissed(dismissedFeatureHints, id)) {
    return {
      changed: false,
      dismissedFeatureHints: [...(dismissedFeatureHints ?? [])],
    }
  }

  return {
    changed: true,
    dismissedFeatureHints: [...(dismissedFeatureHints ?? []), id],
  }
}
