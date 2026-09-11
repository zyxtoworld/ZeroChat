export function settingsDialogTabWrapTarget<T>(
  focusableElements: readonly T[],
  activeElement: T | null,
  shiftKey: boolean,
): T | null {
  if (focusableElements.length === 0) return null

  const first = focusableElements[0]
  const last = focusableElements[focusableElements.length - 1]
  const activeIndex =
    activeElement === null ? -1 : focusableElements.indexOf(activeElement)

  if (activeIndex < 0) return shiftKey ? last : first
  if (shiftKey && activeIndex === 0) return last
  if (!shiftKey && activeIndex === focusableElements.length - 1) return first
  return null
}
