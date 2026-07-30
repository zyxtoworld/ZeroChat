import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  androidDebugApkBuildStampPath,
  androidSourceFingerprint,
  sameAndroidSourceFingerprint,
  writeAndroidDebugApkBuildStamp,
} from './android-source-fingerprint.mjs'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '..')
const androidDir = path.join(repoRoot, 'apps', 'android')
const javaExecutable = process.platform === 'win32' ? 'java.exe' : 'java'
const gradleWrapper = path.join(
  androidDir,
  process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
)

function hasNonAscii(value) {
  return /[^\x00-\x7F]/.test(value)
}

function androidExecutionDir() {
  if (process.platform !== 'win32' || !hasNonAscii(androidDir)) {
    return androidDir
  }

  const linkRoot = path.join(os.tmpdir(), 'zerochat-android-junctions')
  const linkName = createHash('sha256').update(androidDir).digest('hex').slice(0, 16)
  const linkPath = path.join(linkRoot, linkName)

  try {
    mkdirSync(linkRoot, { recursive: true })

    if (existsSync(linkPath)) {
      const link = lstatSync(linkPath)

      if (link.isSymbolicLink()) {
        const target = readlinkSync(linkPath)

        if (path.resolve(target).toLowerCase() === path.resolve(androidDir).toLowerCase()) {
          return linkPath
        }
      }

      return androidDir
    }

    symlinkSync(androidDir, linkPath, 'junction')
    return linkPath
  } catch {
    return androidDir
  }
}

function removeEmptyLegacyResourceDirectories() {
  const legacyResourceDirectories = [
    path.join(androidDir, 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26'),
  ]

  for (const directory of legacyResourceDirectories) {
    if (!existsSync(directory) || !lstatSync(directory).isDirectory()) {
      continue
    }

    if (readdirSync(directory).length === 0) {
      rmdirSync(directory)
    }
  }
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  return spawnSync(probe, [command], { stdio: 'ignore' }).status === 0
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function readLockOwner(ownerPath) {
  try {
    return JSON.parse(readFileSync(ownerPath, 'utf8'))
  } catch {
    return null
  }
}

function acquireAndroidBuildLock() {
  const lockRoot = path.join(os.tmpdir(), 'zerochat-android-build-locks')
  const lockName = createHash('sha256').update(androidDir).digest('hex').slice(0, 16)
  const lockPath = path.join(lockRoot, lockName)
  const ownerPath = path.join(lockPath, 'owner.json')
  const staleLockMs = 30 * 60 * 1000
  const startedAt = Date.now()

  mkdirSync(lockRoot, { recursive: true })

  for (;;) {
    try {
      mkdirSync(lockPath)
      writeFileSync(
        ownerPath,
        JSON.stringify(
          {
            pid: process.pid,
            androidDir,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      )

      return {
        path: lockPath,
        release() {
          rmSync(lockPath, { recursive: true, force: true })
        },
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }

      const owner = readLockOwner(ownerPath)
      const ownerAgeMs = owner?.createdAt ? Date.now() - Date.parse(owner.createdAt) : Infinity
      const ownerIsAlive = isProcessAlive(owner?.pid)

      if (!ownerIsAlive || ownerAgeMs > staleLockMs) {
        rmSync(lockPath, { recursive: true, force: true })
        continue
      }

      if (Date.now() - startedAt > staleLockMs) {
        throw new Error(
          `Timed out waiting for Android Gradle execution lock held by pid ${owner.pid}.`,
        )
      }

      console.log(`Waiting for Android Gradle execution lock held by pid ${owner.pid}...`)
      sleepSync(1000)
    }
  }
}

function findJavaInDirectory(root) {
  if (!root || !existsSync(root)) {
    return null
  }

  const direct = path.join(root, 'bin', javaExecutable)

  if (existsSync(direct)) {
    return direct
  }

  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const nested = path.join(root, entry.name, 'bin', javaExecutable)

      if (existsSync(nested)) {
        return nested
      }
    }
  } catch {
    // Optional local tool caches may be unreadable.
  }

  return null
}

function firstExisting(candidates) {
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}

function javaHomeFromExecutable(executable) {
  return executable ? path.dirname(path.dirname(executable)) : null
}

function findAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' ? 'C:\\ZeroChatAndroidTools\\sdk' : undefined,
    path.join(repoRoot, '.codex-android-tools', 'sdk'),
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : undefined,
  ].filter(Boolean)

  return candidates.find((candidate) =>
    existsSync(path.join(candidate, 'platforms', 'android-36')),
  ) ?? null
}

const javaHomeExecutable = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', javaExecutable)
  : null
