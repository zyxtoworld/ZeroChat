const CURRENT_SYNC_TAB_ID = 'settings-tab-sync'

export function findWebCurrentShellEvidenceFailures(report, summary = report) {
  const failures = []

  if (Number(report?.visibleDeprecatedSyncControlCount) !== 0) {
    failures.push('deprecated visible sync control count must be zero')
  }
  if (Number(report?.visibleDeprecatedSyncAriaCount) !== 0) {
    failures.push('deprecated visible sync aria-label count must be zero')
  }
  if (report?.settingsEntryActionable !== true) {
    failures.push('current Settings entry must be actionable')
  }
  if (
    report?.syncSettingsOpenProof?.opened !== true ||
    report?.syncSettingsOpenProof?.activeTabId !== CURRENT_SYNC_TAB_ID
  ) {
    failures.push('current Settings entry must open the Sync tab')
  }
  if (
    Number(summary?.visibleDeprecatedSyncControlCount) !==
      Number(report?.visibleDeprecatedSyncControlCount) ||
    Number(summary?.visibleDeprecatedSyncAriaCount) !==
      Number(report?.visibleDeprecatedSyncAriaCount) ||
    summary?.settingsEntryActionable !== report?.settingsEntryActionable ||
    summary?.syncSettingsOpened !== report?.syncSettingsOpenProof?.opened ||
    summary?.syncSettingsTabId !== report?.syncSettingsOpenProof?.activeTabId
  ) {
    failures.push('current-page QA summary must match raw shell evidence')
  }

  return failures
}

export function assertWebCurrentShellEvidenceValidatorContract() {
  const validReport = {
    settingsEntryActionable: true,
    syncSettingsOpenProof: {
      activeTabId: CURRENT_SYNC_TAB_ID,
      opened: true,
    },
    visibleDeprecatedSyncAriaCount: 0,
    visibleDeprecatedSyncControlCount: 0,
  }
  const validSummary = {
    settingsEntryActionable: true,
    syncSettingsOpened: true,
    syncSettingsTabId: CURRENT_SYNC_TAB_ID,
    visibleDeprecatedSyncAriaCount: 0,
    visibleDeprecatedSyncControlCount: 0,
  }
  const mutations = [
    [{ ...validReport, visibleDeprecatedSyncControlCount: 1 }, validSummary],
    [{ ...validReport, visibleDeprecatedSyncAriaCount: 1 }, validSummary],
    [{ ...validReport, settingsEntryActionable: false }, validSummary],
    [
      { ...validReport, syncSettingsOpenProof: { activeTabId: '', opened: false } },
      validSummary,
    ],
    [validReport, { ...validSummary, syncSettingsOpened: false }],
  ]

  if (findWebCurrentShellEvidenceFailures(validReport, validSummary).length > 0) {
    throw new Error('Current Web shell evidence validator rejects its valid baseline.')
  }
  for (const [report, summary] of mutations) {
    if (findWebCurrentShellEvidenceFailures(report, summary).length === 0) {
      throw new Error('Current Web shell evidence validator accepted a negative mutation.')
    }
  }
}
