import { readFile } from 'node:fs/promises'

const failures = []

async function read(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${path}: ${error.message}`)
    return ''
  }
}

function expect(source, needle, message) {
  if (!source.includes(needle)) {
    failures.push(message)
  }
}

function expectRegex(source, regex, message) {
  if (!regex.test(source)) {
    failures.push(message)
  }
}

const desktopEntry = await read('apps/linux/data/app.zerochat.client.desktop')
const metainfo = await read('apps/linux/data/app.zerochat.client.metainfo.xml')
const flatpakManifest = await read('apps/linux/packaging/flatpak/app.zerochat.client.yml')
const appImageScript = await read('apps/linux/packaging/appimage/build-appimage.sh')
const appIcon = await read('apps/linux/data/icons/hicolor/scalable/apps/app.zerochat.client.svg')
const symbolicIcon = await read(
  'apps/linux/data/icons/hicolor/symbolic/apps/app.zerochat.client-symbolic.svg',
)

expect(desktopEntry, 'Name=ZeroChat', 'Linux desktop entry must name ZeroChat.')
expect(desktopEntry, 'Exec=zerochat-linux', 'Linux desktop entry must launch zerochat-linux.')
expect(
  desktopEntry,
  'Icon=app.zerochat.client',
  'Linux desktop entry must bind the app.zerochat.client icon.',
)
expect(
  desktopEntry,
  'StartupWMClass=app.zerochat.client',
  'Linux desktop entry must keep the app id as StartupWMClass.',
)
expect(desktopEntry, 'Categories=Network;Chat;Utility;', 'Linux desktop entry must classify the app.')
expect(
  desktopEntry,
  'Actions=QuickAsk;SearchChats;Settings;',
  'Linux desktop entry must expose launcher actions for quick ask, chat search, and settings.',
)
for (const [action, command] of [
  ['QuickAsk', 'zerochat-linux --quick-ask'],
  ['SearchChats', 'zerochat-linux --search-chats'],
  ['Settings', 'zerochat-linux --settings'],
]) {
  expect(desktopEntry, `[Desktop Action ${action}]`, `Linux desktop entry must define the ${action} action.`)
  expect(desktopEntry, `Exec=${command}`, `Linux desktop action ${action} must launch ${command}.`)
}
for (const localizedName of [
  'Name[zh_CN]=快速提问',
  'Name[es]=Pregunta rápida',
  'Name[fr]=Question rapide',
  'Name[ar]=سؤال سريع',
  'Name[ja]=クイック質問',
  'Name[ko]=빠른 질문',
]) {
  expect(desktopEntry, localizedName, `Linux desktop actions must include localized launcher label ${localizedName}.`)
}

expect(metainfo, '<component type="desktop-application">', 'AppStream metainfo must be for a desktop app.')
expect(metainfo, '<id>app.zerochat.client</id>', 'AppStream metainfo must use the app id.')
expect(metainfo, '<metadata_license>CC0-1.0</metadata_license>', 'AppStream metainfo must declare a metadata license.')
expect(
  metainfo,
  '<project_license>LicenseRef-proprietary</project_license>',
  'AppStream metainfo must not invent an open-source project license.',
)
expect(
  metainfo,
  '<launchable type="desktop-id">app.zerochat.client.desktop</launchable>',
  'AppStream metainfo must point at the checked-in desktop entry.',
)
expect(metainfo, '<category>Network</category>', 'AppStream metainfo must include Network category.')
expect(metainfo, '<category>Chat</category>', 'AppStream metainfo must include Chat category.')
expect(metainfo, '<content_rating type="oars-1.1" />', 'AppStream metainfo must include OARS rating metadata.')
expectRegex(
  metainfo,
  /<release version="0\.1\.0" date="2026-06-13">/,
  'AppStream metainfo must record the current Linux packaging metadata release.',
)

expect(flatpakManifest, 'app-id: app.zerochat.client', 'Flatpak manifest must use the app id.')
expect(flatpakManifest, 'runtime: org.gnome.Platform', 'Flatpak manifest must use the GNOME Platform runtime.')
expect(flatpakManifest, "runtime-version: '50'", 'Flatpak manifest must target the current GNOME 50 runtime.')
expect(flatpakManifest, 'sdk: org.gnome.Sdk', 'Flatpak manifest must use the GNOME SDK.')
expect(flatpakManifest, 'command: zerochat-linux', 'Flatpak manifest must launch zerochat-linux.')
expect(flatpakManifest, '--socket=wayland', 'Flatpak manifest must allow native Wayland windows.')
expect(flatpakManifest, '--socket=fallback-x11', 'Flatpak manifest must keep an X11 fallback for QA.')
expect(flatpakManifest, '--share=network', 'Flatpak manifest must allow provider and sync networking.')
expect(
  flatpakManifest,
  '--talk-name=org.freedesktop.secrets',
  'Flatpak manifest must permit Secret Service D-Bus access for native secrets.',
)
expect(
  flatpakManifest,
  '--filesystem=xdg-download',
  'Flatpak manifest must allow generated-image downloads to the user Downloads folder.',
)
expect(
  flatpakManifest,
  'cargo build --manifest-path apps/linux/Cargo.toml --release --locked',
  'Flatpak manifest must build the locked Linux Rust package.',
)
for (const artifact of [
  '/app/bin/zerochat-linux',
  '/app/share/applications/app.zerochat.client.desktop',
  '/app/share/metainfo/app.zerochat.client.metainfo.xml',
  '/app/share/icons/hicolor/scalable/apps/app.zerochat.client.svg',
  '/app/share/icons/hicolor/symbolic/apps/app.zerochat.client-symbolic.svg',
]) {
  expect(flatpakManifest, artifact, `Flatpak manifest must install ${artifact}.`)
}

expect(appImageScript, 'APP_ID="app.zerochat.client"', 'AppImage script must use the app id.')
expect(appImageScript, 'BINARY_NAME="zerochat-linux"', 'AppImage script must launch zerochat-linux.')
expect(
  appImageScript,
  'cargo build --manifest-path apps/linux/Cargo.toml --release --locked',
  'AppImage script must build the locked Linux Rust package.',
)
expect(appImageScript, '--appdir-only', 'AppImage script must support AppDir-only target-host validation.')
expect(appImageScript, 'ZEROCHAT_APPIMAGE_APPDIR_ONLY', 'AppImage script must support env-driven AppDir-only validation.')
expect(appImageScript, 'usr/bin/${BINARY_NAME}', 'AppImage script must install the Linux binary into AppDir.')
expect(appImageScript, 'usr/share/applications/${APP_ID}.desktop', 'AppImage script must install the desktop entry.')
expect(appImageScript, 'usr/share/metainfo/${APP_ID}.metainfo.xml', 'AppImage script must install AppStream metadata.')
expect(appImageScript, 'usr/share/icons/hicolor/scalable/apps/${APP_ID}.svg', 'AppImage script must install the scalable icon.')
expect(
  appImageScript,
  'usr/share/icons/hicolor/symbolic/apps/${APP_ID}-symbolic.svg',
  'AppImage script must install the symbolic icon.',
)
expect(appImageScript, 'cat >"${APPDIR}/AppRun"', 'AppImage script must create an AppRun launcher.')
expect(appImageScript, 'exec "${SELF_DIR}/usr/bin/zerochat-linux" "$@"', 'AppRun must execute the native binary.')
expect(appImageScript, 'linuxdeploy', 'AppImage script must support linuxdeploy on target hosts.')
expect(appImageScript, 'appimagetool', 'AppImage script must support appimagetool on target hosts.')
expect(appImageScript, '${APP_NAME}-x86_64.AppImage', 'AppImage script must produce a named x86_64 AppImage by default.')

expect(appIcon, '#6366F1', 'Linux scalable icon must preserve the Indigo brand color.')
expect(symbolicIcon, 'app.zerochat.client-symbolic', 'Linux symbolic icon must keep the app id title.')

if (failures.length > 0) {
  console.error('Linux packaging checks failed:')
  for (const failure of failures) {
    console.error(`- ${failure}`)
  }
  process.exit(1)
}

console.log('Linux packaging metadata checks passed')
