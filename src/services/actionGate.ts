export interface ActionGate {
  claim: () => (() => void) | null
}

export function createActionGate(): ActionGate {
  let active = false

  return {
    claim: () => {
      if (active) {
        return null
      }

      active = true
      let released = false

      return () => {
        if (released) {
          return
        }

        released = true
        active = false
      }
    },
  }
}
