import { describe, expect, it } from 'vitest'

import {
  assertCurrentWebSyncContract,
  currentWebSyncContractMarkers,
  findCurrentWebSyncContractFailures,
} from '../current-web-sync-contract.mjs'

function validSources() {
  return Object.fromEntries(
    Object.entries(currentWebSyncContractMarkers).map(([sourceName, sourceMarkers]) => [
      sourceName,
      sourceMarkers.join('\n'),
    ]),
  )
}

describe('current Web sync contract gate', () => {
  it('accepts the complete executable contract', () => {
    expect(assertCurrentWebSyncContract(validSources())).toEqual({
      checkId: 'current-web-sync-contract',
    })
  })

  it('fails closed when any executable marker is removed', () => {
    for (const [sourceName, sourceMarkers] of Object.entries(currentWebSyncContractMarkers)) {
      for (const marker of sourceMarkers) {
        const fixture = validSources()
        fixture[sourceName] = fixture[sourceName].split(marker).join('')
        expect(findCurrentWebSyncContractFailures(fixture)).toContain(
          `${sourceName} is missing: ${marker}`,
        )
      }
    }
  })

  it('does not accept an unreachable implementation marker as a replacement', () => {
    const fixture = validSources()
    const required = 'const enqueueExclusiveLifecycle = <T>('
    fixture.appStoreSource = fixture.appStoreSource
      .replace(required, '')
      .concat('\nconst unreachableSyncImplementation = true')
    const failures = findCurrentWebSyncContractFailures(fixture)
    expect(failures).toContain(`appStoreSource is missing: ${required}`)
  })

  it('requires current pending-owner semantics instead of the retired queue marker', () => {
    const fixture = validSources()
    const required = 'function startPendingSync(): Promise<void> | null {'
    fixture.appStoreSource = fixture.appStoreSource
      .replace(required, '')
      .concat('\nconst queuePendingSync = () => true')
    const failures = findCurrentWebSyncContractFailures(fixture)
    expect(failures).toContain(`appStoreSource is missing: ${required}`)
  })
})
