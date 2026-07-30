import { loadCachedLazyService } from './lazy'

type SettingsDataActionFactory =
  typeof import('./settingsActions')['createSettingsDataActions']

let settingsDataActionFactoryPromise: Promise<SettingsDataActionFactory> | null = null

export function loadSettingsDataActionService(): Promise<SettingsDataActionFactory> {
  return loadCachedLazyService(
    () => settingsDataActionFactoryPromise,
    (promise) => {
      settingsDataActionFactoryPromise = promise
    },
    () =>
      import('./settingsActions').then(
        ({ createSettingsDataActions }) => createSettingsDataActions,
      ),
  )
}
