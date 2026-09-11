export function createAndroidManualRefreshEvidence() {
  return {
    coherentActiveObservations: 0,
    coherentActiveObserved: false,
    refreshingUiObservations: 0,
    stableAbsentSamples: 0,
    syncProgressUiObservations: 0,
  }
}

export function observeAndroidManualRefreshUi(evidence, observation) {
  const refreshing = observation.refreshing === true
  const syncProgressVisible = observation.syncProgressVisible === true
  const coherentActive = refreshing && syncProgressVisible

  return {
    coherentActiveObservations:
      evidence.coherentActiveObservations + (coherentActive ? 1 : 0),
    coherentActiveObserved: evidence.coherentActiveObserved || coherentActive,
    refreshingUiObservations:
      evidence.refreshingUiObservations + (refreshing ? 1 : 0),
    stableAbsentSamples:
      !refreshing && !syncProgressVisible ? evidence.stableAbsentSamples + 1 : 0,
    syncProgressUiObservations:
      evidence.syncProgressUiObservations + (syncProgressVisible ? 1 : 0),
  }
}
