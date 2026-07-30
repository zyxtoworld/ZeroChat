export const githubTokenEnvironmentKeys = Object.freeze([
  'GH_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_PAT',
  'GITHUB_OAUTH_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
])

export const hostedNativeCiMissingLocalPrerequisiteAliases = Object.freeze([
  'git-remote-origin',
  'github-cli-gh',
  'github-cli-auth',
  'git-status-readable',
  'clean-git-worktree',
  'native-source-status-readable',
  'clean-native-source-worktree',
])

const githubTokenEnvironmentKeySet = new Set(githubTokenEnvironmentKeys)

export function tokenFreeGitHubCliEnvironment(sourceEnv = process.env) {
  const env = Object.fromEntries(
    Object.entries(sourceEnv).filter(
      ([key]) => !githubTokenEnvironmentKeySet.has(key.toUpperCase()),
    ),
  )

  env.GH_PROMPT_DISABLED = '1'
  return env
}

export function probeGitHubCliAuthentication(probe, { attempts = 3 } = {}) {
  if (typeof probe !== 'function') {
    throw new TypeError('GitHub CLI authentication probe must be a function.')
  }

  const boundedAttempts =
    Number.isInteger(attempts) && attempts > 0 ? Math.min(attempts, 3) : 3

  for (let attempt = 0; attempt < boundedAttempts; attempt += 1) {
    try {
      if (probe()) {
        return true
      }
    } catch {
      // A transient keyring read must not flip handoff diagnostics after one probe.
    }
  }

  return false
}

export function deriveHostedNativeCiLocalHandoffState(diagnostics = {}) {
  const localArtifactFetchReady =
    diagnostics.githubRemoteConfigured === true &&
    diagnostics.githubCliAvailable === true &&
    diagnostics.githubCliAuthenticated === true
  const hostedCiCoversCurrentWorktree =
    diagnostics.gitWorktreeStatusReadable === true && diagnostics.gitWorktreeDirty === false
  const hostedCiCoversCurrentNativeSource =
    diagnostics.nativeSourceStatusReadable === true &&
    diagnostics.nativeSourceWorktreeDirty === false
  const dirtyStateAffectsHostedCiCoverage =
    diagnostics.gitWorktreeDirty === true || diagnostics.nativeSourceWorktreeDirty === true
  const releaseEvidenceHandoffReady =
    localArtifactFetchReady &&
    hostedCiCoversCurrentWorktree &&
    hostedCiCoversCurrentNativeSource
  const missingLocalPrerequisites = []

  if (diagnostics.githubRemoteConfigured !== true) {
    missingLocalPrerequisites.push('git-remote-origin')
  }

  if (diagnostics.githubCliAvailable !== true) {
    missingLocalPrerequisites.push('github-cli-gh')
  } else if (diagnostics.githubCliAuthenticated !== true) {
    missingLocalPrerequisites.push('github-cli-auth')
  }

  if (diagnostics.gitWorktreeStatusReadable !== true) {
    missingLocalPrerequisites.push('git-status-readable')
  } else if (diagnostics.gitWorktreeDirty === true) {
    missingLocalPrerequisites.push('clean-git-worktree')
  }

  if (diagnostics.nativeSourceStatusReadable !== true) {
    missingLocalPrerequisites.push('native-source-status-readable')
  } else if (diagnostics.nativeSourceWorktreeDirty === true) {
    missingLocalPrerequisites.push('clean-native-source-worktree')
  }

  return {
    localArtifactFetchReady,
    hostedCiCoversCurrentWorktree,
    hostedCiCoversCurrentNativeSource,
    dirtyStateAffectsHostedCiCoverage,
    releaseEvidenceHandoffReady,
    missingLocalPrerequisites,
  }
}
