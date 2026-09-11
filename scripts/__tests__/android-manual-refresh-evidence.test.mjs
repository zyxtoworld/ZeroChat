import { describe, expect, it } from 'vitest'

import {
  createAndroidManualRefreshEvidence,
  observeAndroidManualRefreshUi,
} from '../android-manual-refresh-evidence.mjs'

describe('Android manual-refresh UI evidence', () => {
  it('waits for one coherent active sample across transient recomposition skew', () => {
    let evidence = createAndroidManualRefreshEvidence()

    evidence = observeAndroidManualRefreshUi(evidence, {
      refreshing: true,
      syncProgressVisible: false,
    })
    expect(evidence.coherentActiveObserved).toBe(false)

    evidence = observeAndroidManualRefreshUi(evidence, {
      refreshing: true,
      syncProgressVisible: true,
    })
    expect(evidence).toMatchObject({
      coherentActiveObservations: 1,
      coherentActiveObserved: true,
      refreshingUiObservations: 2,
      syncProgressUiObservations: 1,
    })
  })

  it('settles only after both markers are absent for the required samples', () => {
    let evidence = createAndroidManualRefreshEvidence()

    for (const observation of [
      { refreshing: true, syncProgressVisible: true },
      { refreshing: false, syncProgressVisible: true },
      { refreshing: false, syncProgressVisible: false },
      { refreshing: true, syncProgressVisible: false },
      { refreshing: false, syncProgressVisible: false },
      { refreshing: false, syncProgressVisible: false },
      { refreshing: false, syncProgressVisible: false },
    ]) {
      evidence = observeAndroidManualRefreshUi(evidence, observation)
    }

    expect(evidence).toMatchObject({
      coherentActiveObservations: 1,
      refreshingUiObservations: 2,
      stableAbsentSamples: 3,
      syncProgressUiObservations: 2,
    })
  })
})
