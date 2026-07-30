export const preloadSettingsOverlayHost = (
  loadSettingsOverlay: () => Promise<unknown>,
): Promise<boolean> =>
  Promise.resolve()
    .then(loadSettingsOverlay)
    .then(
      () => true,
      () => false,
    )
