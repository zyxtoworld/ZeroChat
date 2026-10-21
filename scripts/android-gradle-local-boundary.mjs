import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  symlinkSync,
} from 'node:fs'
import path from 'node:path'

function hasNonAscii(value) {
  return /[^\x00-\x7F]/u.test(value)
}

function defaultFileSystem() {
  return {
    exists: existsSync,
    lstat: lstatSync,
    mkdir: mkdirSync,
    readlink: readlinkSync,
    symlink: symlinkSync,
  }
}

export function androidGradleLocalPaths(repoRoot, { platform = process.platform } = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path
  const normalizedRepoRoot = pathApi.resolve(repoRoot)
  const localRoot = pathApi.join(normalizedRepoRoot, '.local', 'zerochat')

  return Object.freeze({
    tempRoot: pathApi.join(localRoot, 'tmp'),
    gradleUserHome: pathApi.join(localRoot, 'private', 'gradle-home'),
  })
}

export function androidGradleExecutionPaths(
  repoRoot,
  {
    platform = process.platform,
    sourceEnv = process.env,
    asciiHostRoot,
    fs = defaultFileSystem(),
  } = {},
) {
  const localPaths = androidGradleLocalPaths(repoRoot ?? process.cwd(), { platform })

  if (platform !== 'win32' || !hasNonAscii(localPaths.tempRoot)) {
    return localPaths
  }

  const hostRoot = asciiHostRoot ?? [
    sourceEnv.LOCALAPPDATA,
    sourceEnv.TEMP,
    sourceEnv.TMP,
    'C:\\Windows\\Temp',
  ].find((candidate) =>
    typeof candidate === 'string' &&
    candidate.length > 0 &&
    !hasNonAscii(candidate) &&
    fs.exists(candidate),
  )

  if (!hostRoot || hasNonAscii(hostRoot)) {
    throw new Error(
      'Android Gradle requires an existing ASCII Windows host path for its project-local junction.',
    )
  }

  const pathApi = platform === 'win32' ? path.win32 : path
  const linkRoot = pathApi.join(hostRoot, 'ZeroChat', 'android-gradle-junctions')
  const linkName = createHash('sha256')
    .update(pathApi.resolve(pathApi.join(repoRoot ?? process.cwd(), '.local', 'zerochat')))
    .digest('hex')
    .slice(0, 16)
  const linkPath = pathApi.join(linkRoot, linkName)
  const localRoot = pathApi.dirname(localPaths.tempRoot)

  fs.mkdir(linkRoot, { recursive: true })
  if (fs.exists(linkPath)) {
    const link = fs.lstat(linkPath)
    if (!link.isSymbolicLink()) {
      throw new Error(`Android Gradle ASCII junction is not a junction: ${linkPath}`)
    }
    const target = fs.readlink(linkPath)
    if (pathApi.resolve(target).toLowerCase() !== pathApi.resolve(localRoot).toLowerCase()) {
      throw new Error(`Android Gradle ASCII junction points to an unexpected target: ${linkPath}`)
    }
  } else {
    fs.symlink(localRoot, linkPath, 'junction')
  }

  return Object.freeze({
    tempRoot: pathApi.join(linkPath, 'tmp'),
    gradleUserHome: pathApi.join(linkPath, 'private', 'gradle-home'),
  })
}

export function androidGradleChildEnvironment({
  repoRoot,
  sourceEnv = process.env,
  executionOptions = {},
} = {}) {
  const paths = androidGradleExecutionPaths(repoRoot ?? process.cwd(), {
    sourceEnv,
    ...executionOptions,
  })

  return {
    ...sourceEnv,
    GRADLE_USER_HOME: paths.gradleUserHome,
    TEMP: paths.tempRoot,
    TMP: paths.tempRoot,
    TMPDIR: paths.tempRoot,
  }
}
