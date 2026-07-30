import { describe, expect, it } from 'vitest'

import { providerFromPreset, providerPresets } from '../../data/presets'
import type { Translator } from '../../i18n'
import type {
  AppData,
  ChatMessage,
  ProviderConfig,
} from '../../types'
import {
  deriveAppComposerChromeState,
  deriveAppDataChrome,
  displayLocalesForLanguageMode,
  systemDateLocalesFromKey,
  targetLocaleForLanguageMode,
} from '../appChromeController'

const translations: Record<string, string> = {
  'action.startCloudSync': '开启云同步',
  'button.actionWithShortcut': '{action} ({shortcut})',
  'button.newChat': '新对话',
  'button.send': '发送',
  'button.sendMessage': '发送消息',
  'button.transcribe': '转写',
  'button.transcribeAudio': '转写音频',
  'field.provider': '服务商',
  'hint.audioTranscription': '选择音频文件开始转写。',
  'hint.emptyCanSend': '直接输入消息即可开始。',
  'message.audioTranscriptionPlaceholder': '可选：给转写模型的提示词...',
  'message.placeholder': '输入消息...',
  'mode.cloudflare': 'Cloudflare',
  'mode.gist': 'GitHub Gist',
  'mode.local': '本地',
  'option.emptyModel': '未选择模型',
  'option.noEnabledProviders': '没有启用的服务商',
  'option.noAudioModels': '没有音频模型',
  'option.noImageModels': '没有图片模型',
  'notice.audioRequired': '请先选择音频',
  'setting.sync': '云同步',
  'status.localSaved': '已保存到本机',
  'sync.requirement.local': '本地模式不上传；跨设备请选择 Gist 或 Cloudflare。',
  'sync.status.localMode': '云同步关闭',
  'welcome.audioTitle': '转写音频',
  'welcome.title': '今天想聊什么？',
}

const t: Translator = (key, values) => {
  const template = translations[key] ?? key

  if (!values) {
    return template
  }

  return Object.entries(values).reduce(
    (text, [name, value]) => text.replace(`{${name}}`, String(value)),
    template,
  )
}

function provider(patch: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    ...providerFromPreset(providerPresets[0]),
    id: 'provider-1',
    model: 'gpt-5-mini',
    models: ['gpt-5-mini'],
    name: 'OpenAI',
    ...patch,
  }
}

function appData(providerConfig = provider()): AppData {
  return {
    conversations: [
      {
        createdAt: 1,
        id: 'conversation-1',
        messages: [],
        model: 'gpt-5-mini',
        providerId: providerConfig.id,
        title: 'Chat',
        updatedAt: 1,
      },
    ],
    preferences: {
      activeConversationId: 'conversation-1',
      chatContextMessageLimit: 12,
      compactMode: false,
      firstRunDone: true,
      language: 'zh-CN',
      theme: 'system',
    },
    providers: [providerConfig],
    skillSettings: {
      autoMatch: true,
      contextBudget: 2400,
      maxAutoSkills: 3,
    },
    skills: [
      {
        autoMatch: true,
        chunks: [],
        contentHash: 'hash',
        contentType: 'markdown',
        createdAt: 1,
        description: '',
        enabled: true,
        fixed: false,
        id: 'skill-1',
        keywords: [],
        name: 'Skill',
        sourceSize: 1,
        updatedAt: 1,
      },
    ],
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt: 1,
    version: 1,
  }
}

