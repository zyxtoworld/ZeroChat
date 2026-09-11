import { ImagePlus, SendHorizonal, Square, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import {
  resolveLocale,
  translate,
  type TranslationKey,
  type Translator,
} from '../../i18n'
import { useAudioComposerController } from '../../services/audioComposerController'
import {
  restoreInteractionFocusTarget,
  scheduleInteractionFocus,
} from '../../services/interactionFocus'
import { resizeComposerTextarea } from '../../services/composerLayout'
import { ConversationStarters } from './ConversationStarters'
import { ImageComposerPanel } from './ImageComposerPanel'
import { useImageComposerController } from '../../services/imageComposerController'
import type { ComposerMode, ImageTaskMode } from '../../services/imageComposerChrome'
import {
  appendAudioTranscript,
  clearSubmittedImageSourceIfCurrent,
  imageSubmissionOwnerMatches,
  resetComposerImageSourceForGeneration,
  runImageSubmissionAfterPreparation,
  runComposerSubmission,
} from '../composerSubmission'
import { activeConversationOf, useAppStore, appT } from '../store'
import type { AppStringKey } from '../strings'

interface ComposerProps {
  disabled: boolean
  streaming: boolean
}

const panelTextKeys: Record<string, AppStringKey> = {
  'message.streaming': 'message.streaming',
  'button.undoMask': 'composer.undoMask',
  'notice.maskRequired': 'composer.maskRequired',
  'button.clearMask': 'composer.clearMask',
  'field.sourceImage': 'composer.chooseSource',
  'hint.sourceImagePaste': 'composer.chooseSource',
  'button.chooseImage': 'composer.chooseSource',
  'button.clearImage': 'composer.clearSource',
  'notice.imageRequired': 'composer.imageSourceRequired',
  'message.maskImage': 'composer.maskBrush',
  'hint.maskKeyboard': 'composer.maskBrush',
  'field.maskBrushSize': 'composer.maskBrush',
}

export function Composer({ disabled, streaming }: ComposerProps) {
  const data = useAppStore((s) => s.data)
  const images = useAppStore((s) => s.composerImages)
  const sending = useAppStore((s) => s.sending)
  const composerMode = useAppStore((s) => s.composerMode)
  const imageTaskMode = useAppStore((s) => s.imageTaskMode)
  const setComposerMode = useAppStore((s) => s.setComposerMode)
  const setImageTaskMode = useAppStore((s) => s.setImageTaskMode)
  const sendMessage = useAppStore((s) => s.sendMessage)
  const stopStreaming = useAppStore((s) => s.stopStreaming)
  const attachImage = useAppStore((s) => s.attachImage)
  const removeImage = useAppStore((s) => s.removeImage)
  const notify = useAppStore((s) => s.notify)
  const transcribeAudio = useAppStore((s) => s.transcribeAudio)
  const transcribingAudio = useAppStore((s) => s.transcribingAudio)
  const stopAudioTranscription = useAppStore((s) => s.stopAudioTranscription)

  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const attachImageButtonRef = useRef<HTMLButtonElement | null>(null)
  const audioSourceInputRef = useRef<HTMLInputElement | null>(null)
  const audioSelectButtonRef = useRef<HTMLButtonElement | null>(null)
  const generationActive = disabled || sending || submitting
  const modeSwitchingDisabled = generationActive || transcribingAudio
  const showConversationStarters =
    composerMode === 'chat' && activeConversationOf(data)?.messages.length === 0

  const t = (key: AppStringKey) => appT(data, key)
  const starterT: Translator = (key, values) =>
    translate(resolveLocale(data?.preferences.language), key, values)
  const panelT: Translator = (key: TranslationKey) =>
    t(panelTextKeys[key] ?? 'message.image')
  const modeSwitchingTooltip = transcribingAudio
    ? t('composer.audioTranscribing')
    : generationActive
      ? t('message.streaming')
      : undefined

  const removeComposerImage = (imageId: string) => {
    removeImage(imageId)
    scheduleInteractionFocus(() => attachImageButtonRef.current)
  }

  const imageComposer = useImageComposerController({
    generationActive,
    maskRequiredMessage: t('composer.maskRequired'),
    onClearNotice: () => undefined,
    onImageSourcePreviewFailed: () =>
      notify(t('composer.unsupportedImage'), 'error'),
    onUnsupportedImageSource: () =>
      notify(t('composer.unsupportedImage'), 'error'),
  })
  const { setImageSource } = imageComposer
  const composerInputResetGeneration = useAppStore(
    (s) => s.composerInputResetGeneration,
  )
  const seenComposerInputResetGenerationRef = useRef(
    composerInputResetGeneration,
  )
  useEffect(() => {
    resetComposerImageSourceForGeneration(
      seenComposerInputResetGenerationRef,
      composerInputResetGeneration,
      () => setImageSource(null),
    )
  }, [composerInputResetGeneration, setImageSource])
  const imageSourceFileRef = useRef(imageComposer.imageSourceFile)
  useLayoutEffect(() => {
    imageSourceFileRef.current = imageComposer.imageSourceFile
  }, [imageComposer.imageSourceFile])
  const audioComposer = useAudioComposerController({
    generationActive: generationActive || transcribingAudio,
    onClearNotice: () => undefined,
    onAudioSourceTooLarge: () => notify(t('composer.audioTooLarge'), 'error'),
    onUnsupportedAudioSource: () =>
      notify(t('composer.audioUnsupported'), 'error'),
  })

  const removeAudioSource = () => {
    audioComposer.setAudioSource(null)
    scheduleInteractionFocus(() => audioSelectButtonRef.current)
  }

  const autoSize = () => {
    resizeComposerTextarea(textareaRef.current)
  }

  useEffect(() => {
    autoSize()
  }, [draft])

  const canSend =
    !disabled &&
    !submitting &&
    (composerMode === 'audio'
      ? false
      : composerMode === 'image'
        ? draft.trim().length > 0
        : draft.trim().length > 0 || images.length > 0)

  const submit = () => {
    if (!canSend) return
    const text = draft
    if (composerMode === 'image') {
      const submittedSource = imageComposer.imageSourceFile
      const submittedState = useAppStore.getState()
      const submittedOwner = {
        conversationId: activeConversationOf(submittedState.data)?.id ?? null,
        resetGeneration: submittedState.composerInputResetGeneration,
        source: submittedSource,
      }
      void runComposerSubmission(
        text,
        async () => {
          return runImageSubmissionAfterPreparation(
            async () =>
              imageTaskMode === 'inpaint' && imageComposer.maskTouched
                ? imageComposer.maskFileFromCanvas()
                : null,
            () => {
              const currentState = useAppStore.getState()
              return imageSubmissionOwnerMatches(submittedOwner, {
                conversationId:
                  activeConversationOf(currentState.data)?.id ?? null,
                resetGeneration: currentState.composerInputResetGeneration,
                source: imageSourceFileRef.current,
              })
            },
            (resolvedMask) =>
              sendMessage(text, {
                mode: 'image',
                imageTaskMode,
                imageSourceFile: submittedSource,
                maskFile: resolvedMask,
              }),
          )
        },
        {
          mode: 'image',
          setDraft,
          setSubmitting,
          notify,
          onAccepted: () =>
            clearSubmittedImageSourceIfCurrent(
              submittedSource,
              imageSourceFileRef.current,
              () => imageComposer.setImageSource(null),
            ),
          translate: t,
        },
      )
      return
    }
    void runComposerSubmission(
      text,
      () => sendMessage(text),
      {
        mode: 'message',
        setDraft,
        setSubmitting,
        notify,
        translate: t,
      },
    )
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      e.key === 'Enter' &&
      (e.ctrlKey || e.metaKey) &&
      !e.shiftKey &&
      !e.nativeEvent.isComposing
    ) {
      e.preventDefault()
      submit()
    }
  }

  const onPickFiles = (list: FileList | null) => {
    if (!list) return
    for (const file of Array.from(list)) {
      void attachImage(file)
    }
  }

  const setMode = (mode: ComposerMode) => {
    if (modeSwitchingDisabled) return
    setComposerMode(mode)
  }

  const chooseConversationStarter = (prompt: string) => {
    setDraft(prompt)
    scheduleInteractionFocus(() => textareaRef.current)
  }

  const submitAudioTranscription = async () => {
    const file = audioComposer.audioSourceFile
    if (!file || generationActive || transcribingAudio) return
    const transcriptionFocusOwner = document.activeElement
    const transcript = await transcribeAudio(file)
    if (!transcript) return
    setDraft((current) => appendAudioTranscript(current, transcript))
    audioComposer.setAudioSource(null)
    setComposerMode('chat')
    scheduleInteractionFocus(() =>
      restoreInteractionFocusTarget({
        activeElement: document.activeElement,
        blocked: useAppStore.getState().settingsOpen,
        body: document.body,
        owner: transcriptionFocusOwner,
        target: textareaRef.current,
      }),
    )
  }

  return (
    <div className="zc-composer-wrap">
      {showConversationStarters && (
        <ConversationStarters
          disabled={generationActive}
          onChoose={chooseConversationStarter}
          t={starterT}
        />
      )}
      <div className="zc-composer composer">
        <div className="zc-composer-mode" role="group" aria-label={t('composer.modeImage')}>
          {(['chat', 'image', 'audio'] as ComposerMode[]).map((mode) => {
            const label =
              mode === 'chat'
                ? t('composer.modeChat')
                : mode === 'image'
                  ? t('composer.modeImage')
                  : t('composer.modeAudio')
            return (
              <span
                key={mode}
                className="composer-mode-tooltip-target"
                data-tooltip={modeSwitchingTooltip}
                tabIndex={modeSwitchingDisabled ? 0 : undefined}
                aria-label={
                  modeSwitchingDisabled && modeSwitchingTooltip
                    ? `${label}: ${modeSwitchingTooltip}`
                    : undefined
                }
              >
                <button
                  type="button"
                  data-zc-composer-mode={mode}
                  className={composerMode === mode ? 'active' : ''}
                  aria-pressed={composerMode === mode}
                  disabled={modeSwitchingDisabled}
                  onClick={() => setMode(mode)}
                >
                  {label}
                </button>
              </span>
            )
          })}
        </div>

        {composerMode === 'image' && (
          <>
            <div className="zc-image-task-modes" role="group" aria-label={t('composer.modeImage')}>
              {(['generate', 'edit', 'inpaint'] as ImageTaskMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={imageTaskMode === mode ? 'active' : ''}
                  aria-pressed={imageTaskMode === mode}
                  onClick={() => setImageTaskMode(mode)}
                  disabled={generationActive}
                >
                  {t(
                    mode === 'generate'
                      ? 'composer.imageGenerate'
                      : mode === 'edit'
                        ? 'composer.imageEdit'
                        : 'composer.imageInpaint',
                  )}
                </button>
              ))}
            </div>
            <ImageComposerPanel
              imageTaskMode={imageTaskMode}
              generationActive={generationActive}
              imageSourceFile={imageComposer.imageSourceFile}
              imageSourceUrl={imageComposer.imageSourceUrl}
              isCurrentImagePreview={imageComposer.isCurrentImagePreview}
              imageSourceDragActive={imageComposer.imageSourceDragActive}
              imageSourceDragRejected={imageComposer.imageSourceDragRejected}
              maskKeyboardCursor={imageComposer.maskKeyboardCursor}
              maskBrushSize={imageComposer.maskBrushSize}
              maskTouched={imageComposer.maskTouched}
              maskUndoAvailable={imageComposer.maskUndoAvailable}
              t={panelT}
              maskCanvasRef={imageComposer.maskCanvasRef}
              onImageSourceChange={imageComposer.handleImageSourceChange}
              onImageSourceDragEnter={imageComposer.handleImageSourceDragEnter}
              onImageSourceDragOver={imageComposer.handleImageSourceDragOver}
              onImageSourceDragLeave={imageComposer.handleImageSourceDragLeave}
              onImageSourceDrop={imageComposer.handleImageSourceDrop}
              onImageSourcePaste={imageComposer.handleImageSourcePaste}
              onClearImageSource={() => imageComposer.setImageSource(null)}
              onImagePreviewLoad={imageComposer.syncMaskCanvasSize}
              onImagePreviewError={imageComposer.reportImageSourcePreviewFailed}
              onMaskPointerDown={imageComposer.startMaskStroke}
              onMaskPointerMove={imageComposer.drawMaskStroke}
              onMaskPointerUp={imageComposer.stopMaskStroke}
              onMaskPointerCaptureBoundary={imageComposer.abandonMaskStrokeIfUncaptured}
              onMaskKeyDown={imageComposer.handleMaskCanvasKeyDown}
              onMaskBrushSizeChange={imageComposer.setMaskBrushSize}
              onUndoMask={imageComposer.undoMaskCanvas}
              onClearMask={imageComposer.clearMaskCanvas}
            />
          </>
        )}

        {composerMode === 'audio' && (
          <div
            className="zc-audio-composer"
            data-zc-audio-composer="true"
            data-drag-active={audioComposer.audioSourceDragActive || undefined}
            data-drag-rejected={audioComposer.audioSourceDragRejected || undefined}
            role="group"
            aria-label={t('composer.modeAudio')}
            onDragEnter={audioComposer.handleAudioSourceDragEnter}
            onDragOver={audioComposer.handleAudioSourceDragOver}
            onDragLeave={audioComposer.handleAudioSourceDragLeave}
            onDrop={audioComposer.handleAudioSourceDrop}
          >
            <input
              ref={audioSourceInputRef}
              id="zc-audio-source-input"
              type="file"
              accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/webm"
              hidden
              disabled={generationActive || transcribingAudio}
              onChange={audioComposer.handleAudioSourceChange}
            />
            <div className="zc-audio-source-copy">
              <strong>
                {audioComposer.audioSourceFile?.name ?? t('composer.audioDrop')}
              </strong>
              {audioComposer.audioSourceFile && (
                <span>{Math.max(1, Math.ceil(audioComposer.audioSourceFile.size / 1024))} KiB</span>
              )}
            </div>
            <div className="zc-row">
              <button
                ref={audioSelectButtonRef}
                type="button"
                className="zc-btn"
                data-zc-audio-select="true"
                disabled={generationActive || transcribingAudio}
                onClick={() => audioSourceInputRef.current?.click()}
              >
                {t('composer.audioSelect')}
              </button>
              {audioComposer.audioSourceFile && !transcribingAudio && (
                <button
                  type="button"
                  className="zc-btn"
                  data-zc-audio-remove="true"
                  onClick={removeAudioSource}
                >
                  {t('composer.audioRemove')}
                </button>
              )}
              {transcribingAudio ? (
                <button
                  type="button"
                  className="zc-btn"
                  onClick={stopAudioTranscription}
                >
                  {t('composer.stop')}
                </button>
              ) : (
                <button
                  type="button"
                  className="zc-btn primary"
                  data-zc-audio-transcribe="true"
                  disabled={!audioComposer.audioSourceFile || generationActive}
                  onClick={() => void submitAudioTranscription()}
                >
                  {t('composer.audioTranscribe')}
                </button>
              )}
            </div>
          </div>
        )}

        {composerMode === 'chat' && images.length > 0 && (
          <div className="zc-composer-images">
            {images.map((img) => (
              <div key={img.id} className="zc-thumb">
                <img src={img.dataUrl} alt={img.name || t('message.image')} />
                <button
                  type="button"
                  aria-label={t('composer.removeImage')}
                  data-tooltip={t('composer.removeImage')}
                  onClick={() => removeComposerImage(img.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="zc-composer-row">
          {composerMode === 'chat' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  onPickFiles(e.currentTarget.files)
                  e.currentTarget.value = ''
                }}
              />
              <button
                ref={attachImageButtonRef}
                type="button"
                className="zc-icon-btn"
                aria-label={t('composer.attachImage')}
                data-tooltip={t('composer.attachImage')}
                onClick={() => fileInputRef.current?.click()}
                disabled={generationActive}
              >
                <ImagePlus size={17} />
              </button>
            </>
          )}

            <textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            placeholder={t('composer.placeholder')}
            aria-label={t('composer.placeholder')}
            data-composer-autosize="true"
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={onKeyDown}
            disabled={disabled || submitting}
          />

          {streaming ? (
            <button
              type="button"
              className="zc-send-btn send-button stop"
              aria-label={t('composer.stop')}
              data-tooltip={t('composer.stop')}
              onClick={stopStreaming}
            >
              <Square size={15} />
            </button>
          ) : (
            <button
              type="submit"
              className="zc-send-btn send-button"
              aria-label={t('composer.send')}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              data-tooltip={t('composer.sendHint')}
              disabled={!canSend || sending || submitting}
              onClick={(e) => {
                e.preventDefault()
                submit()
              }}
            >
              <SendHorizonal size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
