import { readFile, stat } from 'node:fs/promises'

const failures = []

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    failures.push(`Missing ${path}: ${error.message}`)
    return ''
  }
}

async function fileExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function pngDimensions(buffer) {
  const pngSignature = '89504e470d0a1a0a'
  if (
    buffer.length < 24 ||
    buffer.subarray(0, 8).toString('hex') !== pngSignature ||
    buffer.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    return null
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  }
}

async function assertPngSize(path, width, height) {
  try {
    const size = pngDimensions(await readFile(path))
    expect(Boolean(size), `${path} must be a valid PNG icon asset.`)
    if (!size) return

    expect(
      size.width === width && size.height === height,
      `${path} must be ${width}x${height}, got ${size.width}x${size.height}.`,
    )
  } catch (error) {
    failures.push(`Unable to inspect PNG icon ${path}: ${error.message}`)
  }
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

function hasStandaloneNpmCommand(text, command) {
  return new RegExp(`(^|[^p])${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(text)
}

function extractSupportedLocales(source) {
  const match = source.match(/const supportedLocales:\s*Locale\[\]\s*=\s*\[([\s\S]*?)\]/)

  if (!match) {
    failures.push('Unable to find supportedLocales in src/i18n.ts.')
    return []
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

function localizedGuidePaths(base, locales) {
  return locales.map((locale) => {
    const suffix = locale ? `.${locale}` : ''
    return `docs/${base}${suffix}.md`
  })
}

const [
  packageJsonText,
  viteConfig,
  sourceMain,
  sourceI18n,
  sourceServiceWorkerRegistration,
  serviceWorker,
  serviceWorkerSource,
  serviceWorkerBuilder,
  webProductionBuild,
  webProductionBuildTest,
  serviceWorkerFinalizer,
  distServiceWorker,
  startupShellSource,
  sourceHeaders,
  manifestText,
  distHeaders,
  sourceIndex,
  distIndex,
  workflow,
  ciWorkflow,
  liveDrillsWorkflow,
  signedMsixWorkflow,
  readme,
  docsIndex,
  verifyGate,
  deployCloudflarePages,
  pwaOfflineSmoke,
] = await Promise.all([
  readText('package.json'),
  readText('vite.config.ts'),
  readText('src/app/bootstrap.tsx'),
  readText('src/i18n.ts'),
  readText('src/services/serviceWorkerRegistration.ts'),
  readText('public/sw.js'),
  readText('scripts/service-worker-source.js'),
  readText('scripts/build-service-worker.mjs'),
  readText('scripts/web-production-build.mjs'),
  readText('scripts/__tests__/web-production-build.test.mjs'),
  readText('scripts/service-worker-finalize.mjs'),
  readText('dist/sw.js'),
  readText('src/app/startupShell.ts'),
  readText('public/_headers'),
  readText('dist/manifest.webmanifest'),
  readText('dist/_headers'),
  readText('index.html'),
  readText('dist/index.html'),
  readText('.github/workflows/pages.yml'),
  readText('.github/workflows/ci.yml'),
  readText('.github/workflows/live-drills.yml'),
  readText('.github/workflows/windows-signed-msix.yml'),
  readText('README.md'),
  readText('docs/README.md'),
  readText('scripts/verify-release.mjs'),
  readText('scripts/deploy-cloudflare-pages.mjs'),
  readText('scripts/pwa-offline-smoke.mjs'),
])

const appLocales = extractSupportedLocales(sourceI18n)
const docLocales = ['', ...appLocales.filter((locale) => locale !== 'en-US')]
const deploymentGuidePaths = localizedGuidePaths('DEPLOY_WEB', docLocales)
const syncGuidePaths = localizedGuidePaths('SYNC_SETUP', docLocales)

const deploymentGuideTexts = await Promise.all(deploymentGuidePaths.map(readText))
const deploymentGuides = new Map(
  deploymentGuidePaths.map((guidePath, index) => [
    guidePath,
    deploymentGuideTexts[index],
  ]),
)
const deploymentGuideRequiredCopy = new Map([
  [
    'docs/DEPLOY_WEB.md',
    [
      'do not deploy the Web app. Configure GitHub Gist or Cloudflare',
      'It is not needed for sync setup',
      'GitHub Pages hosts the Web app. GitHub Gist is the separate GitHub feature',
      'If you are unsure, choose the Cloudflare Pages dashboard path',
    ],
  ],
  [
    'docs/DEPLOY_WEB.zh-CN.md',
    [
      '只想让多设备同步，就不要部署网页',
      '配置同步不需要碰 `dist/`',
      'GitHub Pages 是“托管网页”；GitHub Gist 是“加密同步”用的另一个 GitHub 功能',
      '拿不准时，先选 Cloudflare Pages 控制台',
    ],
  ],
  [
    'docs/DEPLOY_WEB.es-ES.md',
    [
      'no despliegues la Web. Configura GitHub Gist o Cloudflare',
      'No se necesita para configurar la sincronizacion',
      'GitHub Pages aloja la Web. GitHub Gist es la funcion separada',
      'Si dudas, elige el panel de Cloudflare Pages',
    ],
  ],
  [
    'docs/DEPLOY_WEB.hi-IN.md',
    [
      'Web app deploy न करें',
      'Sync setup के लिए इसकी जरूरत नहीं है',
      'GitHub Pages Web app host करता है। GitHub Gist',
      'Cloudflare Pages dashboard चुनें',
    ],
  ],
  [
    'docs/DEPLOY_WEB.ar-SA.md',
    [
      'فلا تنشر تطبيق الويب. اضبط GitHub Gist أو Cloudflare',
      'لا تحتاجه لإعداد المزامنة',
      'GitHub Pages يستضيف تطبيق الويب. GitHub Gist',
      'اختر لوحة Cloudflare Pages',
    ],
  ],
  [
    'docs/DEPLOY_WEB.pt-BR.md',
    [
      'não implante a Web. Configure GitHub Gist ou Cloudflare',
      'não é necessária para configurar sincronização',
      'GitHub Pages hospeda o app Web. GitHub Gist',
      'escolha o painel do Cloudflare Pages',
    ],
  ],
  [
    'docs/DEPLOY_WEB.ru-RU.md',
    [
      'Web app развертывать не нужно. Настройте GitHub Gist или Cloudflare',
      'Для настройки синхронизации он не нужен',
      'GitHub Pages размещает Web app. GitHub Gist',
      'выберите панель Cloudflare Pages',
    ],
  ],
  [
    'docs/DEPLOY_WEB.ja-JP.md',
    [
      'Web app を deploy する必要はありません。ZeroChat の設定 > 同期',
      'Sync setup には不要です',
      'GitHub Pages は Web app をホストします。GitHub Gist',
      'Cloudflare Pages dashboard を選んでください',
    ],
  ],
  [
    'docs/DEPLOY_WEB.ko-KR.md',
    [
      'Web app을 deploy하지 않아도 됩니다. 대신 ZeroChat의 설정 > 동기화',
      'Sync 설정에는 필요하지 않습니다',
      'GitHub Pages는 Web app을 호스팅합니다. GitHub Gist',
      'Cloudflare Pages 대시보드를 선택하세요',
    ],
  ],
  [
    'docs/DEPLOY_WEB.fr-FR.md',
    [
      'ne deployeez pas la Web. Configurez GitHub Gist ou Cloudflare',
      "Elle n'est pas necessaire pour configurer la synchronisation",
      "GitHub Pages heberge l'app Web. GitHub Gist est la fonction separee",
      'choisissez le tableau de bord Cloudflare Pages',
    ],
  ],
])
const syncGuideTexts = await Promise.all(syncGuidePaths.map(readText))
const syncGuides = new Map(
  syncGuidePaths.map((guidePath, index) => [guidePath, syncGuideTexts[index]]),
)
const localizedSyncGuideBlockedCopy = new Map([
  [
    'docs/SYNC_SETUP.zh-CN.md',
    ['GitHub Token', '细粒度 Token'],
  ],
  ['docs/SYNC_SETUP.es-ES.md', ['GitHub Token']],
  ['docs/SYNC_SETUP.hi-IN.md', ['GitHub Token']],
  ['docs/SYNC_SETUP.ar-SA.md', ['GitHub Token']],
  ['docs/SYNC_SETUP.pt-BR.md', ['GitHub Token']],
  ['docs/SYNC_SETUP.ru-RU.md', ['GitHub Token']],
  ['docs/SYNC_SETUP.ja-JP.md', ['GitHub Token']],
  ['docs/SYNC_SETUP.ko-KR.md', ['GitHub Token']],
  ['docs/SYNC_SETUP.fr-FR.md', ['GitHub Token']],
])

const packageJson = packageJsonText ? JSON.parse(packageJsonText) : { scripts: {} }
const manifest = manifestText ? JSON.parse(manifestText) : {}
const iconSources = new Set(manifest.icons?.map((icon) => icon.src))
const webBuildServiceWorkerIndex = webProductionBuild.indexOf("['Service Worker source build'")
const webBuildTypeScriptIndex = webProductionBuild.indexOf("['TypeScript'")
const webBuildViteIndex = webProductionBuild.indexOf("['Vite production build'")

expect(
  packageJson.scripts?.['deploy:cf'] === 'node scripts/deploy-cloudflare-pages.mjs' &&
    deployCloudflarePages.includes("'wrangler@latest', 'pages', 'deploy', 'dist'") &&
    deployCloudflarePages.includes("from './web-production-build.mjs'") &&
    deployCloudflarePages.includes('await runWebProductionBuild()') &&
    !deployCloudflarePages.includes("fromRoot('node_modules/typescript/bin/tsc')") &&
    !deployCloudflarePages.includes("fromRoot('node_modules/vite/bin/vite.js')") &&
    webBuildServiceWorkerIndex >= 0 &&
    webBuildServiceWorkerIndex < webBuildTypeScriptIndex &&
    webBuildTypeScriptIndex < webBuildViteIndex &&
    webProductionBuildTest.includes('runs Service Worker generation and reachability before Vite') &&
    deployCloudflarePages.includes('printHelp()') &&
    deployCloudflarePages.includes("userArgs.includes('--dry-run')") &&
    deployCloudflarePages.includes("userArgs.includes('--skip-build')") &&
    deployCloudflarePages.includes("!['--', '--dry-run', '--skip-build', '--help', '-h'].includes(arg)") &&
    deployCloudflarePages.includes('--skip-build is only allowed with --dry-run') &&
    deployCloudflarePages.includes('Missing dist/index.html') &&
    deployCloudflarePages.includes('Skipping local build; using existing dist/ for dry-run.') &&
    deployCloudflarePages.includes('Dry run: build succeeded and upload was skipped.') &&
    deployCloudflarePages.includes('commandAvailable') &&
    deployCloudflarePages.includes('npx was not found on PATH') &&
    deployCloudflarePages.includes('...extraArgs'),
  'package.json must keep a package-manager-neutral one-command Cloudflare Pages deploy script that reuses the canonical Service Worker/TypeScript/Vite build, with help, guarded dry-run skip-build, PATH guidance, and Wrangler argument passthrough.',
)
expect(
  !packageJson.scripts?.['deploy:cf']?.includes('--project-name') &&
    !deployCloudflarePages.includes('--project-name'),
  'Cloudflare Pages deploy script should let first-time users choose or create a project interactively.',
)
expect(
  deploymentGuides.get('docs/DEPLOY_WEB.md')?.includes('pnpm run deploy:cf -- --dry-run') &&
    deploymentGuides
      .get('docs/DEPLOY_WEB.zh-CN.md')
      ?.includes('pnpm run deploy:cf -- --dry-run') &&
    readme.includes('pnpm run deploy:cf -- --dry-run'),
  'Beginner Web deployment docs and README must mention the non-uploading Cloudflare Pages deploy dry-run.',
)
expect(
  packageJson.scripts?.verify === 'node scripts/verify-release.mjs' &&
    verifyGate.includes('deploy-readiness-check.mjs') &&
    verifyGate.includes('deploy-cloudflare-pages.mjs') &&
    verifyGate.includes("'--dry-run'") &&
    verifyGate.includes("'--skip-build'"),
  'package.json verify script must run the deployment readiness check through the shared release gate.',
)
expect(
  packageJson.scripts?.['verify:release'] ===
    'node scripts/verify-release.mjs --release' &&
    verifyGate.includes('browser-skill-smoke.mjs') &&
    verifyGate.includes('locale-runtime-smoke.mjs') &&
    verifyGate.includes('settings-overlay-preload-smoke.mjs') &&
    verifyGate.includes('pwa-offline-smoke.mjs') &&
    verifyGate.includes('visual-audit.mjs'),
  'package.json must keep a one-command release verification script that includes browser, locale runtime, Settings preload, PWA offline, and visual audit checks without nested package-manager calls.',
)
expect(
  viteConfig.includes("base: './'"),
  'vite.config.ts must use relative base paths for GitHub Pages project URLs.',
)
expect(
  viteConfig.includes('**/.zerochat-*/**'),
  'vite.config.ts should ignore local browser QA profiles during development.',
)
expect(
  sourceMain.includes("from '../services/serviceWorkerRegistration'") &&
    sourceMain.includes('installServiceWorkerRegistration()') &&
    sourceServiceWorkerRegistration.includes('baseUrl = import.meta.env.BASE_URL') &&
    sourceServiceWorkerRegistration.includes('register(`${baseUrl}sw.js`)'),
  'Service worker registration must use the Vite base URL.',
)
expect(
  serviceWorkerSource.includes('self.registration.scope') &&
    serviceWorkerSource.includes('indexUrl') &&
    serviceWorkerSource.includes('shellUrl'),
  'Service worker cache URLs must be based on the registered scope.',
)
expect(
  serviceWorkerSource.includes("const CACHE_PREFIX = 'zerochat-shell-'") &&
    serviceWorkerSource.includes('__ZEROCHAT_CACHE_VERSION__') &&
    serviceWorkerSource.includes('__ZEROCHAT_STATIC_ASSET_PATHS__') &&
    serviceWorkerSource.includes('const MAX_CACHE_ENTRIES = 64') &&
    serviceWorkerSource.includes("style|worker") &&
    serviceWorkerSource.includes('async function matchVersionedAsset(request)') &&
    serviceWorkerSource.includes('async function pruneRuntimeCache(cache)') &&
    serviceWorkerSource.includes('function staleWhileRevalidate(event, request)') &&
    serviceWorkerSource.includes('cache.addAll(staticAssetUrls)') &&
    serviceWorkerSource.includes('.at(-1)') &&
    serviceWorkerSource.includes("'ZeroChat cache failed.'") &&
    serviceWorkerSource.includes('function reportServiceWorkerCacheFailure(operation)') &&
    !serviceWorkerSource.includes('function reportServiceWorkerCacheFailure(operation, error)') &&
    !serviceWorkerSource.includes('error.name') &&
    !serviceWorkerSource.includes('error.message') &&
    !serviceWorkerSource.includes('error.stack') &&
    serviceWorkerSource.includes('function reportServiceWorkerCacheFailure') &&
    serviceWorkerSource.includes("reportServiceWorkerCacheFailure('install-shell')") &&
    serviceWorkerSource.includes("reportServiceWorkerCacheFailure('runtime-cache')") &&
    !serviceWorkerSource.includes('catch(() => {})') &&
    serviceWorkerBuilder.includes("input: 'scripts/service-worker-source.js'") &&
    serviceWorkerBuilder.includes("minify: 'oxc'") &&
    serviceWorkerBuilder.includes("process.argv.includes('--check')") &&
    viteConfig.includes("from './scripts/service-worker-finalize.mjs'") &&
    viteConfig.includes('finalizeServiceWorkerBuild(outDir)') &&
    serviceWorkerFinalizer.includes("new Set(['sw.js', '_headers'])") &&
    serviceWorkerFinalizer.includes("createHash('sha256')") &&
    serviceWorkerFinalizer.includes('hash.update(serviceWorkerTemplate)') &&
    serviceWorkerFinalizer.includes('placeholder must appear exactly once') &&
    !distServiceWorker.includes('__ZEROCHAT_CACHE_VERSION__') &&
    !distServiceWorker.includes('__ZEROCHAT_STATIC_ASSET_PATHS__') &&
    Buffer.byteLength(serviceWorker) <= 2_500 &&
    packageJson.scripts.build === 'node scripts/web-production-build.mjs' &&
    webProductionBuild.includes('export async function runWebProductionBuild') &&
    webBuildServiceWorkerIndex >= 0 &&
    webBuildServiceWorkerIndex < webBuildTypeScriptIndex &&
    webBuildTypeScriptIndex < webBuildViteIndex &&
    verifyGate.includes("['Service Worker source build', [fromRoot('scripts/build-service-worker.mjs')]]") &&
    pwaOfflineSmoke.includes('zerochat-stale-cache') &&
    pwaOfflineSmoke.includes('collectStaticAssetPaths') &&
    pwaOfflineSmoke.includes('missingUrls') &&
    pwaOfflineSmoke.includes('markdownWorkerRenderedRichText') &&
    pwaOfflineSmoke.includes('cachePruneState.count <= 64'),
  'PWA service worker must atomically pre-cache the complete versioned build, retain one prior ZeroChat cache, support offline Worker/lazy chunks, use stale-while-revalidate for hashed/runtime assets, bound runtime entries, and keep cache failures sanitized.',
)
expect(
  manifest.start_url === '.' &&
    manifest.id === '.' &&
    (manifest.scope === undefined || manifest.scope === '.') &&
    manifest.display === 'standalone' &&
    manifest.background_color?.toLowerCase() === '#fafbfc' &&
    manifest.theme_color?.toLowerCase() === '#6366f1' &&
    (manifest.prefer_related_applications === undefined ||
      manifest.prefer_related_applications === false) &&
    iconSources.has('favicon.svg') &&
    iconSources.has('icon-192.png') &&
    iconSources.has('icon-512.png') &&
    manifest.icons?.every((icon) => typeof icon.src === 'string' && !icon.src.startsWith('/')),
  'Web manifest must be installable, PRD-branded, and portable to subpath hosting.',
)
expect(
  sourceIndex.includes('rel="apple-touch-icon"') &&
    sourceIndex.includes('./icon-180.png') &&
    sourceIndex.includes('<script type="module" src="/src/app/bootstrap.tsx"></script>') &&
    startupShellSource.includes('function browserLanguages()') &&
    startupShellSource.includes('resolveStartupLocale(') &&
    startupShellSource.includes("doc.querySelector<HTMLElement>('[data-initial-loading]')") &&
    serviceWorkerFinalizer.includes('collectStaticAssetPaths(outDir)') &&
    serviceWorkerFinalizer.includes("new Set(['sw.js', '_headers'])"),
  'PWA shell must expose touch/install icons and include them with the external startup bootstrap in the finalized complete static cache.',
)
expect(
  distIndex.includes('./assets/') &&
    !distIndex.includes('/src/app/bootstrap.tsx') &&
    distIndex.includes('./manifest.webmanifest') &&
    distIndex.includes('./favicon.svg') &&
    distIndex.includes('./icon-180.png'),
  'dist/index.html must reference built assets and PWA files relatively.',
)
expect(
  !/(?:src|href)="\/(?!\/)/.test(distIndex),
  'dist/index.html must not contain root-relative local asset URLs.',
)
expect(
  !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(sourceIndex) &&
    !/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i.test(distIndex),
  'Web/PWA index.html must not contain inline script so a strict CSP can disallow inline scripts.',
)
expect(
  sourceHeaders.includes("Content-Security-Policy: default-src 'self'") &&
    sourceHeaders.includes("script-src 'self'") &&
    sourceHeaders.includes("connect-src 'self' https: wss:") &&
    sourceHeaders.includes("object-src 'none'") &&
    sourceHeaders.includes("frame-ancestors 'none'") &&
    distHeaders.includes("connect-src 'self' https: wss:") &&
    distHeaders.includes("script-src 'self'") &&
    !/script-src[^;]*unsafe-inline/.test(sourceHeaders) &&
    !/script-src-attr[^;]*unsafe-inline/.test(sourceHeaders) &&
    !sourceHeaders.includes('connect-src *'),
  'Production static headers must ship a strict Web CSP that forbids inline scripts and limits connect-src to self plus secure remote protocols.',
)
for (const [path, width, height] of [
  ['public/icon-180.png', 180, 180],
  ['public/icon-192.png', 192, 192],
  ['public/icon-512.png', 512, 512],
  ['dist/icon-180.png', 180, 180],
  ['dist/icon-192.png', 192, 192],
  ['dist/icon-512.png', 512, 512],
]) {
  expect(await fileExists(path), `PWA install icon is missing: ${path}`)
  await assertPngSize(path, width, height)
}
expect(
  workflow.includes('branches: [main, master]') &&
    workflow.includes('pnpm/action-setup@v4') &&
    workflow.includes('version: 11.13.1') &&
    workflow.includes('cache: pnpm') &&
    workflow.includes('cache-dependency-path: pnpm-lock.yaml') &&
    workflow.includes('pnpm install --frozen-lockfile') &&
    workflow.includes('timeout-minutes: 35') &&
    workflow.includes('pnpm run verify:web-local') &&
    workflow.includes('actions/upload-artifact@v4') &&
    workflow.includes('actions/upload-pages-artifact@v4') &&
    workflow.includes('actions/deploy-pages') &&
    workflow.includes('path: dist'),
  'GitHub Pages workflow must run the clean-checkout Web/PWA evidence gate, upload visual screenshots, and deploy dist from main or master.',
)
expect(
  ciWorkflow.includes('pull_request') &&
    ciWorkflow.includes('pnpm/action-setup@v4') &&
    ciWorkflow.includes('version: 11.13.1') &&
    ciWorkflow.includes('cache: pnpm') &&
    ciWorkflow.includes('cache-dependency-path: pnpm-lock.yaml') &&
    ciWorkflow.includes('pnpm install --frozen-lockfile') &&
    ciWorkflow.includes('timeout-minutes: 35') &&
    ciWorkflow.includes('pnpm run verify:web-local') &&
    ciWorkflow.includes('actions/upload-artifact@v4'),
  'CI workflow must run the clean-checkout Web/PWA evidence gate and upload visual screenshots on pull requests.',
)
expect(
  liveDrillsWorkflow.includes('workflow_dispatch:') &&
    liveDrillsWorkflow.includes('pnpm/action-setup@v4') &&
    liveDrillsWorkflow.includes('version: 11.13.1') &&
    liveDrillsWorkflow.includes('cache: pnpm') &&
    liveDrillsWorkflow.includes('cache-dependency-path: pnpm-lock.yaml') &&
    liveDrillsWorkflow.includes('pnpm install --frozen-lockfile') &&
    liveDrillsWorkflow.includes('provider_smoke:') &&
    liveDrillsWorkflow.includes('sync_mode:') &&
    liveDrillsWorkflow.includes('node scripts/live-provider-smoke-check.mjs') &&
    liveDrillsWorkflow.includes('node scripts/live-sync-release-drill-check.mjs') &&
    liveDrillsWorkflow.includes('secrets.ZEROCHAT_LIVE_PROVIDER_API_KEY') &&
    liveDrillsWorkflow.includes('secrets.ZEROCHAT_LIVE_SYNC_PASSPHRASE') &&
    liveDrillsWorkflow.includes('ZEROCHAT_LIVE_PROVIDER_CONFIRM: SEND_ONE_TEST_MESSAGE') &&
    liveDrillsWorkflow.includes('ZEROCHAT_LIVE_SYNC_CONFIRM: DELETE_REMOTE_ZEROCHAT_TEST_DATA') &&
    liveDrillsWorkflow.includes('name: live-sync-release-drill-report') &&
    liveDrillsWorkflow.includes('.manual-qa/live-sync-release-drill.json'),
  'Live drills workflow must remain manual-only, install with pnpm, use disposable GitHub Secrets plus explicit confirmations, and upload live sync drill evidence.',
)
expect(
  signedMsixWorkflow.includes('workflow_dispatch:') &&
  signedMsixWorkflow.includes('runs-on: windows-latest') &&
    signedMsixWorkflow.includes('pnpm/action-setup@v4') &&
    signedMsixWorkflow.includes('version: 11.13.1') &&
    signedMsixWorkflow.includes('cache: pnpm') &&
    signedMsixWorkflow.includes('cache-dependency-path: pnpm-lock.yaml') &&
    signedMsixWorkflow.includes('pnpm install --frozen-lockfile') &&
    signedMsixWorkflow.includes('WINDOWS_SIGNING_PFX_BASE64') &&
    signedMsixWorkflow.includes('secrets.WINDOWS_SIGNING_PFX_BASE64') &&
    signedMsixWorkflow.includes('pnpm run check:windows-shell') &&
    signedMsixWorkflow.includes('pnpm run check:windows-msix') &&
    signedMsixWorkflow.includes('.\\scripts\\build-windows.ps1 -Configuration Release -SkipWebBuild -MsixReady') &&
    signedMsixWorkflow.includes('.\\scripts\\package-windows-msix.ps1 @signArgs') &&
    signedMsixWorkflow.includes('.\\scripts\\windows-msix-install-qa.ps1') &&
    signedMsixWorkflow.includes('Remove temporary signing certificate') &&
    signedMsixWorkflow.includes('Test-Path -LiteralPath $certificatePath') &&
    signedMsixWorkflow.includes('windows-signed-msix') &&
    signedMsixWorkflow.includes('if-no-files-found: error') &&
    !signedMsixWorkflow.includes('-Install') &&
    !signedMsixWorkflow.includes('-TrustCertificate'),
  'Windows signed MSIX workflow must be manual, secret-backed, non-installing, and artifact-producing.',
)
expect(
  ciWorkflow.includes('windows-native:') &&
    ciWorkflow.includes('runs-on: windows-latest') &&
    ciWorkflow.includes('microsoft/setup-msbuild@v2') &&
    ciWorkflow.includes('node scripts\\native-build-prereq-check.mjs --platform=windows') &&
    ciWorkflow.includes('.\\scripts\\build-windows.ps1 -Configuration Release -SkipWebBuild -MsixReady') &&
    ciWorkflow.includes('.\\scripts\\package-windows-msix.ps1 -BuildRoot .local\\zerochat\\artifacts\\windows-build -Configuration Release -Platform x64') &&
    ciWorkflow.includes('.\\scripts\\windows-msix-install-qa.ps1') &&
    ciWorkflow.includes('windows-release-shell'),
  'CI workflow must keep a Windows native Release build, unsigned MSIX packaging dry-run, and artifact upload.',
)
expect(
  ciWorkflow.includes('android-native:') &&
    ciWorkflow.includes('actions/setup-java@v4') &&
    ciWorkflow.includes('android-actions/setup-android@v3') &&
    ciWorkflow.includes('sdkmanager "platforms;android-36" "build-tools;36.0.0"') &&
    ciWorkflow.includes('node scripts/native-build-prereq-check.mjs --platform=android') &&
    ciWorkflow.includes('node scripts/android-debug-build.mjs') &&
    ciWorkflow.includes('android-debug-apk'),
  'CI workflow must keep an Android SDK 36 debug APK build and artifact upload.',
)
expect(
  ciWorkflow.includes('linux-native:') &&
    ciWorkflow.includes('dtolnay/rust-toolchain@stable') &&
    ciWorkflow.includes('pkg-config libgtk-4-dev libadwaita-1-dev') &&
    ciWorkflow.includes('node scripts/native-build-prereq-check.mjs --platform=linux') &&
    ciWorkflow.includes('cargo check --manifest-path apps/linux/Cargo.toml --locked') &&
    ciWorkflow.includes('pnpm run build:linux:release') &&
    ciWorkflow.includes('bash scripts/linux-runtime-smoke.sh apps/linux/target/release/zerochat-linux') &&
    ciWorkflow.includes('linux-release-binary-and-runtime-smoke') &&
    ciWorkflow.includes('.manual-qa/linux-runtime-smoke.png'),
  'CI workflow must keep a Linux GTK/libadwaita prerequisite check, locked cargo check, release build, Xvfb runtime smoke, and artifact upload.',
)
expect(
    ciWorkflow.includes('apple-core:') &&
    ciWorkflow.includes('runs-on: macos-latest') &&
    ciWorkflow.includes('node scripts/native-build-prereq-check.mjs --platform=apple') &&
    ciWorkflow.includes('pnpm run build:apple:debug') &&
    ciWorkflow.includes('bash scripts/apple-runtime-smoke.sh .manual-qa/apple-derived-data/Build/Products/Debug/ZeroChat.app') &&
    ciWorkflow.includes('apple-runtime-smoke') &&
    ciWorkflow.includes('.manual-qa/apple-runtime-smoke.png'),
  'CI workflow must keep the Apple prerequisite, package-script debug build, macOS runtime screenshot smoke, and artifact upload.',
)

for (const guidePath of deploymentGuidePaths) {
  const guide = deploymentGuides.get(guidePath) ?? ''
  const guideName = guidePath.split('/').at(-1)

  expect(
      guide.includes('pnpm run deploy:cf') &&
      guide.includes('pnpm install') &&
      guide.includes('pnpm run deploy:cf -- --dry-run') &&
      guide.includes('pnpm run verify:release') &&
      guide.includes('pnpm run verify:web-local') &&
      !hasStandaloneNpmCommand(guide, 'npm install') &&
      !hasStandaloneNpmCommand(guide, 'npm run build') &&
      !hasStandaloneNpmCommand(guide, 'npm run deploy:cf') &&
      !hasStandaloneNpmCommand(guide, 'npm run verify:release') &&
      !guide.includes('Alternative Build command') &&
      !guide.includes('npm run check:browser-smoke') &&
      guide.includes('pnpm run build') &&
      guide.includes('Build command: pnpm run build') &&
      !guide.includes('or: pnpm run build') &&
      guide.includes('dist') &&
      guide.includes('Build output directory / Build directory: dist') &&
      guide.includes('GitHub Actions') &&
      guide.includes('Cloudflare Pages') &&
      guide.includes('GitHub Pages') &&
      guide.includes('GitHub Gist') &&
      guide.includes('public/_headers') &&
      guide.includes('CSP') &&
      !guide.includes('Node/npm') &&
      !/\boode\b/i.test(guide) &&
      guide.includes('.visual-audit/'),
    `${guidePath} must keep simple pnpm-first Cloudflare/GitHub deployment steps, include the dry-run, distinguish local verify:release from hosted verify:web-local evidence, avoid duplicate npm command paths in the beginner flow, distinguish GitHub Pages from Gist sync, explain when local Node/pnpm is unnecessary without broken tool names, document the strict CSP public/_headers hosting boundary, and include visual audit guidance.`,
  )
  expect(
    docsIndex.includes(`[${guideName}](${guideName})`),
    `docs/README.md must link ${guideName}.`,
  )

  for (const requiredCopy of deploymentGuideRequiredCopy.get(guidePath) ?? []) {
    expect(
      guide.includes(requiredCopy),
      `${guidePath} must keep the beginner Web deployment vs sync distinction: ${requiredCopy}`,
    )
  }
}

for (const guidePath of syncGuidePaths) {
  const guide = syncGuides.get(guidePath) ?? ''
  const guideName = guidePath.split('/').at(-1)

  expect(
    guide.includes('GitHub Gist') &&
      guide.includes('Cloudflare Worker') &&
      guide.includes('ZEROCHAT_ACCESS_KEY') &&
      guide.includes('zerochat_kv') &&
      guide.includes('zerochat_r2'),
    `${guidePath} must cover Gist, Worker, KV/R2, and the derived access key.`,
  )
  expect(
    docsIndex.includes(`[${guideName}](${guideName})`),
    `docs/README.md must link ${guideName}.`,
  )

  if (!['docs/SYNC_SETUP.md', 'docs/SYNC_SETUP.zh-CN.md'].includes(guidePath)) {
    expect(
      !guide.includes('This localized file intentionally') &&
        !guide.includes('## Modes') &&
        !guide.includes('## Passwords and Keys') &&
        !guide.includes('Security Checklist'),
      `${guidePath} must be localized instead of keeping the English placeholder sync guide.`,
    )
  }

  for (const blockedCopy of localizedSyncGuideBlockedCopy.get(guidePath) ?? []) {
    expect(
      !guide.includes(blockedCopy),
      `${guidePath} must keep GitHub token wording localized: ${blockedCopy}`,
    )
  }
}

expect(
  deploymentGuides
    .get('docs/DEPLOY_WEB.md')
    ?.includes('Web deployment and the cloud sync Worker are separate'),
  'English beginner deployment guide must separate Web deploy from sync Worker setup.',
)
expect(
  deploymentGuides
    .get('docs/DEPLOY_WEB.md')
    ?.includes('If you are unsure, choose the Cloudflare Pages dashboard path'),
  'English beginner deployment guide must recommend the no-terminal Cloudflare Pages dashboard path when users are unsure.',
)
expect(
  deploymentGuides
    .get('docs/DEPLOY_WEB.md')
    ?.includes('It is not needed for sync setup') &&
    deploymentGuides
      .get('docs/DEPLOY_WEB.md')
      ?.includes('do not deploy the Web app. Configure GitHub Gist or Cloudflare'),
  'English beginner deployment guide must make clear that sync setup does not need dist or Web hosting.',
)
expect(
  deploymentGuides
    .get('docs/DEPLOY_WEB.md')
    ?.includes('For strict browser CSP, use Cloudflare Pages, Netlify, or another static host that applies `public/_headers`; GitHub Pages does not apply custom headers.'),
  'English beginner deployment guide must warn that strict CSP requires a host that applies public/_headers.',
)
expect(
  deploymentGuides
    .get('docs/DEPLOY_WEB.zh-CN.md')
    ?.includes('“网页部署”和“云同步 Worker”不是一回事'),
  'Chinese beginner deployment guide must separate Web deploy from sync Worker setup.',
)
expect(
  deploymentGuides
    .get('docs/DEPLOY_WEB.zh-CN.md')
    ?.includes('拿不准时，先选 Cloudflare Pages 控制台'),
  'Chinese beginner deployment guide must recommend the no-terminal Cloudflare Pages dashboard path when users are unsure.',
)
expect(
  deploymentGuides
    .get('docs/DEPLOY_WEB.zh-CN.md')
    ?.includes('配置同步不需要碰 `dist/`') &&
    deploymentGuides
      .get('docs/DEPLOY_WEB.zh-CN.md')
      ?.includes('只想让多设备同步，就不要部署网页'),
  'Chinese beginner deployment guide must make clear that sync setup does not need dist or Web hosting.',
)
expect(
  deploymentGuides
    .get('docs/DEPLOY_WEB.zh-CN.md')
    ?.includes('如果你需要严格的浏览器 CSP，请使用会应用 `public/_headers` 的 Cloudflare Pages、Netlify 或其他静态托管；GitHub Pages 不会应用自定义响应头。'),
  'Chinese beginner deployment guide must warn that strict CSP requires a host that applies public/_headers.',
)
expect(
  docsIndex.includes('Web deployment is only needed when you want to host the Web/PWA') &&
    docsIndex.includes('Sync setup guides cover local mode') &&
    docsIndex.includes('Web deployment guides cover only static Web/PWA hosting') &&
    docsIndex.includes('use the Cloudflare Pages') &&
    docsIndex.includes('dashboard path first') &&
    docsIndex.includes('you do not need the') &&
    docsIndex.includes('`dist/` folder or a Web hosting provider') &&
    docsIndex.includes('Cloudflare Pages: build command `pnpm run build`') &&
    !hasStandaloneNpmCommand(docsIndex, 'npm run build') &&
    !hasStandaloneNpmCommand(docsIndex, 'npm run verify:release') &&
    !hasStandaloneNpmCommand(docsIndex, 'npm run verify:all-platforms'),
  'Docs index must keep the Web deployment vs sync setup distinction visible with one pnpm-first command path.',
)

if (failures.length) {
  throw new Error(`Deployment readiness checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('Deployment readiness checks passed')