const discoveredJava = firstExisting([
  javaHomeExecutable,
  process.platform === 'win32' ? findJavaInDirectory('C:\\ZeroChatAndroidTools\\jdk17') : null,
  process.platform === 'win32' ? findJavaInDirectory('C:\\ZeroChatAndroidTools\\jdk') : null,
  findJavaInDirectory(path.join(repoRoot, '.codex-android-tools', 'jdk17')),
  findJavaInDirectory(path.join(repoRoot, '.codex-android-tools', 'jdk')),
])
const javaHome = process.env.JAVA_HOME ?? javaHomeFromExecutable(discoveredJava)
const androidSdk = findAndroidSdk()

if (!existsSync(gradleWrapper)) {
  console.error(`Missing Android Gradle Wrapper: ${gradleWrapper}`)
  process.exit(1)
}

if (!javaHome && !commandExists('java')) {
  console.error('JDK 17 was not found. Install it through Android Studio or put it under C:\\ZeroChatAndroidTools\\jdk17.')
  process.exit(1)
}

if (!androidSdk) {
  console.error('Android SDK Platform 36 was not found. Install it through Android Studio or set ANDROID_HOME.')
  process.exit(1)
}

const env = {
  ...process.env,
  ANDROID_HOME: process.env.ANDROID_HOME ?? androidSdk,
  ANDROID_SDK_ROOT: process.env.ANDROID_SDK_ROOT ?? androidSdk,
}

if (javaHome) {
  env.JAVA_HOME = javaHome
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  env[pathKey] = `${path.join(javaHome, 'bin')}${path.delimiter}${env[pathKey] ?? ''}`
}

const gradleArgs = process.argv.slice(2)
const requestedTasks = gradleArgs.length ? gradleArgs : ['assembleDebug']
removeEmptyLegacyResourceDirectories()
const assemblesDebugApk = requestedTasks.some((argument) => /(^|:)assembleDebug$/u.test(argument))
const sourceFingerprintBeforeBuild = assemblesDebugApk
  ? androidSourceFingerprint({ repoRoot })
  : null
const gradleCwd = androidExecutionDir()
const usesAsciiJunction = gradleCwd !== androidDir
const executionGradleWrapper = path.join(
  gradleCwd,
  process.platform === 'win32' ? 'gradlew.bat' : 'gradlew',
)
const stableJunctionArgs = usesAsciiJunction
  ? [
      '--no-daemon',
      '--no-build-cache',
      '--no-watch-fs',
      '-Pkotlin.compiler.execution.strategy=in-process',
    ]
  : []
const executionArgs = [...stableJunctionArgs, ...requestedTasks]

console.log(`Using JAVA_HOME=${env.JAVA_HOME ?? 'PATH java'}`)
console.log(`Using ANDROID_SDK_ROOT=${env.ANDROID_SDK_ROOT}`)
if (usesAsciiJunction) {
  console.log(`Using ASCII Gradle project path=${gradleCwd}`)
  console.log(
    'Using stable Gradle junction mode=--no-daemon --no-build-cache --no-watch-fs --in-process-kotlin',
  )
}
console.log(`Running Gradle task: ${requestedTasks.join(' ')}`)

const lock = acquireAndroidBuildLock()
console.log(`Using Android Gradle execution lock=${lock.path}`)

if (assemblesDebugApk) {
  rmSync(androidDebugApkBuildStampPath(repoRoot), { force: true })
}

let result
try {
  result = process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/c', executionGradleWrapper, ...executionArgs], {
        cwd: gradleCwd,
        env,
        stdio: 'inherit',
      })
    : spawnSync(executionGradleWrapper, executionArgs, {
        cwd: gradleCwd,
        env,
        stdio: 'inherit',
      })
} finally {
  lock.release()
}

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

if (result.status === 0 && sourceFingerprintBeforeBuild) {
  const sourceFingerprintAfterBuild = androidSourceFingerprint({ repoRoot })
  if (!sameAndroidSourceFingerprint(sourceFingerprintBeforeBuild, sourceFingerprintAfterBuild)) {
    console.error('Android packaged source changed during assembleDebug; the APK was not stamped. Rerun the build.')
    process.exit(1)
  }
  const stamp = writeAndroidDebugApkBuildStamp({
    repoRoot,
    sourceFingerprint: sourceFingerprintAfterBuild,
  })
  console.log(
    `Android debug APK source stamp written: ${stamp.sourceFingerprint.fileCount} files / ${stamp.sourceFingerprint.totalBytes} bytes / ${stamp.sourceFingerprint.sha256}`,
  )
}

process.exit(result.status ?? 1)
