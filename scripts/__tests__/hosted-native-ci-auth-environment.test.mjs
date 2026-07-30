import { describe, expect, it } from 'vitest'

import {
  deriveHostedNativeCiLocalHandoffState,
  githubTokenEnvironmentKeys,
  hostedNativeCiMissingLocalPrerequisiteAliases,
  probeGitHubCliAuthentication,
  tokenFreeGitHubCliEnvironment,
} from '../hosted-native-ci-auth-environment.mjs'
import { sanitizedDiagnosticEnv } from '../release-diagnostics-env.mjs'

describe('hosted native CI gh auth environment', () => {
  it('stabilizes transient durable keyring failures with a bounded retry', () => {
    let calls = 0

    expect(
      probeGitHubCliAuthentication(() => {
        calls += 1
        return calls === 2
      }),
    ).toBe(true)
    expect(calls).toBe(2)
  })

  it('keeps a genuinely unavailable durable login false after three attempts', () => {
    let calls = 0

    expect(
      probeGitHubCliAuthentication(() => {
        calls += 1
        return false
      }),
    ).toBe(false)
    expect(calls).toBe(3)
  })

  it('removes token credentials case-insensitively without hiding durable gh configuration', () => {
    const env = tokenFreeGitHubCliEnvironment({
      PATH: 'safe-path',
      APPDATA: 'durable-app-data',
      GH_CONFIG_DIR: 'durable-gh-config',
      GH_TOKEN: 'private-token',
      github_token: 'private-token',
      GITHUB_APP_PRIVATE_KEY: 'private-key',
      GH_PROMPT_DISABLED: '0',
    })

    expect(env).toEqual({
      PATH: 'safe-path',
      APPDATA: 'durable-app-data',
      GH_CONFIG_DIR: 'durable-gh-config',
      GH_PROMPT_DISABLED: '1',
    })
  })

  it('documents only credential values, not configuration-location variables', () => {
    expect(githubTokenEnvironmentKeys).toEqual(
      expect.arrayContaining(['GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_APP_PRIVATE_KEY']),
    )
    expect(githubTokenEnvironmentKeys).not.toContain('GH_CONFIG_DIR')
  })

  it('preserves durable gh configuration through the sanitized release diagnostic context', () => {
    const sanitized = sanitizedDiagnosticEnv({
      PATH: 'safe-path',
      APPDATA: 'durable-app-data',
      GH_CONFIG_DIR: 'durable-gh-config',
      GH_TOKEN: 'private-token',
      GITHUB_TOKEN: 'private-token',
    })
    const env = tokenFreeGitHubCliEnvironment(sanitized)

    expect(env).toMatchObject({
      PATH: 'safe-path',
      APPDATA: 'durable-app-data',
      GH_CONFIG_DIR: 'durable-gh-config',
      GH_PROMPT_DISABLED: '1',
    })
    expect(env).not.toHaveProperty('GH_TOKEN')
    expect(env).not.toHaveProperty('GITHUB_TOKEN')
  })

  it('derives local handoff readiness from one captured diagnostic snapshot', () => {
    expect(
      deriveHostedNativeCiLocalHandoffState({
        githubRemoteConfigured: true,
        githubCliAvailable: true,
        githubCliAuthenticated: true,
        gitWorktreeStatusReadable: true,
        gitWorktreeDirty: true,
        nativeSourceStatusReadable: true,
        nativeSourceWorktreeDirty: false,
      }),
    ).toEqual({
      localArtifactFetchReady: true,
      hostedCiCoversCurrentWorktree: false,
      hostedCiCoversCurrentNativeSource: true,
      dirtyStateAffectsHostedCiCoverage: true,
      releaseEvidenceHandoffReady: false,
      missingLocalPrerequisites: ['clean-git-worktree'],
    })
  })

  it('keeps missing-prerequisite aliases internally consistent without re-probing host auth', () => {
    const derived = deriveHostedNativeCiLocalHandoffState({
      githubRemoteConfigured: false,
      githubCliAvailable: true,
      githubCliAuthenticated: false,
      gitWorktreeStatusReadable: false,
      gitWorktreeDirty: false,
      nativeSourceStatusReadable: false,
      nativeSourceWorktreeDirty: false,
    })

    expect(derived).toEqual({
      localArtifactFetchReady: false,
      hostedCiCoversCurrentWorktree: false,
      hostedCiCoversCurrentNativeSource: false,
      dirtyStateAffectsHostedCiCoverage: false,
      releaseEvidenceHandoffReady: false,
      missingLocalPrerequisites: [
        'git-remote-origin',
        'github-cli-auth',
        'git-status-readable',
        'native-source-status-readable',
      ],
    })
    expect(hostedNativeCiMissingLocalPrerequisiteAliases).toEqual([
      'git-remote-origin',
      'github-cli-gh',
      'github-cli-auth',
      'git-status-readable',
      'clean-git-worktree',
      'native-source-status-readable',
      'clean-native-source-worktree',
    ])
  })
})
