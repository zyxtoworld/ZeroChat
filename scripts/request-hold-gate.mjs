export function createRequestHoldGate({ alreadyHoldingMessage } = {}) {
  let currentGate = null

  return {
    async wait() {
      const gate = currentGate
      if (gate) {
        await gate.pending
      }
    },

    hold() {
      if (currentGate) {
        throw new Error(alreadyHoldingMessage ?? 'Request hold gate is already active.')
      }

      let release
      const pending = new Promise((resolve) => {
        release = resolve
      })
      currentGate = { pending, release }
    },

    release() {
      const gate = currentGate
      currentGate = null
      gate?.release()
    },

    get isHeld() {
      return currentGate !== null
    },
  }
}
