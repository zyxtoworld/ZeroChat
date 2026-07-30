import { describe, expect, it } from 'vitest'

import type { Translator } from '../../i18n'
import { deriveComposerChrome } from '../composerChrome'

const translations: Record<string, string> = {
  'button.actionWithShortcut': '{action} ({shortcut})',
  'button.transcribe': '转写',
  'button.transcribeAudio': '转写音频',
  'button.editImage': '编辑图片',
  'button.generateImage': '生成图片',
  'button.send': '发送',
  'button.sendMessage': '发送消息',
  'hint.audioTranscription': '选择音频文件开始转写。',
  'hint.emptyCanSend': '直接输入消息即可开始。',
  'message.audioTranscriptionPlaceholder': '可选：给转写模型的提示词...',
  'message.imageEditPlaceholder': '描述要怎样改这张图...',
  'message.imageInpaintPlaceholder': '描述要怎样重绘选区...',
  'message.imagePlaceholder': '描述你想生成的图片...',
  'message.placeholder': '输入消息...',
  'mode.imageInpaint': '局部重绘',
  'notice.audioRequired': '请先选择要转写的音频',
  'notice.imageRequired': '请先选择源图片',
  'notice.maskRequired': '请先涂抹要重绘的区域',
  'welcome.audioTitle': '转写音频',
  'welcome.imageEditTitle': '编辑图片',
  'welcome.imageInpaintTitle': '局部重绘',
  'welcome.imageTitle': '生成图片',
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

const baseOptions = {
  activeAudioRequirement: '',
  activeChatRequirement: '',
  activeImageRequirement: '',
  activeProviderAvailable: true,
  audioSourceAvailable: false,
  composerMode: 'chat',
  draft: 'hello',
  generationActive: false,
  imageSourceAvailable: false,
  imageTaskMode: 'generate',
  maskTouched: false,
  sendShortcut: 'Ctrl+Enter',
  t,
  welcomeGenerationRequirement: '',
  welcomeModel: 'gpt-5',
  welcomeNeedsProviderKey: false,
  welcomeProviderAvailable: true,
  welcomeProviderEnabled: true,
  welcomeProviderKey: '',
} as const

describe('composer chrome derivation', () => {
  it('keeps chat submit copy and empty-chat hint distinct', () => {
    const chrome = deriveComposerChrome(baseOptions)

    expect(chrome.composerCanSubmit).toBe(true)
    expect(chrome.inputPlaceholder).toBe('输入消息...')
    expect(chrome.submitAccessibleLabel).toBe('发送消息 (Ctrl+Enter)')
    expect(chrome.submitButtonLabel).toBe('发送')
    expect(chrome.submitTitle).toBe('发送消息 (Ctrl+Enter)')
    expect(chrome.welcomeHint).toBe('直接输入消息即可开始。')
    expect(chrome.welcomeTitle).toBe('今天想聊什么？')
  })

  it('blocks image edit until a source image is selected', () => {
    const chrome = deriveComposerChrome({
      ...baseOptions,
      composerMode: 'image',
      imageTaskMode: 'edit',
    })

    expect(chrome.activeImageInputRequirement).toBe('请先选择源图片')
    expect(chrome.composerCanSubmit).toBe(false)
    expect(chrome.composerUnavailableReason).toBe('请先选择源图片')
    expect(chrome.submitAccessibleLabel).toBe(
      '编辑图片 (Ctrl+Enter): 请先选择源图片',
    )
    expect(chrome.submitButtonLabel).toBe('编辑图片')
    expect(chrome.welcomeHint).toBe('请先选择源图片')
    expect(chrome.welcomeTitle).toBe('编辑图片')
  })

  it('blocks inpaint until the mask has paint when a source exists', () => {
    const chrome = deriveComposerChrome({
      ...baseOptions,
      composerMode: 'image',
      imageSourceAvailable: true,
      imageTaskMode: 'inpaint',
    })

    expect(chrome.activeImageInputRequirement).toBe('请先涂抹要重绘的区域')
    expect(chrome.composerUnavailableReason).toBe('请先涂抹要重绘的区域')
    expect(chrome.submitAccessibleLabel).toBe(
      '局部重绘 (Ctrl+Enter): 请先涂抹要重绘的区域',
    )
    expect(chrome.submitButtonLabel).toBe('局部重绘')
    expect(chrome.welcomeTitle).toBe('局部重绘')
  })

  it('blocks audio mode until a source is selected, then allows promptless submit', () => {
    const blocked = deriveComposerChrome({
      ...baseOptions,
      composerMode: 'audio',
      draft: '',
    })

    expect(blocked.activeAudioInputRequirement).toBe('请先选择要转写的音频')
    expect(blocked.activeComposerRequirement).toBe('请先选择要转写的音频')
    expect(blocked.composerCanSubmit).toBe(false)
    expect(blocked.inputPlaceholder).toBe('可选：给转写模型的提示词...')
    expect(blocked.submitAccessibleLabel).toBe(
      '转写音频 (Ctrl+Enter): 请先选择要转写的音频',
    )
    expect(blocked.submitButtonLabel).toBe('转写')
    expect(blocked.welcomeHint).toBe('请先选择要转写的音频')
    expect(blocked.welcomeTitle).toBe('转写音频')

    const ready = deriveComposerChrome({
      ...baseOptions,
      audioSourceAvailable: true,
      composerMode: 'audio',
      draft: '',
    })

    expect(ready.activeAudioInputRequirement).toBe('')
    expect(ready.composerCanSubmit).toBe(true)
    expect(ready.submitAccessibleLabel).toBe('转写音频 (Ctrl+Enter)')
    expect(ready.welcomeHint).toBe('选择音频文件开始转写。')
  })

  it('prioritizes setup guidance in the image empty state', () => {
    const chrome = deriveComposerChrome({
      ...baseOptions,
      activeImageRequirement: '请先选择图片模型',
      composerMode: 'image',
      imageTaskMode: 'edit',
    })

    expect(chrome.activeComposerRequirement).toBe('请先选择源图片')
    expect(chrome.welcomeSetupRequirement).toBe('请先选择图片模型')
    expect(chrome.welcomeHint).toBe('请先选择图片模型')
    expect(chrome.welcomeSetupRequired).toBe(true)
  })

  it('sends empty-state setup to models only after provider credentials are ready', () => {
    expect(
      deriveComposerChrome({
        ...baseOptions,
        welcomeModel: '',
      }).welcomeSettingsTab,
    ).toBe('models')

    expect(
      deriveComposerChrome({
        ...baseOptions,
        welcomeModel: '',
        welcomeNeedsProviderKey: true,
        welcomeProviderKey: '',
      }).welcomeSettingsTab,
    ).toBe('providers')
  })
})
