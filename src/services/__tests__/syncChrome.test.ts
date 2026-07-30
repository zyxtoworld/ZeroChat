import { describe, expect, it } from 'vitest'

import type { Translator } from '../../i18n'
import type { SyncConfig } from '../../types'
import { deriveSyncChrome } from '../syncChrome'

const translations: Record<string, string> = {
  'action.startCloudSync': '开启云同步',
  'mode.cloudflare': 'Cloudflare',
  'mode.gist': 'GitHub Gist',
  'mode.local': '本地',
  'setting.sync': '云同步',
  'status.localSaved': '已保存到本机',
  'sync.requirement.cloudflareEndpoint': '请先填写 Cloudflare Worker 地址',
  'sync.requirement.githubToken': '请先填写 GitHub 令牌',
  'sync.requirement.local': '本地模式不上传；跨设备请选择 Gist 或 Cloudflare。',
  'sync.requirement.passphrase': '请先填写数据加密密码',
  'sync.status.localMode': '云同步关闭',
}

const t: Translator = (key) => translations[key] ?? key

function syncConfig(sync: Partial<SyncConfig>): SyncConfig {
  return {
    autoSync: true,
    encryptionEnabled: true,
    mode: 'local',
    ...sync,
  }
}

describe('sync chrome derivation', () => {
  it('keeps the local cloud-sync entry visible and descriptive', () => {
    const chrome = deriveSyncChrome({
      githubTokenValue: '',
      sync: syncConfig({ mode: 'local' }),
      syncMessage: (message) => message,
      syncPassphraseValue: '',
      t,
    })

    expect(chrome.pillText).toBe('本地 · 开启云同步')
    expect(chrome.pillLabel).toBe('云同步: 本地 · 开启云同步 · 云同步关闭')
    expect(chrome.requirement).toBe(
      '本地模式不上传；跨设备请选择 Gist 或 Cloudflare。',
    )
  })

  it('uses provider-specific setup requirements for cloud modes', () => {
    const gistChrome = deriveSyncChrome({
      githubTokenValue: '',
      sync: syncConfig({ mode: 'gist' }),
      syncMessage: (message) => message,
      syncPassphraseValue: 'secret',
      t,
    })

    expect(gistChrome.requirement).toBe('请先填写 GitHub 令牌')
    expect(gistChrome.pillText).toBe('GitHub Gist · 请先填写 GitHub 令牌')
    expect(gistChrome.pillLabel).toBe('云同步: GitHub Gist · 请先填写 GitHub 令牌')

    const cloudflareChrome = deriveSyncChrome({
      githubTokenValue: '',
      sync: syncConfig({ mode: 'cloudflare' }),
      syncMessage: (message) => message,
      syncPassphraseValue: 'secret',
      t,
    })

    expect(cloudflareChrome.requirement).toBe('请先填写 Cloudflare Worker 地址')
    expect(cloudflareChrome.pillText).toBe('Cloudflare · 请先填写 Cloudflare Worker 地址')
    expect(cloudflareChrome.pillLabel).toBe(
      '云同步: Cloudflare · 请先填写 Cloudflare Worker 地址',
    )
  })

  it('localizes the last sync status when cloud sync is configured', () => {
    const chrome = deriveSyncChrome({
      githubTokenValue: '',
      sync: syncConfig({
        lastSyncStatus: 'Sync complete',
        mode: 'cloudflare',
        workerEndpoint: 'https://example.workers.dev',
      }),
      syncMessage: () => '同步完成',
      syncPassphraseValue: 'secret',
      t,
    })

    expect(chrome.requirement).toBe('')
    expect(chrome.statusText).toBe('同步完成')
    expect(chrome.pillText).toBe('Cloudflare · 同步完成')
    expect(chrome.pillLabel).toBe('云同步: Cloudflare · 同步完成')
  })
})
