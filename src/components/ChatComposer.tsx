import { Image as ImageIcon, Mic, Send, Square } from 'lucide-react'
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  RefObject,
} from 'react'

import type { Translator } from '../i18n'
import { COMPOSER_MIN_ROWS } from '../services/composerLayout'
import type { ComposerMode, ImageTaskMode } from '../services/imageComposerChrome'
import { ComposerToolbar } from './ComposerToolbar'
import { AudioComposerPanel } from './AudioComposerPanel'
import { ImageComposerPanel } from './ImageComposerPanel'

interface ChatComposerProps {
  composerMode: ComposerMode
  imageTaskMode: ImageTaskMode
  generationActive: boolean
  draft: string
  composerCanSubmit: boolean
  composerUnavailableReason: string
  submitAccessibleLabel: string
  submitTitle: string
  inputPlaceholder: string
  submitLabel: string
  audioSourceFile: File | null
  audioSourceDragActive: boolean
  audioSourceDragRejected: boolean
  imageSourceFile: File | null
  imageSourceUrl: string
  imageSourceDragActive: boolean
  imageSourceDragRejected: boolean
  maskKeyboardCursor: { x: number; y: number }
  maskBrushSize: number
  maskTouched: boolean
  maskUndoAvailable: boolean
  t: Translator
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>
  maskCanvasRef: RefObject<HTMLCanvasElement | null>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onComposerModeChange: (mode: ComposerMode) => void
  onImageTaskModeChange: (mode: ImageTaskMode) => void
  onDraftChange: (value: string) => void
  onDraftKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onAudioSourceChange: (event: ChangeEvent<HTMLInputElement>) => void
  onAudioSourceDragEnter: (event: DragEvent<HTMLDivElement>) => void
  onAudioSourceDragOver: (event: DragEvent<HTMLDivElement>) => void
  onAudioSourceDragLeave: (event: DragEvent<HTMLDivElement>) => void
  onAudioSourceDrop: (event: DragEvent<HTMLDivElement>) => void
  onClearAudioSource: () => void
  onImageSourceChange: (event: ChangeEvent<HTMLInputElement>) => void
  onImageSourceDragEnter: (event: DragEvent<HTMLDivElement>) => void
  onImageSourceDragOver: (event: DragEvent<HTMLDivElement>) => void
  onImageSourceDragLeave: (event: DragEvent<HTMLDivElement>) => void
  onImageSourceDrop: (event: DragEvent<HTMLDivElement>) => void
  onImageSourcePaste: (event: ReactClipboardEvent<HTMLDivElement>) => void
  onClearImageSource: () => void
  onImagePreviewLoad: (image: HTMLImageElement) => void
  onImagePreviewError: () => void
  onMaskPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  onMaskPointerMove: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  onMaskPointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  onMaskPointerCaptureBoundary: (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => void
  onMaskKeyDown: (event: KeyboardEvent<HTMLCanvasElement>) => void
  onMaskBrushSizeChange: (value: number) => void
  onUndoMask: () => void
  onClearMask: () => void
  onStopGeneration: () => void
}

export function ChatComposer({
  composerMode,
  imageTaskMode,
  generationActive,
  draft,
  composerCanSubmit,
  composerUnavailableReason,
  submitAccessibleLabel,
  submitTitle,
  inputPlaceholder,
  submitLabel,
  audioSourceFile,
  audioSourceDragActive,
  audioSourceDragRejected,
  imageSourceFile,
  imageSourceUrl,
  imageSourceDragActive,
  imageSourceDragRejected,
  maskKeyboardCursor,
  maskBrushSize,
  maskTouched,
  maskUndoAvailable,
  t,
  composerTextareaRef,
  maskCanvasRef,
  onSubmit,
  onComposerModeChange,
  onImageTaskModeChange,
  onDraftChange,
  onDraftKeyDown,
  onAudioSourceChange,
  onAudioSourceDragEnter,
  onAudioSourceDragOver,
  onAudioSourceDragLeave,
  onAudioSourceDrop,
  onClearAudioSource,
  onImageSourceChange,
  onImageSourceDragEnter,
  onImageSourceDragOver,
  onImageSourceDragLeave,
  onImageSourceDrop,
  onImageSourcePaste,
  onClearImageSource,
  onImagePreviewLoad,
  onImagePreviewError,
  onMaskPointerDown,
  onMaskPointerMove,
  onMaskPointerUp,
  onMaskPointerCaptureBoundary,
  onMaskKeyDown,
  onMaskBrushSizeChange,
  onUndoMask,
  onClearMask,
  onStopGeneration,
}: ChatComposerProps): ReactElement {
  const stopTitle = t('button.stopGeneration')
  const sendButtonTooltip = composerCanSubmit
    ? submitTitle
    : composerUnavailableReason

  return (
    <form
      className={[
        'composer',
        `composer-${composerMode}`,
        composerMode === 'image' ? `composer-image-${imageTaskMode}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onSubmit={onSubmit}
    >
      <ComposerToolbar
        composerMode={composerMode}
        imageTaskMode={imageTaskMode}
        generationActive={generationActive}
        t={t}
        onComposerModeChange={onComposerModeChange}
        onImageTaskModeChange={onImageTaskModeChange}
      />

      {composerMode === 'image' && imageTaskMode !== 'generate' ? (
        <ImageComposerPanel
          imageTaskMode={imageTaskMode}
          generationActive={generationActive}
          imageSourceFile={imageSourceFile}
          imageSourceUrl={imageSourceUrl}
          imageSourceDragActive={imageSourceDragActive}
          imageSourceDragRejected={imageSourceDragRejected}
          maskKeyboardCursor={maskKeyboardCursor}
          maskBrushSize={maskBrushSize}
          maskTouched={maskTouched}
          maskUndoAvailable={maskUndoAvailable}
          t={t}
          maskCanvasRef={maskCanvasRef}
          onImageSourceChange={onImageSourceChange}
          onImageSourceDragEnter={onImageSourceDragEnter}
          onImageSourceDragOver={onImageSourceDragOver}
          onImageSourceDragLeave={onImageSourceDragLeave}
          onImageSourceDrop={onImageSourceDrop}
          onImageSourcePaste={onImageSourcePaste}
          onClearImageSource={onClearImageSource}
          onImagePreviewLoad={onImagePreviewLoad}
          onImagePreviewError={onImagePreviewError}
          onMaskPointerDown={onMaskPointerDown}
          onMaskPointerMove={onMaskPointerMove}
          onMaskPointerUp={onMaskPointerUp}
          onMaskPointerCaptureBoundary={onMaskPointerCaptureBoundary}
          onMaskKeyDown={onMaskKeyDown}
          onMaskBrushSizeChange={onMaskBrushSizeChange}
          onUndoMask={onUndoMask}
          onClearMask={onClearMask}
        />
      ) : null}

      {composerMode === 'audio' ? (
        <AudioComposerPanel
          audioSourceFile={audioSourceFile}
          audioSourceDragActive={audioSourceDragActive}
          audioSourceDragRejected={audioSourceDragRejected}
          generationActive={generationActive}
          t={t}
          onAudioSourceChange={onAudioSourceChange}
          onAudioSourceDragEnter={onAudioSourceDragEnter}
          onAudioSourceDragOver={onAudioSourceDragOver}
          onAudioSourceDragLeave={onAudioSourceDragLeave}
          onAudioSourceDrop={onAudioSourceDrop}
          onClearAudioSource={onClearAudioSource}
        />
      ) : null}

      <textarea
        ref={composerTextareaRef}
        data-composer-autosize="true"
        value={draft}
        rows={COMPOSER_MIN_ROWS}
        onChange={(event) => onDraftChange(event.target.value)}
        onKeyDown={onDraftKeyDown}
        placeholder={inputPlaceholder}
        aria-label={inputPlaceholder}
      />
      {generationActive ? (
        <span
          className="send-button-tooltip-target"
          data-tooltip={stopTitle}
        >
          <button
            className="send-button"
            type="button"
            aria-label={stopTitle}
            onClick={onStopGeneration}
          >
            <Square size={18} />
            {t('button.stop')}
          </button>
        </span>
      ) : (
        <span
          className="send-button-tooltip-target"
          data-tooltip={sendButtonTooltip}
        >
          <button
            className="send-button"
            type="submit"
            disabled={!composerCanSubmit}
            aria-label={submitAccessibleLabel}
          >
            {composerMode === 'image' ? (
              <ImageIcon size={18} />
            ) : composerMode === 'audio' ? (
              <Mic size={18} />
            ) : (
              <Send size={18} />
            )}
            {submitLabel}
          </button>
        </span>
      )}
    </form>
  )
}
