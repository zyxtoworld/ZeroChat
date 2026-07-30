export const baselineReleaseBlockerIds = [
  'apple-target-runtime-qa',
  'linux-target-runtime-qa',
  'windows-trusted-msix-release-pass',
  'disposable-live-sync-release-pass',
  'hosted-native-ci-release-evidence',
  'live-provider-full-capability-release-evidence',
]

const directStrictBlockers = new Map([
  ['Live sync release-pass evidence', 'disposable-live-sync-release-pass'],
  ['Hosted native CI release evidence', 'hosted-native-ci-release-evidence'],
  [
    'Live provider full capability release evidence',
    'live-provider-full-capability-release-evidence',
  ],
])
const nativeRuntimeTargets = new Map([
  [
    'apple-target-runtime-qa',
    /(?:\bapple\s*:|apple-runtime|apple target|\.manual-qa[\\/]apple|\bios\b|\bmacos\b)/iu,
  ],
  [
    'linux-target-runtime-qa',
    /(?:\blinux\s*:|linux-runtime|linux target|\.manual-qa[\\/]linux|\bgtk4\b|libadwaita|secret service)/iu,
  ],
  [
    'windows-trusted-msix-release-pass',
    /(?:\bwindows\s*:|windows-msix|windows trusted|\.manual-qa[\\/]windows|\bappx\b|\bmsix\b)/iu,
  ],
])

const requestedEvidenceCoverage = new Map([
  ['nativeRuntimeArtifacts', [...nativeRuntimeTargets.keys()]],
  ['liveSyncReleasePass', ['disposable-live-sync-release-pass']],
  ['hostedNativeCiEvidence', ['hosted-native-ci-release-evidence']],
  ['liveProviderFullCapability', ['live-provider-full-capability-release-evidence']],
])

const requestedEvidenceKeys = [
  'allPlatforms',
  ...requestedEvidenceCoverage.keys(),
]

function strictBlockers(report) {
  return Array.isArray(report?.blockers)
    ? report.blockers.filter((blocker) => blocker && typeof blocker === 'object')
    : []
}

function blockerText(blocker) {
  return `${String(blocker?.label ?? '')}\n${String(blocker?.message ?? '')}`
}

function requestedBaselineCoverage(report) {
  const requestedEvidence = report?.requestedEvidence

  if (
    !requestedEvidence ||
    typeof requestedEvidence !== 'object' ||
    requestedEvidenceKeys.some(
      (key) => typeof requestedEvidence[key] !== 'boolean',
    )
  ) {
    return null
  }

  const covered = new Set()
  for (const [key, blockerIds] of requestedEvidenceCoverage) {
    if (!requestedEvidence[key]) continue
    for (const blockerId of blockerIds) covered.add(blockerId)
  }

  return covered
}

function normalizedCandidateIds(candidateIds) {
  const candidates = Array.isArray(candidateIds)
    ? candidateIds
    : baselineReleaseBlockerIds
  const candidateSet = new Set(
    candidates.filter((id) => baselineReleaseBlockerIds.includes(id)),
  )

  return baselineReleaseBlockerIds.filter((id) => candidateSet.has(id))
}

export function isStrictReleasePass(report) {
  return (
    report?.status === 'passed' &&
    report?.passed === true &&
    report?.blockerCount === 0 &&
    strictBlockers(report).length === 0
  )
}

export function isStrictReleaseBlocked(report) {
  const blockers = strictBlockers(report)

  return (
    report?.status === 'blocked' &&
    report?.passed === false &&
    Number.isInteger(report?.blockerCount) &&
    report.blockerCount > 0 &&
    blockers.length === report.blockerCount
  )
}

export function activeBaselineReleaseBlockerIds({
  strictReport,
  applePrerequisitesMissing = false,
  linuxPrerequisitesMissing = false,
  candidateIds = baselineReleaseBlockerIds,
} = {}) {
  const candidates = normalizedCandidateIds(candidateIds)
  const candidateSet = new Set(candidates)
  const blockers = strictBlockers(strictReport)
  const coherentState =
    isStrictReleasePass(strictReport) || isStrictReleaseBlocked(strictReport)
  const covered = coherentState
    ? requestedBaselineCoverage(strictReport)
    : null

  if (!covered) {
    return candidates
  }

  const active = new Set(candidates.filter((id) => !covered.has(id)))

  if (applePrerequisitesMissing && candidateSet.has('apple-target-runtime-qa')) {
    active.add('apple-target-runtime-qa')
  }
  if (linuxPrerequisitesMissing && candidateSet.has('linux-target-runtime-qa')) {
    active.add('linux-target-runtime-qa')
  }

  if (isStrictReleasePass(strictReport)) {
    return candidates.filter((id) => active.has(id))
  }

  const prerequisiteBlocker = blockers.find(
    (blocker) => blocker.label === 'All-platform native prerequisites',
  )
  if (prerequisiteBlocker && !applePrerequisitesMissing && !linuxPrerequisitesMissing) {
    for (const id of nativeRuntimeTargets.keys()) {
      if (candidateSet.has(id)) active.add(id)
    }
  }

  const runtimeBlocker = blockers.find(
    (blocker) => blocker.label === 'Native runtime smoke artifacts',
  )
  if (runtimeBlocker) {
    const text = blockerText(runtimeBlocker)
    const matchedTargets = [...nativeRuntimeTargets.entries()]
      .filter(([, pattern]) => pattern.test(text))
      .map(([id]) => id)

    for (const id of matchedTargets.length > 0 ? matchedTargets : nativeRuntimeTargets.keys()) {
      if (candidateSet.has(id)) active.add(id)
    }
  }

  for (const blocker of blockers) {
    const id = directStrictBlockers.get(blocker.label)
    if (id && candidateSet.has(id)) active.add(id)
  }

  return candidates.filter((id) => active.has(id))
}
