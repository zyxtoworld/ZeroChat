import type { ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  ComposerMode,
  ImageTaskMode,
} from '../../services/imageComposerChrome'
import { ChatPaneComposerSection } from '../ChatPaneComposerSection'
import { clearComposerSectionNotice } from '../ChatPaneComposerSectionNotice'

const t = ((key: string) => key) as Translator

type SectionProps = Parameters<typeof ChatPaneComposerSection>[0]

interface ChatComposerCallbacks {
  onComposerModeChange: (mode: ComposerMode) => void
  onImagePreviewError: () => void
  onImageTaskModeChange: (mode: ImageTaskMode) => void
}

function renderSection(
  overrides: Partial<SectionProps> = {},
): ReactElement<ChatComposerCallbacks> {
  return ChatPaneComposerSection({
    audioSourceDragActive: false,
    audioSourceDragRejected: false,
    audioSourceFile: null,
    closeChatModelMenu: vi.fn(),
    composerChrome: {
      activeAudioInputRequirement: '',
      activeComposerRequirement: '',
      activeImageInputRequirement: '',
      composerCanSubmit: true,
      composerUnavailableReason: '',
      image: {
        inputPlaceholder: 'image',
        submitLabel: 'generate',
        welcomeTitle: 'image',
      },
      inputPlaceholder: 'message',
      submitAccessibleLabel: 'send',
      submitButtonLabel: 'send',
      submitTitle: 'send',
      welcomeHint: '',
      welcomeSettingsTab: 'providers',
      welcomeSetupRequired: false,
      welcomeSetupRequirement: '',
      welcomeTitle: '',
    },
    composerMode: 'chat',
    composerTextareaRef: { current: null },
    draft: '',
    drawMaskStroke: vi.fn(),
    abandonMaskStrokeIfUncaptured: vi.fn(),
    generationActive: false,
    handleAudioSourceChange: vi.fn(),
    handleAudioSourceDragEnter: vi.fn(),
    handleAudioSourceDragLeave: vi.fn(),
    handleAudioSourceDragOver: vi.fn(),
    handleAudioSourceDrop: vi.fn(),
    handleDraftKeyDown: vi.fn(),
    handleImageSourceChange: vi.fn(),
    handleImageSourceDragEnter: vi.fn(),
    handleImageSourceDragLeave: vi.fn(),
    handleImageSourceDragOver: vi.fn(),
    handleImageSourceDrop: vi.fn(),
    handleImageSourcePaste: vi.fn(),
    reportImageSourcePreviewFailed: vi.fn(),
    handleMaskCanvasKeyDown: vi.fn(),
    imageSourceDragActive: false,
    imageSourceDragRejected: false,
    imageSourceFile: null,
    imageSourceUrl: '',
    imageTaskMode: 'generate',
    maskBrushSize: 24,
    maskCanvasRef: { current: null },
    maskKeyboardCursor: { x: 0, y: 0 },
    maskTouched: false,
    maskUndoAvailable: false,
    sendMessage: vi.fn(),
    setAudioSource: vi.fn(),
    setComposerMode: vi.fn(),
    setDraft: vi.fn(),
    setImageSource: vi.fn(),
    setImageTaskMode: vi.fn(),
    setMaskBrushSize: vi.fn(),
    setNotice: vi.fn(),
    startMaskStroke: vi.fn(),
    stopGeneration: vi.fn(),
    stopMaskStroke: vi.fn(),
    syncMaskCanvasSize: vi.fn(),
    t,
    undoMaskCanvas: vi.fn(),
    clearMaskCanvas: vi.fn(),
    ...overrides,
  }) as ReactElement<ChatComposerCallbacks>
}

describe('ChatPaneComposerSection', () => {
  it('contains composer-section clear-notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice failed')
    }) as SectionProps['setNotice']

    expect(clearComposerSectionNotice(setNotice)).toBe(false)
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('keeps composer mode changes when notice clearing fails', () => {
    const closeChatModelMenu = vi.fn()
    const setComposerMode = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice failed')
    }) as SectionProps['setNotice']
    const tree = renderSection({
      closeChatModelMenu,
      setComposerMode,
      setNotice,
    })

    expect(() => tree.props.onComposerModeChange('audio')).not.toThrow()
    expect(setComposerMode).toHaveBeenCalledWith('audio')
    expect(closeChatModelMenu).toHaveBeenCalledTimes(1)
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('keeps image task mode changes when notice clearing fails', () => {
    const setImageTaskMode = vi.fn()
    const setNotice = vi.fn(() => {
      throw new Error('notice failed')
    }) as SectionProps['setNotice']
    const tree = renderSection({
      composerMode: 'image',
      setImageTaskMode,
      setNotice,
    })

    expect(() => tree.props.onImageTaskModeChange('inpaint')).not.toThrow()
    expect(setImageTaskMode).toHaveBeenCalledWith('inpaint')
    expect(setNotice).toHaveBeenCalledWith('')
  })

  it('clears an undecodable source image before reporting the preview failure', () => {
    const order: string[] = []
    const setImageSource = vi.fn(() => order.push('clear'))
    const reportImageSourcePreviewFailed = vi.fn(() => order.push('report'))
    const tree = renderSection({
      reportImageSourcePreviewFailed,
      setImageSource,
    })

    tree.props.onImagePreviewError()

    expect(order).toEqual(['clear', 'report'])
    expect(setImageSource).toHaveBeenCalledWith(null)
    expect(reportImageSourcePreviewFailed).toHaveBeenCalledTimes(1)
  })
})
