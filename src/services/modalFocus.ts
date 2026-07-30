export type ModalFocusKey = 'danger' | 'sync-conflict' | 'guide' | 'settings'

export interface ModalFocusState {
  key: ModalFocusKey
  selector: string
}

export interface ModalFocusFlags {
  dangerPromptOpen: boolean
  guideVisible: boolean
  settingsOpen: boolean
  syncFirstConflictPromptOpen: boolean
}

export const MODAL_FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function deriveModalFocusState({
  dangerPromptOpen,
  guideVisible,
  settingsOpen,
  syncFirstConflictPromptOpen,
}: ModalFocusFlags): ModalFocusState | null {
  if (dangerPromptOpen) {
    return { key: 'danger', selector: '.danger-modal' }
  }

  if (syncFirstConflictPromptOpen) {
    return { key: 'sync-conflict', selector: '.sync-conflict-modal' }
  }

  if (guideVisible) {
    return { key: 'guide', selector: '.guide-modal' }
  }

  if (settingsOpen) {
    return { key: 'settings', selector: '.settings-modal' }
  }

  return null
}

export function shouldUseSettingsFallbackReturnTarget(
  closingModalKey: string,
  settingsReturnFocusSuppressed: boolean,
): boolean {
  return closingModalKey === 'settings' && !settingsReturnFocusSuppressed
}
