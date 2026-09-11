import type { FeatureHintId } from '../types'

export function featureHintDismissed(
  dismissedFeatureHints: readonly FeatureHintId[] | undefined,
  id: FeatureHintId,
): boolean {
  return Boolean(dismissedFeatureHints?.includes(id))
}

export function dismissFeatureHintId(
  dismissedFeatureHints: readonly FeatureHintId[] | undefined,
  id: FeatureHintId,
): FeatureHintId[] | null {
  if (featureHintDismissed(dismissedFeatureHints, id)) return null
  return [...(dismissedFeatureHints ?? []), id]
}
