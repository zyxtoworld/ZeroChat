import { restoreInteractionFocusTarget } from '../services/interactionFocus'

export interface SettingsFocusOwner {
  generation: number
  target: HTMLElement | null
}

export interface SettingsActionFocusOwner {
  focusOwner: Element | null
  target: HTMLButtonElement
}

export interface SettingsUserInteractionTarget {
  addEventListener: (
    type: 'pointerdown' | 'keydown',
    listener: EventListener,
    options?: boolean,
  ) => void
  removeEventListener: (
    type: 'pointerdown' | 'keydown',
    listener: EventListener,
    options?: boolean,
  ) => void
}

export interface SettingsUserInteractionGuard {
  start: () => void
  stop: () => void
  wasInteracted: () => boolean
}

interface SettingsActionFocusResolution {
  completed: boolean
  target: HTMLButtonElement | null
}

let currentOwner: SettingsFocusOwner = { generation: 0, target: null }

export function createSettingsUserInteractionGuard(
  target: SettingsUserInteractionTarget,
): SettingsUserInteractionGuard {
  let pointerRegistered = false
  let keyRegistered = false
  let interacted = false

  const markInteracted = () => {
    interacted = true
  }

  const stop = () => {
    if (pointerRegistered) {
      pointerRegistered = false
      try {
        target.removeEventListener('pointerdown', markInteracted, true)
      } catch {
        // Teardown may race document removal.
      }
    }
    if (keyRegistered) {
      keyRegistered = false
      try {
        target.removeEventListener('keydown', markInteracted, true)
      } catch {
        // Teardown may race document removal.
      }
    }
  }

  const start = () => {
    stop()
    interacted = false
    try {
      target.addEventListener('pointerdown', markInteracted, true)
      pointerRegistered = true
      target.addEventListener('keydown', markInteracted, true)
      keyRegistered = true
    } catch {
      stop()
    }
  }

  return {
    start,
    stop,
    wasInteracted: () => interacted,
  }
}

function activeFocusTarget(): HTMLElement | null {
  if (
    typeof document === 'undefined' ||
    typeof HTMLElement === 'undefined' ||
    !(document.activeElement instanceof HTMLElement)
  ) {
    return null
  }
  return document.activeElement
}

export function captureSettingsFocusOwner(
  target: HTMLElement | null = activeFocusTarget(),
): SettingsFocusOwner {
  currentOwner = {
    generation: currentOwner.generation + 1,
    target,
  }
  return currentOwner
}

export function currentSettingsFocusOwner(): SettingsFocusOwner {
  return currentOwner
}

export function settingsFocusOwnerIsCurrent(owner: SettingsFocusOwner): boolean {
  return owner.generation === currentOwner.generation
}

export function resolveSettingsActionFocusOwner(
  currentOwner: SettingsActionFocusOwner | null,
  owner: SettingsActionFocusOwner,
  {
    activeElement,
    blocked,
    body,
  }: {
    activeElement: Element | null
    blocked: boolean
    body: HTMLElement | null
  },
): SettingsActionFocusResolution {
  if (currentOwner !== owner || owner.target.disabled) {
    return { completed: false, target: null }
  }

  return {
    completed: true,
    target: restoreInteractionFocusTarget({
      activeElement,
      blocked,
      body,
      owner: owner.focusOwner,
      target: owner.target,
    }),
  }
}
