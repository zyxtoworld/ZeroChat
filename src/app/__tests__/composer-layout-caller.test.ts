import { afterEach, describe, expect, it, vi } from 'vitest'

type Effect = () => void | (() => void)

const harness = vi.hoisted(() => ({
  effects: [] as Effect[],
  refs: [] as Array<{ current: unknown }>,
  reset() {
    this.effects.length = 0
    this.refs.length = 0
  },
}))

const storeState = vi.hoisted(() => ({
  data: {
    conversations: [
      { id: 'conversation-1', messages: [] },
    ],
    preferences: { language: 'en-US' },
  },
  composerImages: [],
  composerInputResetGeneration: 0,
  composerMode: 'chat',
  imageTaskMode: 'generate',
  sending: false,
  transcribingAudio: false,
}))

vi.mock('react', () => ({
  useEffect: (effect: Effect) => {
    harness.effects.push(effect)
  },
  useLayoutEffect: (effect: Effect) => {
    harness.effects.push(effect)
  },
  useRef: (initial: unknown) => {
    const ref = { current: initial }
    harness.refs.push(ref)
    return ref
  },
  useState: (initial: unknown) => [
    typeof initial === 'function' ? (initial as () => unknown)() : initial,
    vi.fn(),
  ],
}))

vi.mock('lucide-react', () => ({
  ImagePlus: () => null,
  SendHorizonal: () => null,
  Square: () => null,
  X: () => null,
}))

vi.mock('../../i18n', () => ({
  resolveLocale: () => 'en-US',
  translate: (_locale: string, key: string) => key,
}))

vi.mock('../../services/audioComposerController', () => ({
  useAudioComposerController: () => ({
    audioSourceDragActive: false,
    audioSourceDragRejected: false,
    audioSourceFile: null,
    handleAudioSourceChange: vi.fn(),
    handleAudioSourceDragEnter: vi.fn(),
    handleAudioSourceDragLeave: vi.fn(),
    handleAudioSourceDragOver: vi.fn(),
    handleAudioSourceDrop: vi.fn(),
    setAudioSource: vi.fn(),
  }),
}))

vi.mock('../../services/imageComposerController', () => ({
  useImageComposerController: () => ({
    imageSourceFile: null,
    imageSourceUrl: '',
    isCurrentImagePreview: false,
    imageSourceDragActive: false,
    imageSourceDragRejected: false,
    maskKeyboardCursor: null,
    maskBrushSize: 1,
    maskTouched: false,
    maskUndoAvailable: false,
    maskCanvasRef: { current: null },
    handleImageSourceChange: vi.fn(),
    handleImageSourceDragEnter: vi.fn(),
    handleImageSourceDragOver: vi.fn(),
    handleImageSourceDragLeave: vi.fn(),
    handleImageSourceDrop: vi.fn(),
    handleImageSourcePaste: vi.fn(),
    setImageSource: vi.fn(),
    syncMaskCanvasSize: vi.fn(),
    reportImageSourcePreviewFailed: vi.fn(),
    startMaskStroke: vi.fn(),
    drawMaskStroke: vi.fn(),
    stopMaskStroke: vi.fn(),
    abandonMaskStrokeIfUncaptured: vi.fn(),
    handleMaskCanvasKeyDown: vi.fn(),
    setMaskBrushSize: vi.fn(),
    undoMaskCanvas: vi.fn(),
    clearMaskCanvas: vi.fn(),
  }),
}))

vi.mock('../../services/interactionFocus', () => ({
  restoreInteractionFocusTarget: () => null,
  scheduleInteractionFocus: () => undefined,
}))

vi.mock('../components/ConversationStarters', () => ({
  ConversationStarters: () => null,
}))

vi.mock('../components/ImageComposerPanel', () => ({
  ImageComposerPanel: () => null,
}))

vi.mock('../composerSubmission', () => ({
  appendAudioTranscript: (draft: string, transcript: string) =>
    `${draft}${transcript}`,
  clearSubmittedImageSourceIfCurrent: () => false,
  imageSubmissionOwnerMatches: () => true,
  resetComposerImageSourceForGeneration: () => undefined,
  runComposerSubmission: () => undefined,
  runImageSubmissionAfterPreparation: async () => undefined,
}))

vi.mock('../store', () => ({
  activeConversationOf: (data: typeof storeState.data) =>
    data.conversations[0] ?? null,
  appT: (_data: unknown, key: string) => key,
  useAppStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
}))

const { Composer } = await import('../components/Composer')

afterEach(() => {
  harness.reset()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Composer textarea layout caller', () => {
  it.each([
    ['zero', 0],
    ['negative', -4],
    ['NaN', Number.NaN],
    ['very large', 160],
  ])('normalizes %s scrollHeight through the real layout caller', (_label, scrollHeight) => {
    const getComputedStyle = vi.fn(() => ({
      fontSize: '15px',
      lineHeight: '20px',
      maxHeight: '114px',
      paddingTop: '6px',
      paddingBottom: '6px',
      borderTopWidth: '1px',
      borderBottomWidth: '1px',
    }))
    vi.stubGlobal('getComputedStyle', getComputedStyle)
    vi.stubGlobal('window', { getComputedStyle })

    const textarea = {
      scrollHeight,
      style: { height: '', overflowY: '' },
    }

    Composer({ disabled: false, streaming: false })
    harness.refs[0]!.current = textarea
    harness.effects.forEach((effect) => effect())

    expect(textarea.style.height).toBe(
      scrollHeight >= 160 ? '114px' : '34px',
    )
    expect(textarea.style.overflowY).toBe(
      scrollHeight >= 160 ? 'auto' : 'hidden',
    )
  })
})
