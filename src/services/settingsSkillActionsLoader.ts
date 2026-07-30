import { loadCachedLazyService } from './lazy'

type SettingsSkillActionService = Pick<
  typeof import('./settingsActions'),
  'createSettingsSkillActions'
>

let settingsSkillActionServicePromise: Promise<SettingsSkillActionService> | null = null

export function loadSettingsSkillActionService(): Promise<SettingsSkillActionService> {
  return loadCachedLazyService(
    () => settingsSkillActionServicePromise,
    (promise) => {
      settingsSkillActionServicePromise = promise
    },
    () => import('./settingsActions'),
  )
}
