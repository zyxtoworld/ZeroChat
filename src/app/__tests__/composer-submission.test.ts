import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAppTranslator } from '../i18n'
import {
  appendAudioTranscript,
  clearSubmittedImageSourceIfCurrent,
  imageSubmissionOwnerMatches,
  resetComposerImageSourceForGeneration,
  runImageSubmissionAfterPreparation,
  runComposerSubmission,
} from '../composerSubmission'
import composerSource from '../components/Composer.tsx?raw'

describe('composer submission', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the draft, localizes unexpected failures, and releases submitting state', async () => {
    const sentinel = 'C:\\Users\\private\\request.json sk-test-secret-1234567890'
    const state = { draft: 'Keep this draft', submitting: false }
    const notify = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const onAccepted = vi.fn()
    let rejectRequest: ((error: Error) => void) | undefined
    const request = new Promise<boolean>((_, reject) => {
      rejectRequest = reject
    })
    const run = runComposerSubmission(
      state.draft,
      () => request,
      {
        mode: 'message',
        setDraft: (value) => {
          state.draft =
            typeof value === 'function' ? value(state.draft) : value
        },
        setSubmitting: (value) => {
          state.submitting = value
        },
        notify,
        onAccepted,
        translate: createAppTranslator('zh'),
      },
    )

    expect(state.submitting).toBe(true)
    expect(state.draft).toBe('Keep this draft')

    rejectRequest?.(new Error(sentinel))
    await expect(run).resolves.toBe(false)

    expect(state).toEqual({ draft: 'Keep this draft', submitting: false })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('发送失败', 'error')
    expect(notify.mock.calls.flat().join(' ')).not.toContain(sentinel)
    expect(onAccepted).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('[app] message submission failed')
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(sentinel)
  })

  it('contains notification failures at the submission boundary', async () => {
    const state = { draft: 'Keep this draft', submitting: false }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const notify = vi.fn(() => {
      throw new Error('notification channel failed')
    })

    await expect(
      runComposerSubmission(
        state.draft,
        async () => {
          throw new Error('request failed')
        },
        {
          mode: 'message',
          setDraft: (value) => {
            state.draft =
              typeof value === 'function' ? value(state.draft) : value
          },
          setSubmitting: (value) => {
            state.submitting = value
          },
          notify,
          translate: createAppTranslator('zh'),
        },
      ),
    ).resolves.toBe(false)

    expect(state).toEqual({ draft: 'Keep this draft', submitting: false })
    expect(notify).toHaveBeenCalledWith('发送失败', 'error')
    expect(consoleError).toHaveBeenCalledWith('[app] message submission failed')
    expect(consoleError).toHaveBeenCalledWith(
      '[app] message submission failure notification failed',
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('notification channel failed')
  })

  it('clears only the draft and image source owned by the accepted submission', async () => {
    const submittedSource = new File(['submitted'], 'submitted.png', {
      type: 'image/png',
    })
    const newerSource = new File(['newer'], 'newer.png', { type: 'image/png' })
    const state = {
      draft: 'submitted prompt',
      source: submittedSource as File | null,
      submitting: false,
    }
    const clearSource = vi.fn(() => {
      state.source = null
    })
    const actions = {
      mode: 'image' as const,
      setDraft: (value: string | ((current: string) => string)) => {
        state.draft = typeof value === 'function' ? value(state.draft) : value
      },
      setSubmitting: (value: boolean) => {
        state.submitting = value
      },
      notify: vi.fn(),
      onAccepted: () => {
        clearSubmittedImageSourceIfCurrent(
          submittedSource,
          state.source,
          clearSource,
        )
      },
      translate: createAppTranslator('en'),
    }

    await expect(
      runComposerSubmission('submitted prompt', async () => true, actions),
    ).resolves.toBe(true)
    expect(state).toEqual({ draft: '', source: null, submitting: false })
    expect(clearSource).toHaveBeenCalledTimes(1)

    state.draft = 'submitted prompt'
    state.source = submittedSource
    clearSource.mockClear()
    await expect(
      runComposerSubmission(
        'submitted prompt',
        async () => {
          state.draft = 'newer draft'
          state.source = newerSource
          return true
        },
        actions,
      ),
    ).resolves.toBe(true)
    expect(state).toEqual({
      draft: 'newer draft',
      source: newerSource,
      submitting: false,
    })
    expect(clearSource).not.toHaveBeenCalled()
  })

  it('does not submit a prepared image after its conversation owner changes', async () => {
    let releasePreparation!: (value: File) => void
    const prepared = new Promise<File>((resolve) => {
      releasePreparation = resolve
    })
    let currentConversationId = 'conversation-a'
    const submit = vi.fn(async () => true)

    const submission = runImageSubmissionAfterPreparation(
      () => prepared,
      () => currentConversationId === 'conversation-a',
      submit,
    )

    currentConversationId = 'conversation-b'
    releasePreparation(new File(['mask'], 'mask.png', { type: 'image/png' }))

    await expect(submission).resolves.toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })

  it('does not submit a prepared image after replacement changes its owner generation', async () => {
    const submittedSource = new File(['source'], 'source.png', {
      type: 'image/png',
    })
    let releasePreparation!: (value: File) => void
    const prepared = new Promise<File>((resolve) => {
      releasePreparation = resolve
    })
    const submittedOwner = {
      conversationId: 'conversation-same-id',
      resetGeneration: 0,
      source: submittedSource,
    }
    const currentOwner = { ...submittedOwner }
    const submit = vi.fn(async () => true)

    const submission = runImageSubmissionAfterPreparation(
      () => prepared,
      () => imageSubmissionOwnerMatches(submittedOwner, currentOwner),
      submit,
    )

    currentOwner.resetGeneration += 1
    releasePreparation(new File(['mask'], 'mask.png', { type: 'image/png' }))

    await expect(submission).resolves.toBe(false)
    expect(submit).not.toHaveBeenCalled()
  })

  it('contains a stale image preparation failure after replacement changes its owner', async () => {
    const sentinel = 'C:\\private\\stale-mask sk-image-secret-1234567890'
    let releaseFailure!: (error: Error) => void
    let ownerCurrent = true
    const notify = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const submission = runComposerSubmission(
      'stale image prompt',
      () =>
        runImageSubmissionAfterPreparation(
          () =>
            new Promise<File>((_resolve, reject) => {
              releaseFailure = reject
            }),
          () => ownerCurrent,
          vi.fn(async () => true),
        ),
      {
        mode: 'image',
        setDraft: vi.fn(),
        setSubmitting: vi.fn(),
        notify,
        translate: createAppTranslator('en'),
      },
    )

    ownerCurrent = false
    releaseFailure(new Error(sentinel))

    await expect(submission).resolves.toBe(false)
    expect(notify).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('clears a local image source once for each Composer reset generation', () => {
    const owner = { current: 0 }
    const clearSource = vi.fn()

    resetComposerImageSourceForGeneration(owner, 0, clearSource)
    resetComposerImageSourceForGeneration(owner, 1, clearSource)
    resetComposerImageSourceForGeneration(owner, 1, clearSource)
    resetComposerImageSourceForGeneration(owner, 2, clearSource)

    expect(owner.current).toBe(2)
    expect(clearSource).toHaveBeenCalledTimes(2)
  })

  it('contains accepted-input cleanup failures after the durable send succeeds', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const notify = vi.fn()

    await expect(
      runComposerSubmission('sent', async () => true, {
        mode: 'image',
        setDraft: vi.fn(),
        setSubmitting: vi.fn(),
        notify,
        onAccepted: () => {
          throw new Error('cleanup sentinel')
        },
        translate: createAppTranslator('en'),
      }),
    ).resolves.toBe(true)

    expect(notify).not.toHaveBeenCalled()
    expect(consoleError).toHaveBeenCalledWith('[app] accepted image submission cleanup failed')
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('cleanup sentinel')
  })

  it('appends a transcript to the latest draft available when transcription finishes', () => {
    expect(appendAudioTranscript('newer draft  ', ' transcript text ')).toBe(
      'newer draft\ntranscript text',
    )
    expect(appendAudioTranscript('', ' transcript text ')).toBe('transcript text')
  })

  it('does not restore a completed transcription behind Settings or over newer focus', () => {
    expect(composerSource).toContain(
      'const transcriptionFocusOwner = document.activeElement',
    )
    expect(composerSource).toContain('restoreInteractionFocusTarget({')
    expect(composerSource).toContain(
      'blocked: useAppStore.getState().settingsOpen',
    )
    expect(composerSource).toContain('owner: transcriptionFocusOwner')
    expect(composerSource).toContain('target: textareaRef.current')
  })

  it('keeps the component wired to the sanitized submission boundary', () => {
    expect(composerSource).toContain('runComposerSubmission(')
    expect(composerSource).not.toMatch(/notify\(\s*error(?:\.message|\b)/)
  })

  it('restores the stable attachment action after removing a Composer image', () => {
    expect(composerSource).toContain(
      'const attachImageButtonRef = useRef<HTMLButtonElement | null>(null)',
    )
    expect(composerSource).toContain(
      'removeImage(imageId)\n    scheduleInteractionFocus(() => attachImageButtonRef.current)',
    )
    expect(composerSource).toContain('onClick={() => removeComposerImage(img.id)}')
    expect(composerSource).toContain('ref={attachImageButtonRef}')
  })

  it('uses a real audio selection button and restores it after source removal', () => {
    expect(composerSource).toContain(
      'const audioSelectButtonRef = useRef<HTMLButtonElement | null>(null)',
    )
    expect(composerSource).toContain('data-zc-audio-select="true"')
    expect(composerSource).toContain('data-zc-audio-remove="true"')
    expect(composerSource).toContain(
      'audioComposer.setAudioSource(null)\n    scheduleInteractionFocus(() => audioSelectButtonRef.current)',
    )
    expect(composerSource).not.toContain(
      '<label className="zc-btn" htmlFor="zc-audio-source-input">',
    )
  })
})
