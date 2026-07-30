import { describe, expect, it } from 'vitest'

import { createSettingsDataActionGate } from '../settingsDataRuntimeController'

describe('settings data runtime action gate', () => {
  it('rejects same-tick reentry until the active action releases ownership', () => {
    const gate = createSettingsDataActionGate()
    const release = gate.claim()

    expect(release).not.toBeNull()
    expect(gate.claim()).toBeNull()

    release?.()
    release?.()

    expect(gate.claim()).not.toBeNull()
  })
})
