export function currentSummaryRefreshPlan(validateSources) {
  return {
    refreshBlockerSummary: {
      label: 'Refresh current release blocker summary',
      args: ['scripts/release-blocker-report.mjs'],
    },
    validateBlockerSources: validateSources
      ? {
          label: 'Validate current release blocker source reports',
          args: ['scripts/release-blocker-report.mjs', '--check'],
        }
      : null,
  }
}