describe('app chrome controller derivation', () => {
  it('derives locale targets and date locale fallbacks from the system key', () => {
    expect(systemDateLocalesFromKey('fr-FR|en-US|')).toEqual([
      'fr-FR',
      'en-US',
    ])
    expect(targetLocaleForLanguageMode('system', 'fr-FR|en-US')).toBe('fr-FR')
    expect(targetLocaleForLanguageMode('zh-CN', 'fr-FR|en-US')).toBe('zh-CN')
    expect(displayLocalesForLanguageMode('system', 'fr-FR|en-US')).toEqual([
      'fr-FR',
      'en-US',
    ])
    expect(displayLocalesForLanguageMode('ar-SA', 'fr-FR|en-US')).toEqual([
      'ar-SA',
    ])
  })

  it('keeps app data chrome state out of App.tsx', () => {
    const streamingMessage: ChatMessage = {
      content: '',
      createdAt: 1,
      id: 'message-1',
      role: 'assistant',
      status: 'streaming',
    }
    const data = appData()
    data.conversations[0].messages.push(streamingMessage)

    expect(deriveAppDataChrome({ data, sending: false })).toMatchObject({
      chatContextMessageLimit: 12,
      dataLoaded: true,
      generationActive: true,
      hasEnabledSkills: true,
      syncMode: 'local',
    })
  })

  it('preserves composer readiness, shortcuts, and the local cloud-sync action', () => {
    const activeProvider = provider()
    const state = deriveAppComposerChromeState({
      activeImageModel: '',
      activeModel: 'gpt-5-mini',
      activeProvider,
      audioSourceFile: null,
      activeSyncPassphraseAvailable: false,
      composerMode: 'chat',
      data: appData(activeProvider),
      draft: 'hello',
      enabledChatProviders: [activeProvider],
      generationActive: false,
      githubTokenValue: '',
      imageSourceFile: null,
      imageTaskMode: 'generate',
      maskTouched: false,
      providerKeys: { [activeProvider.id]: 'key' },
      syncMessage: (message) => message,
      syncPassphraseValue: '',
      t,
    })

    expect(state.composerReadiness.activeProviderLabel).toBe('OpenAI')
    expect(state.composerChrome.composerCanSubmit).toBe(true)
    expect(state.newConversationShortcut).toBe('Control+N')
    expect(state.newConversationTitle).toBe('新对话 (Ctrl+N)')
    expect(state.syncChrome.pillText).toBe('本地 · 开启云同步')
    expect(state.syncChrome.pillLabel).toBe(
      '云同步: 本地 · 开启云同步 · 云同步关闭',
    )
  })

  it('passes audio source availability through composer readiness and chrome state', () => {
    const activeProvider = provider({
      models: ['gpt-5-mini', 'gpt-4o-transcribe'],
    })
    const state = deriveAppComposerChromeState({
      activeImageModel: '',
      activeModel: 'gpt-5-mini',
      activeProvider,
      audioSourceFile: new File(['audio'], 'clip.webm', { type: 'audio/webm' }),
      activeSyncPassphraseAvailable: false,
      composerMode: 'audio',
      data: appData(activeProvider),
      draft: '',
      enabledChatProviders: [activeProvider],
      generationActive: false,
      githubTokenValue: '',
      imageSourceFile: null,
      imageTaskMode: 'generate',
      maskTouched: false,
      providerKeys: { [activeProvider.id]: 'key' },
      syncMessage: (message) => message,
      syncPassphraseValue: '',
      t,
    })

    expect(state.composerReadiness.activeModelLabel).toBe('gpt-4o-transcribe')
    expect(state.composerReadiness.activeAudioRequirement).toBe('')
    expect(state.composerChrome.activeAudioInputRequirement).toBe('')
    expect(state.composerChrome.composerCanSubmit).toBe(true)
    expect(state.composerChrome.submitButtonLabel).toBe('转写')
    expect(state.composerChrome.welcomeTitle).toBe('转写音频')
  })

  it('does not treat an uncommitted sync-passphrase draft as proxy readiness', () => {
    const activeProvider = provider({
      needsApiKey: false,
      proxyUrl: 'https://sync.example.workers.dev',
    })
    const options = {
      activeImageModel: '',
      activeModel: 'gpt-5-mini',
      activeProvider,
      audioSourceFile: null,
      composerMode: 'chat' as const,
      data: appData(activeProvider),
      draft: 'hello',
      enabledChatProviders: [activeProvider],
      generationActive: false,
      githubTokenValue: '',
      imageSourceFile: null,
      imageTaskMode: 'generate' as const,
      maskTouched: false,
      providerKeys: {},
      syncMessage: (message: string) => message,
      syncPassphraseValue: 'uncommitted-draft',
      t,
    }

    const blocked = deriveAppComposerChromeState({
      ...options,
      activeSyncPassphraseAvailable: false,
    })
    const ready = deriveAppComposerChromeState({
      ...options,
      activeSyncPassphraseAvailable: true,
    })

    expect(blocked.composerReadiness.activeChatRequirement).toBe(
      'error.cloudflareAccessKeyRequired',
    )
    expect(blocked.composerChrome.composerCanSubmit).toBe(false)
    expect(ready.composerReadiness.activeChatRequirement).toBe('')
    expect(ready.composerChrome.composerCanSubmit).toBe(true)
  })
})
