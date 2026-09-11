export interface SettingsActionOwner {
  pending: () => boolean
  run: (
    action: () => unknown | Promise<unknown>,
    onPendingChange: (pending: boolean) => void,
  ) => Promise<boolean>
}

export interface SettingsDataActionFocusCoordinator {
  begin: (target: HTMLElement | null) => number
  complete: (token: number) => void
  takeCompletedTarget: (
    pending: boolean,
  ) => { token: number; target: HTMLElement | null } | null
  isCurrent: (token: number) => boolean
}

export function createSettingsDataActionFocusCoordinator(): SettingsDataActionFocusCoordinator {
  let nextToken = 0
  let request: {
    token: number
    target: HTMLElement | null
    completed: boolean
    scheduled: boolean
  } | null = null

  return {
    begin: (target) => {
      const token = ++nextToken
      request = { token, target, completed: false, scheduled: false }
      return token
    },
    complete: (token) => {
      if (request?.token === token) request.completed = true
    },
    takeCompletedTarget: (pending) => {
      if (pending || !request?.completed || request.scheduled) return null
      request.scheduled = true
      return { token: request.token, target: request.target }
    },
    isCurrent: (token) =>
      request?.token === token && request.completed && request.scheduled,
  }
}

export function createSettingsActionOwner(): SettingsActionOwner {
  let pending = false

  return {
    pending: () => pending,
    run: async (action, onPendingChange) => {
      if (pending) return false
      pending = true
      onPendingChange(true)
      try {
        await action()
        return true
      } finally {
        pending = false
        onPendingChange(false)
      }
    },
  }
}
