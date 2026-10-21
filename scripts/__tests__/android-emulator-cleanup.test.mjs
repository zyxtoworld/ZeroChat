import { describe, expect, it } from 'vitest'

import {
  cleanupStartedEmulator,
  forceKillOwnedProcessTree,
} from '../android-emulator-cleanup.mjs'
import { asciiSdkRoot } from '../android-sdk-tools.mjs'

function fakeFs({ existing = [], links = {} } = {}) {
  const files = new Set(existing)
  const createdLinks = []

  return {
    createdLinks,
    fs: {
      exists(value) {
        return files.has(value) || Object.hasOwn(links, value)
      },
      lstat(value) {
        return { isSymbolicLink: () => Object.hasOwn(links, value) }
      },
      mkdir() {},
      readlink(value) {
        return links[value]
      },
      symlink(target, value, type) {
        createdLinks.push({ target, value, type })
        links[value] = target
      },
    },
  }
}

describe('Android emulator cleanup ownership', () => {
  it('force-cleans only the owned PID tree after boot timeout without a device', () => {
    const calls = []
    let ownedProcessAlive = true

    cleanupStartedEmulator({
      startedEmulator: true,
      keepEmulator: false,
      selectedDevice: null,
      runAdb: (...args) => calls.push(['adb', args]),
      waitForStartedEmulatorExit: () => {
        calls.push(['wait-owned'])
        return false
      },
      forceKillStartedEmulatorProcess: () => {
        calls.push(['force-owned', 7_844])
        ownedProcessAlive = false
      },
      waitForAndroidEmulatorProcessesExit: () => {
        calls.push(['wait-family'])
        return true
      },
      log: (...args) => calls.push(['log', ...args]),
      warn: (...args) => calls.push(['warn', ...args]),
    })

    expect(calls).toEqual([
      ['log', '\nNo Android device became ready; forcing owned emulator cleanup...'],
      ['wait-owned'],
      ['force-owned', 7_844],
      ['wait-family'],
    ])
    expect(ownedProcessAlive).toBe(false)
    expect(calls.some(([kind]) => kind === 'adb')).toBe(false)
    expect(calls.some(([kind]) => kind === 'warn')).toBe(false)
  })

  it('uses adb emu kill first for a ready emulator and does not force-kill', () => {
    const calls = []

    cleanupStartedEmulator({
      startedEmulator: true,
      keepEmulator: false,
      selectedDevice: 'emulator-5554',
      runAdb: (...args) => calls.push(['adb', args]),
      waitForStartedEmulatorExit: () => true,
      forceKillStartedEmulatorProcess: () => calls.push(['force']),
      waitForAndroidEmulatorProcessesExit: () => true,
      log: (...args) => calls.push(['log', ...args]),
      warn: (...args) => calls.push(['warn', ...args]),
    })

    expect(calls).toContainEqual([
      'adb',
      [['-s', 'emulator-5554', 'emu', 'kill'], { timeout: 10_000 }],
    ])
    expect(calls.some(([kind]) => kind === 'force')).toBe(false)
  })

  it('does not kill anything when the emulator is explicitly kept', () => {
    const calls = []

    cleanupStartedEmulator({
      startedEmulator: true,
      keepEmulator: true,
      selectedDevice: null,
      runAdb: () => calls.push('adb'),
      waitForStartedEmulatorExit: () => calls.push('wait-owned'),
      forceKillStartedEmulatorProcess: () => calls.push('force'),
      waitForAndroidEmulatorProcessesExit: () => calls.push('wait-family'),
    })

    expect(calls).toEqual([])
  })

  it('uses the exact Windows PID tree command and no other PID', () => {
    let alive = true
    const calls = []
    const killed = forceKillOwnedProcessTree({
      processId: 7_844,
      processIsAlive: (pid) => pid === 7_844 && alive,
      platform: 'win32',
      spawnSyncFn: (...args) => {
        calls.push(args)
        alive = false
        return { status: 0, stdout: '', stderr: '' }
      },
      processKill: () => calls.push(['process.kill']),
      waitForExit: () => true,
    })

    expect(killed).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0][0]).toBe('taskkill')
    expect(calls[0][1]).toEqual(['/PID', '7844', '/T', '/F'])
  })
})

describe('Android SDK path ownership', () => {
  const sdk = 'E:\\项目\\ZeroChat\\.local\\zerochat\\toolchains\\android-sdk'
  const tempDirectory = 'C:\\Users\\ZYX\\AppData\\Local\\Temp'

  it('creates an ASCII junction for a non-ASCII SDK root', () => {
    const fake = fakeFs({ existing: [sdk] })
    const result = asciiSdkRoot(sdk, {
      platform: 'win32',
      tempDirectory,
      fs: fake.fs,
    })

    expect(result).toMatch(/^C:\\Users\\ZYX\\AppData\\Local\\Temp\\zerochat-android-sdk-junctions\\[0-9a-f]{16}$/u)
    expect(fake.createdLinks).toEqual([
      { target: sdk, value: result, type: 'junction' },
    ])
  })

  it('reuses only a junction pointing to the exact SDK root', () => {
    const first = fakeFs({ existing: [sdk] })
    const link = asciiSdkRoot(sdk, {
      platform: 'win32',
      tempDirectory,
      fs: first.fs,
    })
    const reused = asciiSdkRoot(sdk, {
      platform: 'win32',
      tempDirectory,
      fs: fakeFs({ existing: [sdk], links: { [link]: sdk } }).fs,
    })

    expect(reused).toBe(link)
  })

  it('fails closed for an existing non-junction or wrong-target path', () => {
    const first = fakeFs({ existing: [sdk] })
    const link = asciiSdkRoot(sdk, {
      platform: 'win32',
      tempDirectory,
      fs: first.fs,
    })
    const wrong = asciiSdkRoot(sdk, {
      platform: 'win32',
      tempDirectory,
      fs: fakeFs({
        existing: [sdk],
        links: { [link]: 'C:\\other\\sdk' },
      }).fs,
    })

    expect(wrong).toBeNull()
  })
})
