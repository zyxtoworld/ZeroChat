import path from 'node:path'
import { spawnSync } from 'node:child_process'

import { expect, it } from 'vitest'

import {
  androidGradleChildEnvironment,
  androidGradleExecutionPaths,
  androidGradleLocalPaths,
} from '../android-gradle-local-boundary.mjs'

const repoRoot = path.resolve(import.meta.dirname, '../..')

function fakeFileSystem(existing = []) {
  const files = new Set(existing)
  const links = new Map()

  return {
    fs: {
      exists(value) {
        return files.has(value) || links.has(value)
      },
      lstat(value) {
        return { isSymbolicLink: () => links.has(value) }
      },
      mkdir() {},
      readlink(value) {
        return links.get(value)
      },
      symlink(target, value) {
        links.set(value, target)
      },
    },
    links,
  }
}

it('binds Android Gradle child environment to the ASCII project-local junction', () => {
  const asciiHostRoot = 'C:\\ZeroChatGradleHost'
  const fake = fakeFileSystem([asciiHostRoot])
  const localPaths = androidGradleLocalPaths(repoRoot)
  const childEnvironment = androidGradleChildEnvironment({
    repoRoot,
    sourceEnv: {
      ...process.env,
      USERPROFILE: 'C:\\Users\\ZYX',
      LOCALAPPDATA: asciiHostRoot,
      GRADLE_USER_HOME: 'C:\\Users\\ZYX\\.gradle',
      TEMP: 'C:\\Users\\ZYX\\AppData\\Local\\Temp',
      TMP: 'C:\\Users\\ZYX\\AppData\\Local\\Temp',
      TMPDIR: 'C:\\Users\\ZYX\\AppData\\Local\\Temp',
    },
    executionOptions: {
      platform: 'win32',
      asciiHostRoot,
      fs: fake.fs,
    },
  })

  expect(localPaths.gradleUserHome).toBe(
    path.join(repoRoot, '.local', 'codex', 'private', 'gradle-home'),
  )
  expect(childEnvironment.GRADLE_USER_HOME).not.toContain('E:\\项目')
  expect(childEnvironment.TEMP).not.toContain('E:\\项目')
  expect(childEnvironment.TMP).toBe(childEnvironment.TEMP)
  expect(childEnvironment.TMPDIR).toBe(childEnvironment.TEMP)
  expect(fake.links.size).toBe(1)

  const executionPaths = androidGradleExecutionPaths(repoRoot, {
    platform: 'win32',
    asciiHostRoot,
    fs: fake.fs,
  })
  expect(executionPaths.gradleUserHome).toBe(childEnvironment.GRADLE_USER_HOME)
  expect(executionPaths.tempRoot).toBe(childEnvironment.TEMP)

  for (const value of [
    childEnvironment.GRADLE_USER_HOME,
    childEnvironment.TEMP,
    childEnvironment.TMP,
    childEnvironment.TMPDIR,
  ]) {
    expect(path.isAbsolute(value)).toBe(true)
    expect(value).not.toMatch(/[^\x00-\x7F]/u)
    expect(value.toLowerCase()).toContain(asciiHostRoot.toLowerCase())
    expect(value.toLowerCase()).not.toContain('c:\\users\\zyx')
  }

  const probe = spawnSync(
    process.execPath,
    [
      '-e',
      "process.stdout.write(JSON.stringify({gradle:process.env.GRADLE_USER_HOME,temp:process.env.TEMP,tmp:process.env.TMP,tmpdir:process.env.TMPDIR}))",
    ],
    { env: childEnvironment, encoding: 'utf8', windowsHide: true },
  )
  expect(probe.status).toBe(0)
  expect(JSON.parse(probe.stdout)).toEqual({
    gradle: childEnvironment.GRADLE_USER_HOME,
    temp: childEnvironment.TEMP,
    tmp: childEnvironment.TMP,
    tmpdir: childEnvironment.TMPDIR,
  })
})
