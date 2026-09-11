import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  isProjectLocalBoundaryPath,
  projectLocalBoundaryGlob,
  projectLocalBoundaryRelativePath,
} from './project-local-boundary.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const failures = []
const boundaryRule = `/${projectLocalBoundaryRelativePath}/`

function readRepositoryFile(relativePath) {
  try {
    return readFileSync(path.join(root, relativePath), 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${relativePath}: ${error.message}`)
    return ''
  }
}

function requireText(relativePath, source, fragment, message) {
  if (!source.includes(fragment)) failures.push(message)
}

const gitignore = readRepositoryFile('.gitignore')
const packageSource = readRepositoryFile('package.json')

if ((gitignore.match(/^!\/\.local\/$/gmu) ?? []).length !== 1) {
  failures.push('.gitignore must contain exactly one root-level !/.local/ rule.')
}
if ((gitignore.match(/^\/\.local\/codex\/$/gmu) ?? []).length !== 1) {
  failures.push('.gitignore must contain exactly one root-level /.local/codex/ rule.')
}
const dockerBuildContextFiles = [
  'Dockerfile',
  'dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
].filter((relativePath) => existsSync(path.join(root, relativePath)))
if (dockerBuildContextFiles.length > 0) {
  const dockerignore = readRepositoryFile('.dockerignore')
  requireText(
    '.dockerignore',
    dockerignore,
    boundaryRule,
    `.dockerignore must exclude the project-local state boundary for Docker build contexts (${dockerBuildContextFiles.join(', ')}).`,
  )
}
requireText(
  'package.json',
  packageSource,
  '"check:project-local-boundary": "node scripts/project-local-boundary-check.mjs"',
  'package.json must expose the project-local boundary check.',
)

const sharedGlobConsumers = [
  ['eslint.config.js', "import { projectLocalBoundaryGlob } from './scripts/project-local-boundary.mjs'"],
  ['vitest.config.ts', "import { projectLocalBoundaryGlob } from './scripts/project-local-boundary.mjs'"],
]
for (const [relativePath, importStatement] of sharedGlobConsumers) {
  const source = readRepositoryFile(relativePath)
  requireText(
    relativePath,
    source,
    importStatement,
    `${relativePath} must consume the canonical project-local boundary module.`,
  )
  requireText(
    relativePath,
    source,
    'projectLocalBoundaryGlob',
    `${relativePath} must apply the canonical project-local boundary glob.`,
  )
}
const viteConfig = readRepositoryFile('vite.config.ts')
requireText(
  'vite.config.ts',
  viteConfig,
  'isProjectLocalBoundaryPath',
  'vite.config.ts must apply the canonical project-local boundary predicate to watcher paths.',
)
for (const relativePath of ['tsconfig.app.json', 'tsconfig.node.json']) {
  requireText(
    relativePath,
    readRepositoryFile(relativePath),
    `"${projectLocalBoundaryRelativePath}"`,
    `${relativePath} must exclude the project-local boundary from TypeScript discovery.`,
  )
}

const windowsLocalOutputFiles = [
  'scripts/build-windows.ps1',
  'scripts/package-windows-msix.ps1',
  'scripts/windows-webview-runtime-smoke.ps1',
  'scripts/windows-msix-trusted-install-update-qa.ps1',
  'apps/windows/ZeroChat/ZeroChat.vcxproj',
  '.github/workflows/ci.yml',
  '.github/workflows/windows-signed-msix.yml',
]
for (const relativePath of windowsLocalOutputFiles) {
  const source = readRepositoryFile(relativePath)
  if (!source.includes('.local\\codex\\artifacts\\windows-build')) {
    failures.push(`${relativePath} must keep Windows build output under .local/codex/artifacts/windows-build.`)
  }
  if (source.includes('C:\\ZeroChatWindowsBuild')) {
    failures.push(`${relativePath} must not write Windows build output to the external C:\\ZeroChatWindowsBuild path.`)
  }
}
requireText(
  'scripts/build-windows.ps1',
  readRepositoryFile('scripts/build-windows.ps1'),
  'function Get-AsciiBuildRoot',
  'scripts/build-windows.ps1 must use a temporary ASCII mapping for non-ASCII project paths.',
)
requireText(
  'scripts/build-windows.ps1',
  readRepositoryFile('scripts/build-windows.ps1'),
  'finally',
  'scripts/build-windows.ps1 must remove any temporary ASCII mapping in finally.',
)
requireText(
  'scripts/runtime-smoke-artifact-check.mjs',
  readRepositoryFile('scripts/runtime-smoke-artifact-check.mjs'),
  'readProjectLocalArtifactManifest',
  'runtime smoke must validate explicit WebView artifact roots through the bounded project-local resolver.',
)
const signedWorkflow = readRepositoryFile('.github/workflows/windows-signed-msix.yml')
if (signedWorkflow.includes('RUNNER_TEMP') || !signedWorkflow.includes('.local\\codex\\private')) {
  failures.push('Windows signed MSIX workflow must keep the temporary signing certificate under .local/codex/private and clean it there.')
}

const androidGradleBoundary = readRepositoryFile('scripts/android-gradle-local-boundary.mjs')
const androidBuild = readRepositoryFile('scripts/android-debug-build.mjs')
requireText(
  'scripts/android-gradle-local-boundary.mjs',
  androidGradleBoundary,
  "gradleUserHome: path.join(localRoot, 'private', 'gradle-home')",
  'Android Gradle local boundary must derive GRADLE_USER_HOME under .local/codex/private/gradle-home.',
)
requireText(
  'scripts/android-gradle-local-boundary.mjs',
  androidGradleBoundary,
  'GRADLE_USER_HOME: paths.gradleUserHome',
  'Android Gradle child environment must bind GRADLE_USER_HOME to the project-local path.',
)
requireText(
  'scripts/android-debug-build.mjs',
  androidBuild,
  'androidGradleChildEnvironment({ repoRoot })',
  'Android Gradle builds must execute with the project-local child environment.',
)
if (androidBuild.includes('os.tmpdir()')) {
  failures.push('Android Gradle build paths must not resolve through the process or user global temp directory.')
}

const workflowsRoot = path.join(root, '.github', 'workflows')
for (const entry of readdirSync(workflowsRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !/\.ya?ml$/iu.test(entry.name)) continue
  const relativePath = path.join('.github', 'workflows', entry.name)
  const source = readRepositoryFile(relativePath)
  if (source.includes('actions/checkout@v4')) {
    requireText(
      relativePath,
      source,
      'pnpm run check:project-local-boundary',
      `${relativePath} must run the project-local boundary check after checkout/install.`,
    )
  }
}

try {
  const tracked = execFileSync('git', ['ls-files', '-z'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  })
    .split('\0')
    .filter(Boolean)
  const leakedTrackedPaths = tracked.filter((file) => isProjectLocalBoundaryPath(file))
  if (leakedTrackedPaths.length > 0) {
    failures.push(
      `Project-local boundary must never be tracked: ${leakedTrackedPaths.join(', ')}`,
    )
  }
} catch (error) {
  failures.push(`Unable to inspect tracked paths: ${error.message}`)
}

if (failures.length > 0) {
  throw new Error(`Project-local boundary check failed:\n- ${failures.join('\n- ')}`)
}

console.log(`Project-local boundary check passed: ${projectLocalBoundaryGlob}`)
