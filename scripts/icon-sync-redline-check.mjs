import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const failures = []

async function readText(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${filePath}: ${error.message}`)
    return ''
  }
}

async function readBinary(filePath) {
  try {
    return await readFile(filePath)
  } catch (error) {
    failures.push(`Unable to read ${filePath}: ${error.message}`)
    return Buffer.alloc(0)
  }
}

async function readOptionalJson(filePath) {
  if (!existsSync(filePath)) {
    return null
  }

  try {
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch (error) {
    failures.push(`Unable to parse ${filePath}: ${error.message}`)
    return null
  }
}

async function readFirstOptionalJson(filePaths) {
  for (const filePath of filePaths) {
    const parsed = await readOptionalJson(filePath)
    if (parsed) {
      return parsed
    }
  }

  return null
}

function expect(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

function has(source, needle) {
  return source.includes(needle)
}

function expectIncludes(source, needle, message) {
  expect(has(source, needle), message)
}

function assertExistingPath(filePath, message) {
  expect(existsSync(filePath), message)
}

function assertIcoSizes(buffer, filePath, expectedSizes) {
  if (buffer.length < 6) {
    failures.push(`${filePath} must be a non-empty ICO file.`)
    return
  }

  const reserved = buffer.readUInt16LE(0)
  const type = buffer.readUInt16LE(2)
  const count = buffer.readUInt16LE(4)

  if (reserved !== 0 || type !== 1 || count <= 0) {
    failures.push(`${filePath} must have a valid ICO header.`)
    return
  }

  const sizes = new Set()
  for (let index = 0; index < count; index += 1) {
    const offset = 6 + index * 16
    if (offset + 16 > buffer.length) {
      failures.push(`${filePath} has a truncated ICO directory.`)
      return
    }

    const width = buffer[offset] || 256
    const height = buffer[offset + 1] || 256
    sizes.add(`${width}x${height}`)
  }

  for (const size of expectedSizes) {
    expect(sizes.has(size), `${filePath} must include a ${size} icon image.`)
  }
}

const [
  syncChrome,
  syncChromeTest,
  syncStatusButton,
  appLogo,
  sidebar,
  chatHeader,
  androidAppIcon,
  androidChatChrome,
  androidChatScreen,
  androidSettingsScreen,
  androidSyncSettings,
  androidSyncProviderFields,
  androidUiSmoke,
  androidCloudSyncSmoke,
  appleCloudSyncStatusStrip,
  appleConversationSidebar,
  appleChatView,
  appleXcodeProject,
  windowsMainWindow,
  windowsMainWindowHeader,
  windowsProject,
  windowsResource,
  linuxApplication,
  linuxSidebar,
  linuxReadme,
] = await Promise.all([
  readText('src/services/syncChrome.ts'),
  readText('src/services/__tests__/syncChrome.test.ts'),
  readText('src/components/SyncStatusButton.tsx'),
  readText('src/components/AppLogo.tsx'),
  readText('src/components/Sidebar.tsx'),
  readText('src/components/ChatHeader.tsx'),
  readText('apps/android/app/src/main/java/app/zerochat/ui/AppIcon.kt'),
  readText('apps/android/app/src/main/java/app/zerochat/ui/chat/ChatChrome.kt'),
  readText('apps/android/app/src/main/java/app/zerochat/ui/ChatScreen.kt'),
  readText('apps/android/app/src/main/java/app/zerochat/ui/settings/SettingsScreen.kt'),
  readText('apps/android/app/src/main/java/app/zerochat/ui/settings/SyncSettings.kt'),
  readText('apps/android/app/src/main/java/app/zerochat/ui/settings/SyncProviderFields.kt'),
  readText('scripts/android-ui-smoke.mjs'),
  readText('scripts/android-cloud-sync-smoke.mjs'),
  readText('apps/apple/App/AppleCloudSyncStatusStrip.swift'),
  readText('apps/apple/App/AppleConversationSidebar.swift'),
  readText('apps/apple/App/ChatView.swift'),
  readText('apps/apple/ZeroChat.xcodeproj/project.pbxproj'),
  readText('apps/windows/ZeroChat/MainWindow.xaml.cpp'),
  readText('apps/windows/ZeroChat/MainWindow.xaml.h'),
  readText('apps/windows/ZeroChat/ZeroChat.vcxproj'),
  readText('apps/windows/ZeroChat/ZeroChat.rc'),
  readText('apps/linux/src/application.rs'),
  readText('apps/linux/src/sidebar.rs'),
  readText('apps/linux/README.md'),
])

expectIncludes(
  syncChrome,
  "`${modeLabel} · ${t('action.startCloudSync')}`",
  'Web sync chrome must keep the visible local start-cloud-sync copy.',
)
expectIncludes(
  syncChrome,
  'pillLabel',
  'Web sync chrome must keep an accessible sync status label.',
)
expectIncludes(
  syncChromeTest,
  '本地 · 开启云同步',
  'Web sync chrome tests must lock the exact Chinese local cloud-sync text.',
)
expectIncludes(
  syncChromeTest,
  '云同步: 本地 · 开启云同步 · 云同步关闭',
  'Web sync chrome tests must lock the exact Chinese cloud-sync accessible label.',
)
expectIncludes(
  syncStatusButton,
  "'sync-pill ghost-button'",
  'Web sidebar sync button must keep the sync-pill class.',
)
expectIncludes(
  syncStatusButton,
  "'chat-sync-strip ghost-button'",
  'Web chat-header sync button must keep the chat-sync-strip class.',
)
expectIncludes(
  syncStatusButton,
  'aria-label={syncChrome.pillLabel}',
  'Web sync buttons must expose the derived accessible label.',
)
expectIncludes(
  syncStatusButton,
  'data-settings-opener="true"',
  'Web sync buttons must remain Settings openers for browser smoke targeting.',
)
expectIncludes(appLogo, 'APP_ICON_SRC', 'Web app logo must keep a stable branded icon source.')
expectIncludes(appLogo, 'favicon.svg', 'Web app logo must keep the branded favicon asset.')
expectIncludes(sidebar, '<AppLogo', 'Web sidebar must keep the branded app logo.')
expectIncludes(chatHeader, "onOpenSettings(event, 'sync')", 'Web chat-header sync strip must open Settings > Sync.')

expectIncludes(
  androidAppIcon,
  'testTag("zerochat-app-icon")',
  'Android in-app icon must keep the zerochat-app-icon test tag.',
)
expectIncludes(
  androidAppIcon,
  'R.drawable.ic_launcher_foreground',
  'Android in-app icon must render the branded launcher foreground.',
)
expectIncludes(
  androidChatChrome,
  'testTag("zerochat-cloud-sync-status")',
  'Android home cloud-sync status strip must keep its test tag.',
)
expectIncludes(
  androidChatChrome,
  'i18n.t("action.startCloudSync")',
  'Android cloud-sync strip must keep the Start cloud sync action.',
)
expectIncludes(
  androidChatScreen,
  'onOpenSyncSettings = { openSettings(initialTab = SettingsTab.Sync) }',
  'Android home cloud-sync action must open Settings > Sync directly.',
)
expectIncludes(
  androidSettingsScreen,
  'SettingsTab.Sync -> R.drawable.ic_cloud_sync_24',
  'Android Settings > Sync tab must keep the cloud-sync icon.',
)
expectIncludes(androidSyncSettings, 'CloudflareSyncFields(', 'Android Settings > Sync must keep Cloudflare fields.')
expectIncludes(
  androidSyncProviderFields,
  'field.cloudflareWorkerUrl',
  'Android Cloudflare sync fields must keep the Worker URL input.',
)
expectIncludes(
  androidSyncProviderFields,
  'field.cloudflareAccessKey',
  'Android Cloudflare sync fields must keep the derived access-key input.',
)
expectIncludes(androidUiSmoke, 'zerochat-app-icon', 'Android UI smoke must guard the in-app icon.')
expectIncludes(androidUiSmoke, 'zerochat-cloud-sync-status', 'Android UI smoke must guard the cloud-sync strip.')
expectIncludes(
  androidUiSmoke,
  'assertAndroidHomeCloudSyncSettingsActionOpensSyncSettings',
  'Android UI smoke must prove the home cloud-sync action opens Settings > Sync.',
)
expectIncludes(androidCloudSyncSmoke, 'Cloudflare', 'Android Cloudflare sync smoke must remain present.')

expectIncludes(
  appleCloudSyncStatusStrip,
  'struct AppleCloudSyncStatusStrip: View',
  'Apple must keep the focused cloud-sync status strip view.',
)
expectIncludes(
  appleCloudSyncStatusStrip,
  'i18n.t("action.startCloudSync")',
  'Apple cloud-sync strip must keep the Start cloud sync action.',
)
expectIncludes(
  appleConversationSidebar,
  'AppleCloudSyncStatusStrip(',
  'Apple sidebar must mount the cloud-sync status strip.',
)
expectIncludes(
  appleChatView,
  'openSyncSettings: { openSettings(.sync) }',
  'Apple chat view must route the cloud-sync strip to Settings > Sync.',
)
expectIncludes(
  appleXcodeProject,
  'AppleCloudSyncStatusStrip.swift',
  'Apple Xcode project must include AppleCloudSyncStatusStrip.swift.',
)
expectIncludes(
  appleXcodeProject,
  'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon',
  'Apple Xcode project must keep the AppIcon asset catalog binding.',
)
assertExistingPath(
  'apps/apple/App/Assets.xcassets/AppIcon.appiconset/Contents.json',
  'Apple AppIcon asset catalog must exist.',
)

const windowsIcon = await readBinary('apps/windows/ZeroChat/ZeroChat.ico')
assertIcoSizes(windowsIcon, 'apps/windows/ZeroChat/ZeroChat.ico', [
  '16x16',
  '32x32',
  '48x48',
  '256x256',
])
expectIncludes(
  windowsProject,
  '<ApplicationIcon>ZeroChat.ico</ApplicationIcon>',
  'Windows project must bind the branded ZeroChat.ico as the application icon.',
)
expectIncludes(
  windowsProject,
  '<Image Include="ZeroChat.ico" />',
  'Windows project must package the branded ZeroChat.ico image.',
)
expectIncludes(
  windowsResource,
  'IDI_ZEROCHAT_APP ICON "ZeroChat.ico"',
  'Windows resource file must embed ZeroChat.ico.',
)
expectIncludes(
  windowsMainWindowHeader,
  'void ApplyWindowIcon();',
  'Windows MainWindow header must declare ApplyWindowIcon.',
)
expectIncludes(
  windowsMainWindow,
  'void MainWindow::ApplyWindowIcon()',
  'Windows MainWindow must own the app icon attachment helper.',
)
expectIncludes(
  windowsMainWindow,
  'ApplyWindowIcon();',
  'Windows MainWindow must apply the icon during startup.',
)

expectIncludes(linuxApplication, 'pub(crate) const APP_ID', 'Linux must keep the app id for branded icons.')
expectIncludes(
  linuxApplication,
  '.icon_name(APP_ID)',
  'Linux application windows must keep the branded app icon name.',
)
expectIncludes(
  linuxApplication,
  'add_linux_icon_search_path()',
  'Linux must add the local icon search path for development/runtime smoke.',
)
expectIncludes(
  linuxSidebar,
  'gtk::Image::from_icon_name(APP_ID)',
  'Linux sidebar must show the branded app icon beside the title.',
)
expectIncludes(
  linuxSidebar,
  'tr(locale, "action.startCloudSync")',
  'Linux sidebar sync button must keep the Start cloud sync action.',
)
expectIncludes(
  linuxSidebar,
  'open_linux_settings_window(&window_for_settings, state.clone(), "sync")',
  'Linux sidebar cloud-sync button must open Settings > Sync directly.',
)
expectIncludes(
  linuxSidebar,
  'sync_icon_name(&sync_mode)',
  'Linux sidebar cloud-sync button must keep mode-specific icons.',
)
assertExistingPath(
  'apps/linux/data/icons/hicolor/scalable/apps/app.zerochat.client.svg',
  'Linux scalable app icon must exist.',
)
assertExistingPath(
  'apps/linux/data/icons/hicolor/symbolic/apps/app.zerochat.client-symbolic.svg',
  'Linux symbolic app icon must exist.',
)
expectIncludes(
  linuxReadme,
  'app icon beside the ZeroChat title',
  'Linux README must document the branded sidebar icon.',
)
expectIncludes(
  linuxReadme,
  'opens Settings > Sync directly',
  'Linux README must document the direct Settings > Sync route.',
)

const webIconSyncDom = await readOptionalJson('.manual-qa/web-current-icon-sync-dom.json')
if (webIconSyncDom) {
  expect(
    webIconSyncDom.visibleFaviconLogoCount >= 2,
    'Web current-page DOM evidence must show at least two visible favicon/logo instances.',
  )
  expect(
    webIconSyncDom.visibleExactSyncControlCount >= 2,
    'Web current-page DOM evidence must show both visible local cloud-sync controls.',
  )
  expect(
    webIconSyncDom.visibleExactSyncAriaCount >= 2,
    'Web current-page DOM evidence must show both exact cloud-sync accessible labels.',
  )
  expect(
    webIconSyncDom.syncSettingsOpenProofCount >= 2,
    'Web current-page DOM evidence must prove both cloud-sync controls open Settings > Sync.',
  )
}

const androidUiReport = await readFirstOptionalJson([
  '.manual-qa/android-ui-smoke.json',
  '.manual-qa/android-current-page-qa.json',
])
if (androidUiReport) {
  expect(
    String(androidUiReport.homeAppIcon?.resourceId ?? '').endsWith('zerochat-app-icon'),
    'Android current QA evidence must include the zerochat-app-icon resource id.',
  )
  expect(
    String(androidUiReport.homeCloudSyncStatusStrip?.resourceId ?? '').endsWith(
      'zerochat-cloud-sync-status',
    ),
    'Android current QA evidence must include the zerochat-cloud-sync-status resource id.',
  )
  expect(
    androidUiReport.homeCloudSyncStatusStrip?.hasSettingsAction === true,
    'Android current QA evidence must prove the cloud-sync strip keeps its Settings action.',
  )
  expect(
    androidUiReport.homeCloudSyncSettingsProof?.openedSyncSettings === true &&
      androidUiReport.homeCloudSyncSettingsProof?.returnedHome === true,
    'Android current QA evidence must prove the cloud-sync strip opens Settings > Sync and returns home.',
  )
}

if (failures.length > 0) {
  throw new Error(`Icon/cloud-sync redline checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('Icon/cloud-sync redline checks passed')
