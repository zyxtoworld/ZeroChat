import { EventEmitter } from 'node:events'
import { existsSync, rmSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const { rm, spawnSync } = vi.hoisted(() => ({
  rm: vi.fn(async () => undefined),
  spawnSync: vi.fn(() => {
    return { error: undefined, status: 0, stderr: '', stdout: '' }
  }),
}))

vi.mock('node:child_process', () => ({ spawnSync }))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal()),
  rm,
}))

const {
  buildWindowsProfileProcessCleanupScript,
  removeBrowserProfileWithRetry,
  settleBrowserRuntimeCleanup,
  stopChildProcessTree,
  stopWindowsProcessesUsingProfile,
} = await import('../browser-runtime-cleanup.mjs')

describe('browser runtime cleanup', () => {
  it('does not recover from a Windows tree error without exit and profile proof', async () => {
    const events = []
    const treeError = Object.assign(new Error('taskkill lost the root'), {
      childQuiesced: false,
    })

    await expect(
      settleBrowserRuntimeCleanup({
        platform: 'win32',
        stopProcessTree: async () => {
          events.push('tree')
          throw treeError
        },
        removeProfile: async () => {
          events.push('profile')
          return true
        },
      }),
    ).rejects.toMatchObject({ childQuiesced: false })
    expect(events).toEqual(['tree', 'profile'])
  })

  it('falls back to exact-profile cleanup after an unconfirmed Windows tree kill', async () => {
    const events = []
    const child = { pid: 4203, exitCode: 0, signalCode: null }
    const treeError = Object.assign(
      new Error('taskkill did not confirm the child process tree was terminated (status 128)'),
      { childQuiesced: false, childExited: true, childPid: child.pid },
    )

    await expect(
      settleBrowserRuntimeCleanup({
        platform: 'win32',
        child,
        profilePath: 'C:\\Users\\ZYX\\AppData\\Local\\Temp\\zerochat-proof',
        stopProcessTree: async () => {
          events.push('tree')
          throw treeError
        },
        removeProfile: async () => {
          events.push('profile')
          return {
            profileRemoved: true,
            exactProfileProcessesGone: true,
            profilePath: 'C:\\Users\\ZYX\\AppData\\Local\\Temp\\zerochat-proof',
          }
        },
        additionalCleanup: [async () => events.push('preview')],
      }),
    ).resolves.toEqual({
      childQuiesced: true,
      profileRemoved: true,
      recoveredByProfileSweep: true,
    })
    expect(events).toEqual(['tree', 'profile', 'preview'])
  })

  it('rejects profile recovery when the tree error names a different child PID', async () => {
    const child = { pid: 4204, exitCode: 0, signalCode: null }
    const treeError = Object.assign(new Error('taskkill status 128'), {
      childQuiesced: false,
      childExited: true,
      childPid: 9999,
    })

    await expect(
      settleBrowserRuntimeCleanup({
        platform: 'win32',
        child,
        profilePath: 'C:\\Users\\ZYX\\AppData\\Local\\Temp\\zerochat-proof',
        stopProcessTree: async () => {
          throw treeError
        },
        removeProfile: async () => ({
          profileRemoved: true,
          exactProfileProcessesGone: true,
          profilePath: 'C:\\Users\\ZYX\\AppData\\Local\\Temp\\zerochat-proof',
        }),
      }),
    ).rejects.toMatchObject({ childQuiesced: false })
  })

  it('runs every cleanup step and fails closed when owned descendants remain', async () => {
    const events = []
    const treeError = Object.assign(new Error('owned descendant remains'), {
      childQuiesced: false,
    })
    const profileError = Object.assign(new Error('profile remains locked'), {
      childQuiesced: false,
    })

    await expect(
      settleBrowserRuntimeCleanup({
        platform: 'win32',
        stopProcessTree: async () => {
          events.push('tree')
          throw treeError
        },
        removeProfile: async () => {
          events.push('profile')
          throw profileError
        },
        additionalCleanup: [async () => events.push('preview')],
      }),
    ).rejects.toMatchObject({
      childQuiesced: false,
      errors: [treeError, profileError],
    })
    expect(events).toEqual(['tree', 'profile', 'preview'])
  })

  it('fails closed when exact-profile process cleanup cannot confirm quiescence', async () => {
    if (process.platform !== 'win32') return

    const profile = await mkdtemp(path.join(tmpdir(), 'zerochat-cleanup-unconfirmed-'))
    spawnSync.mockReset()
    spawnSync.mockReturnValue({ error: undefined, status: 3, stderr: '', stdout: '' })
    rm.mockReset()
    rm.mockResolvedValue(undefined)

    try {
      await expect(removeBrowserProfileWithRetry(profile, 1)).rejects.toThrow(
        /profile process cleanup did not confirm quiescence/u,
      )
      expect(rm).not.toHaveBeenCalled()
    } finally {
      spawnSync.mockReset()
      spawnSync.mockReturnValue({ error: undefined, status: 0, stderr: '', stdout: '' })
      rm.mockReset()
      rm.mockResolvedValue(undefined)
      rmSync(profile, { recursive: true, force: true })
    }
  }, 60_000)

  it('fails closed when Windows taskkill cannot confirm tree termination', async () => {
    const child = new EventEmitter()
    child.pid = 4201
    child.exitCode = null
    child.signalCode = null
    const rootKill = vi.fn()
    const taskkillError = new Error('taskkill unavailable')

    await expect(
      stopChildProcessTree(child, 20, {
        platform: 'win32',
        spawnSyncImpl: () => ({ error: taskkillError, status: null, signal: 'SIGTERM' }),
      }),
    ).rejects.toMatchObject({ childQuiesced: false })
    expect(rootKill).not.toHaveBeenCalled()
  })

  it('terminates a POSIX process group and escalates when descendants ignore TERM', async () => {
    const child = new EventEmitter()
    child.pid = 4202
    child.exitCode = null
    child.signalCode = null
    let groupAlive = true
    const signals = []
    const processKill = vi.fn((_pid, signal) => {
      signals.push(signal)
      if (signal === 'SIGKILL') {
        groupAlive = false
        child.exitCode = null
        child.signalCode = 'SIGKILL'
        queueMicrotask(() => child.emit('exit', null, 'SIGKILL'))
      }
    })

    await expect(
      stopChildProcessTree(child, 40, {
        platform: 'linux',
        processKill,
        processGroupExists: () => groupAlive,
        processGroupLeader: true,
        sleepImpl: async () => {},
      }),
    ).resolves.toMatchObject({ childQuiesced: true })
    expect(processKill).toHaveBeenCalledWith(-4202, 'SIGTERM')
    expect(processKill).toHaveBeenCalledWith(-4202, 'SIGKILL')
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('requires the Settings overlay caller to create a POSIX process group', async () => {
    const source = await readFile(
      path.resolve('scripts/settings-overlay-preload-smoke.mjs'),
      'utf8',
    )
    expect(source).toContain("detached: process.platform !== 'win32'")
  })

  it('kills a non-detached POSIX root but fails closed because descendants are unverified', async () => {
    const { spawn: realSpawn } = await vi.importActual('node:child_process')
    const child = realSpawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      detached: false,
    })
    const processKill = vi.fn((pid, signal) => {
      if (pid < 0) {
        const error = new Error('non-detached child has no process group')
        error.code = 'ESRCH'
        throw error
      }
      return child.kill(signal)
    })

    try {
      await expect(
        stopChildProcessTree(child, 2_000, {
          platform: 'linux',
          processKill,
          processGroupExists: () => false,
          sleepImpl: async () => {},
        }),
      ).rejects.toMatchObject({ childQuiesced: false, childExited: true })
      expect(processKill.mock.calls.every(([pid]) => pid > 0)).toBe(true)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL')
      }
      if (child.exitCode === null && child.signalCode === null) {
        await new Promise((resolve) => child.once('exit', resolve))
      }
    }
  }, 60_000)

  it('sweeps an existing profile before its first deletion attempt', async () => {
    const profile = await mkdtemp(path.join(tmpdir(), 'zerochat-cleanup-test-'))
    await writeFile(path.join(profile, 'lock'), '')
    const events = []
    let profileExistedAtSweep = false
    spawnSync.mockImplementation(() => {
      events.push('sweep')
      profileExistedAtSweep = existsSync(profile)
      return { error: undefined, status: 0, stderr: '', stdout: '' }
    })
    rm.mockReset()
    rm.mockImplementation(async () => {
      events.push('rm')
    })

    await expect(removeBrowserProfileWithRetry(profile, 1)).resolves.toBe(true)
    if (process.platform === 'win32') {
      expect(spawnSync).toHaveBeenCalledOnce()
      expect(profileExistedAtSweep).toBe(true)
      expect(events).toEqual(['sweep', 'rm'])
    }
    rmSync(profile, { recursive: true, force: true })
  })

  it('derives a complete post-order tree from one full process snapshot', () => {
    if (process.platform !== 'win32') return

    spawnSync.mockReset()
    spawnSync.mockReturnValue({ error: undefined, status: 0, stderr: '', stdout: '' })

    expect(
      stopWindowsProcessesUsingProfile(
        'C:\\Users\\ZYX\\AppData\\Local\\Temp\\zerochat-cleanup-test',
      ),
    ).toBe(true)

    const command = String(spawnSync.mock.calls[0]?.[1]?.at(-1) ?? '')
    expect(command).toContain('$all = @(Get-CimInstance Win32_Process)')
    expect(command).toContain('$childrenByParent')
    expect(command).toContain('ParentProcessId')
    expect(command).toContain('$profileSeedIds')
    expect(command).toContain('$targetRoots')
    expect(command).toContain('function Add-PostOrder')
    expect(command).not.toContain('CommandLine LIKE')
})

  it('stops only browser processes whose user-data-dir argument exactly owns the target profile', async () => {
    if (process.platform !== 'win32') return

    const targetProfile = 'C:\\Users\\ZYX\\AppData\\Local\\Temp\\zerochat-cleanup-test'
    const fakePowerShell = [
      'function global:Get-CimInstance {',
      '  @(',
      `    [pscustomobject]@{ ProcessId = 101; ParentProcessId = 1; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir="${targetProfile}"' },`,
      `    [pscustomobject]@{ ProcessId = 102; ParentProcessId = 1; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir="${targetProfile}foobar"' },`,
      `    [pscustomobject]@{ ProcessId = 105; ParentProcessId = 1; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir "${targetProfile}"' },`,
      `    [pscustomobject]@{ ProcessId = 106; ParentProcessId = 1; Name = 'chrome.exe'; CommandLine = 'chrome.exe "--app=https://example.invalid/?q= --user-data-dir=${targetProfile}"' },`,
      `    [pscustomobject]@{ ProcessId = 107; ParentProcessId = 1; Name = 'chrome.exe'; CommandLine = "chrome.exe --user-data-dir='${targetProfile}'" },`,
      "    [pscustomobject]@{ ProcessId = 103; Name = 'msedge.exe'; CommandLine = 'msedge.exe --user-data-dir=C:\\Users\\ZYX\\OtherProfile' },",
      "    [pscustomobject]@{ ProcessId = 104; Name = 'chromium.exe'; CommandLine = 'chromium.exe --incognito' }",
      '  )',
      '}',
      '$script:alive = @{ 101 = $true; 105 = $true }',
      'function global:Get-Process {',
      '  param([int] $Id)',
      '  if ($script:alive.ContainsKey($Id)) { [pscustomobject]@{ Id = $Id } }',
      '}',
      'function global:Stop-Process {',
      '  param([int] $Id)',
      '  $script:alive.Remove($Id) | Out-Null',
      '  Write-Output "STOPPED:$Id"',
      '}',
      buildWindowsProfileProcessCleanupScript(),
    ].join('\n')
    const { spawnSync: runPowerShell } = await vi.importActual('node:child_process')
    const result = runPowerShell(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', fakePowerShell],
      {
        env: {
          ...process.env,
          ZEROCHAT_BROWSER_PROFILE_TO_STOP: targetProfile,
        },
        encoding: 'utf8',
        windowsHide: true,
      },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('STOPPED:101')
    expect(result.stdout).toContain('STOPPED:105')
    expect(result.stdout).not.toContain('STOPPED:102')
    expect(result.stdout).not.toContain('STOPPED:103')
    expect(result.stdout).not.toContain('STOPPED:104')
    expect(result.stdout).not.toContain('STOPPED:106')
    expect(result.stdout).not.toContain('STOPPED:107')
  }, 60_000)

  it('stops the complete exact-profile descendant tree in post-order', async () => {
    if (process.platform !== 'win32') return

    const targetProfile = 'C:\\Users\\ZYX\\AppData\\Local\\Temp\\zerochat-cleanup-test'
    const otherProfile = 'C:\\Users\\ZYX\\AppData\\Local\\Temp\\other-profile'
    const fakePowerShell = [
      'function global:Get-CimInstance {',
      '  @(',
      `    [pscustomobject]@{ ProcessId = 101; ParentProcessId = 1; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir="${targetProfile}"' },`,
      "    [pscustomobject]@{ ProcessId = 201; ParentProcessId = 101; Name = 'chrome.exe'; CommandLine = 'chrome.exe --type=renderer --field-trial-handle=1' },",
      "    [pscustomobject]@{ ProcessId = 301; ParentProcessId = 201; Name = 'chrome.exe'; CommandLine = 'chrome.exe --type=gpu-process --gpu-preferences=encoded' },",
      `    [pscustomobject]@{ ProcessId = 401; ParentProcessId = 1; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir="${otherProfile}"' },`,
      "    [pscustomobject]@{ ProcessId = 501; ParentProcessId = 401; Name = 'chrome.exe'; CommandLine = 'chrome.exe --type=renderer' }",
      '  )',
      '}',
      '$script:alive = @{ 101 = $true; 201 = $true; 301 = $true; 401 = $true; 501 = $true }',
      'function global:Get-Process {',
      '  param([int] $Id)',
      '  if ($script:alive.ContainsKey($Id)) { [pscustomobject]@{ Id = $Id } }',
      '}',
      'function global:Stop-Process {',
      '  param([int] $Id)',
      '  $script:alive.Remove($Id) | Out-Null',
      '  Write-Output "STOPPED:$Id"',
      '}',
      buildWindowsProfileProcessCleanupScript(),
    ].join('\n')
    const { spawnSync: runPowerShell } = await vi.importActual('node:child_process')
    const result = runPowerShell(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', fakePowerShell],
      {
        env: {
          ...process.env,
          ZEROCHAT_BROWSER_PROFILE_TO_STOP: targetProfile,
        },
        encoding: 'utf8',
        windowsHide: true,
      },
    )

    expect(result.status).toBe(0)
    const stopped = result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('STOPPED:'))
    expect(stopped).toEqual(['STOPPED:301', 'STOPPED:201', 'STOPPED:101'])
    expect(result.stdout).not.toContain('STOPPED:401')
    expect(result.stdout).not.toContain('STOPPED:501')
  }, 60_000)

  it('re-enumerates and sweeps descendants again after a failed deletion', async () => {
    if (process.platform !== 'win32') return

    spawnSync.mockReset()
    rm.mockReset()
    const profile = await mkdtemp(path.join(tmpdir(), 'zerochat-cleanup-retry-'))
    const targetProfile = profile.replaceAll('/', '\\')
    const { spawnSync: runPowerShell } = await vi.importActual('node:child_process')
    const sweepOutputs = []
    let sweep = 0
    spawnSync.mockImplementation((command, _args, options) => {
      sweep += 1
      const records = sweep === 1
        ? [
            `[pscustomobject]@{ ProcessId = 101; ParentProcessId = 1; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir="${targetProfile}"' }`,
          ]
        : [
            `[pscustomobject]@{ ProcessId = 101; ParentProcessId = 1; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir="${targetProfile}"' }`,
            `[pscustomobject]@{ ProcessId = 202; ParentProcessId = 101; Name = 'chrome.exe'; CommandLine = 'chrome.exe --type=renderer' }`,
          ]
      const fakePowerShell = [
        'function global:Get-CimInstance { @(',
        `  ${records.join(',\n  ')}`,
        ') }',
        (() => {
          const aliveIds = sweep === 1 ? [101] : [101, 202]
          const aliveTable = aliveIds.map((id) => `${id} = $true`).join('; ')
          return `$script:alive = @{ ${aliveTable} }`
        })(),
        'function global:Get-Process { param([int] $Id); if ($script:alive.ContainsKey($Id)) { [pscustomobject]@{ Id = $Id } } }',
        'function global:Stop-Process { param([int] $Id); $script:alive.Remove($Id) | Out-Null; Write-Output "STOPPED:$Id" }',
        buildWindowsProfileProcessCleanupScript(),
      ].join('\n')
      const result = runPowerShell(
        command,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', fakePowerShell],
        options,
      )
      sweepOutputs.push(result.stdout)
      return result
    })
    rm.mockRejectedValueOnce(new Error('profile is busy')).mockResolvedValue(undefined)

    await expect(removeBrowserProfileWithRetry(profile, 2)).resolves.toBe(true)
    expect(spawnSync).toHaveBeenCalledTimes(2)
    expect(sweepOutputs[0]).toContain('STOPPED:101')
    expect(sweepOutputs[1]).toContain('STOPPED:202')
    rmSync(profile, { recursive: true, force: true })
  }, 60_000)

  it('accepts quoted and separated argv values when the target profile contains spaces', async () => {
    if (process.platform !== 'win32') return

    const targetProfile = 'C:\\Users\\ZYX\\AppData\\Local\\Temp\\zerochat cleanup test'
    const fakePowerShell = [
      'function global:Get-CimInstance {',
      '  @(',
      `    [pscustomobject]@{ ProcessId = 201; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir="${targetProfile}"' },`,
      `    [pscustomobject]@{ ProcessId = 202; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir "${targetProfile}"' },`,
      `    [pscustomobject]@{ ProcessId = 203; Name = 'chrome.exe'; CommandLine = 'chrome.exe --user-data-dir="${targetProfile}other"' },`,
      `    [pscustomobject]@{ ProcessId = 204; Name = 'chrome.exe'; CommandLine = 'chrome.exe "--app=https://example.invalid/?q= --user-data-dir=${targetProfile}"' }`,
      '  )',
      '}',
      '$script:alive = @{ 201 = $true; 202 = $true }',
      'function global:Get-Process {',
      '  param([int] $Id)',
      '  if ($script:alive.ContainsKey($Id)) { [pscustomobject]@{ Id = $Id } }',
      '}',
      'function global:Stop-Process {',
      '  param([int] $Id)',
      '  $script:alive.Remove($Id) | Out-Null',
      '  Write-Output "STOPPED:$Id"',
      '}',
      buildWindowsProfileProcessCleanupScript(),
    ].join('\n')
    const { spawnSync: runPowerShell } = await vi.importActual('node:child_process')
    const result = runPowerShell(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', fakePowerShell],
      {
        env: {
          ...process.env,
          ZEROCHAT_BROWSER_PROFILE_TO_STOP: targetProfile,
        },
        encoding: 'utf8',
        windowsHide: true,
      },
    )

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('STOPPED:201')
    expect(result.stdout).toContain('STOPPED:202')
    expect(result.stdout).not.toContain('STOPPED:203')
    expect(result.stdout).not.toContain('STOPPED:204')
  }, 60_000)
})
