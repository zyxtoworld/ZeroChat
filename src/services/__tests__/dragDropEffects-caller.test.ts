import { afterEach, describe, expect, it, vi } from 'vitest'

import { installDragDropCancelListeners } from '../dragDropEffects'

type Effect = () => void | (() => void)

const harness = vi.hoisted(() => ({
  effects: [] as Effect[],
  stateUpdates: [] as unknown[],
  reset() {
    this.effects.length = 0
    this.stateUpdates.length = 0
  },
}))

vi.mock('react', () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  useEffect: (effect: Effect) => {
    harness.effects.push(effect)
  },
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => {
    let value = typeof initial === 'function' ? (initial as () => unknown)() : initial
    return [
      value,
      (next: unknown) => {
        value = typeof next === 'function' ? (next as (current: unknown) => unknown)(value) : next
        harness.stateUpdates.push(value)
      },
    ]
  },
}))

vi.mock('../imageAttachments', () => ({
  acceptedImageSourceFromClipboard: vi.fn(),
  acceptedImageSourceFromDrop: vi.fn(),
  dragHasAcceptedImageSource: () => true,
  isAcceptedImageSourceFile: () => false,
  namedPastedImageSource: vi.fn(),
  transferHasFile: () => true,
}))

vi.mock('../audioAttachments', () => ({
  acceptedAudioSourceFromDrop: vi.fn(),
  audioSourceFileRejection: () => null,
  dragHasAcceptedAudioSource: () => true,
  isAcceptedAudioSourceFile: () => false,
}))

const { useImageComposerController } = await import('../imageComposerController')
const { useAudioComposerController } = await import('../audioComposerController')

afterEach(() => {
  harness.reset()
  vi.unstubAllGlobals()
})

describe('drag effect lifecycle through the image Composer caller', () => {
  it('clears drag affordance when the window loses drag ownership', () => {
    const listeners = new Map<string, () => void>()
    const windowStub = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      }),
    }
    vi.stubGlobal('window', windowStub)

    const controller = useImageComposerController({
      generationActive: false,
      maskRequiredMessage: 'mask required',
      onClearNotice: vi.fn(),
      onImageSourcePreviewFailed: vi.fn(),
      onUnsupportedImageSource: vi.fn(),
    })
    const cleanups = harness.effects
      .map((effect) => effect())
      .filter((cleanup): cleanup is () => void => typeof cleanup === 'function')

    controller.handleImageSourceDragEnter({
      dataTransfer: { dropEffect: 'none' },
      preventDefault: vi.fn(),
    } as never)

    expect(harness.stateUpdates).toContain(true)
    expect(listeners.has('blur')).toBe(true)
    expect(listeners.has('dragend')).toBe(true)

    listeners.get('blur')?.()
    expect(harness.stateUpdates).toContain(false)

    for (const cleanup of cleanups) cleanup()
    expect(listeners).toHaveLength(0)
  })
})

describe('drag effect listener registration', () => {
  it('rolls back a partial window registration failure', () => {
    const listeners = new Map<string, () => void>()
    const windowStub = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        if (type === 'dragend') {
          throw new Error('dragend unavailable')
        }
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      }),
    }
    vi.stubGlobal('window', windowStub)

    expect(() => installDragDropCancelListeners(vi.fn())).not.toThrow()
    expect(windowStub.removeEventListener).toHaveBeenCalledWith(
      'blur',
      expect.any(Function),
    )
    expect(listeners).toHaveLength(0)
  })
})

describe('drag effect lifecycle through the audio Composer caller', () => {
  it('clears drag affordance on dragend and removes listeners on cleanup', () => {
    const listeners = new Map<string, () => void>()
    const windowStub = {
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener)
      }),
      removeEventListener: vi.fn((type: string, listener: () => void) => {
        if (listeners.get(type) === listener) listeners.delete(type)
      }),
    }
    vi.stubGlobal('window', windowStub)

    const controller = useAudioComposerController({
      generationActive: false,
      onAudioSourceTooLarge: vi.fn(),
      onClearNotice: vi.fn(),
      onUnsupportedAudioSource: vi.fn(),
    })
    const cleanups = harness.effects
      .map((effect) => effect())
      .filter((cleanup): cleanup is () => void => typeof cleanup === 'function')

    controller.handleAudioSourceDragEnter({
      dataTransfer: { dropEffect: 'none' },
      preventDefault: vi.fn(),
    } as never)

    expect(harness.stateUpdates).toContain(true)
    expect(listeners.has('blur')).toBe(true)
    expect(listeners.has('dragend')).toBe(true)

    listeners.get('dragend')?.()
    expect(harness.stateUpdates).toContain(false)

    for (const cleanup of cleanups) cleanup()
    expect(listeners).toHaveLength(0)
  })
})
