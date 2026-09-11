import { RotateCcw, Undo2, Upload, X } from 'lucide-react'
import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
  RefObject,
} from 'react'
import { useId, useRef } from 'react'

import type { Translator } from '../../i18n'
import type { ImageTaskMode } from '../../services/imageComposerChrome'
import { scheduleInteractionFocus } from '../../services/interactionFocus'

interface ImageComposerPanelProps {
  imageTaskMode: ImageTaskMode
  generationActive: boolean
  imageSourceFile: File | null
  imageSourceUrl: string
  imageSourceDragActive: boolean
  imageSourceDragRejected: boolean
  maskKeyboardCursor: { x: number; y: number }
  maskBrushSize: number
  maskTouched: boolean
  maskUndoAvailable: boolean
  t: Translator
  maskCanvasRef: RefObject<HTMLCanvasElement | null>
  onImageSourceChange: (event: ChangeEvent<HTMLInputElement>) => void
  isCurrentImagePreview: (
    image: Pick<HTMLImageElement, 'currentSrc' | 'src'>,
    renderedSourceUrl: string,
  ) => boolean
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
}

export function ImageComposerPanel({
  imageTaskMode,
  generationActive,
  imageSourceFile,
  imageSourceUrl,
  imageSourceDragActive,
  imageSourceDragRejected,
  isCurrentImagePreview,
  maskKeyboardCursor,
  maskBrushSize,
  maskTouched,
  maskUndoAvailable,
  t,
  maskCanvasRef,
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
}: ImageComposerPanelProps): ReactElement {
  const imageSourceHelpId = useId()
  const imageSourceInputRef = useRef<HTMLInputElement | null>(null)
  const imageSourceSelectButtonRef = useRef<HTMLButtonElement | null>(null)
  const maskUndoButtonRef = useRef<HTMLButtonElement | null>(null)

  const clearImageSource = () => {
    onClearImageSource()
    scheduleInteractionFocus(() => imageSourceSelectButtonRef.current)
  }

  const clearMask = () => {
    onClearMask()
    scheduleInteractionFocus(() => maskUndoButtonRef.current)
  }

  const undoMask = () => {
    onUndoMask()
    scheduleInteractionFocus(() => maskCanvasRef.current)
  }

  const maskUndoTooltip = generationActive
    ? t('message.streaming')
    : maskUndoAvailable
      ? t('button.undoMask')
      : t('notice.maskRequired')
  const maskClearTooltip = generationActive
    ? t('message.streaming')
    : maskTouched
      ? t('button.clearMask')
      : t('notice.maskRequired')

  return (
    <div className="image-compose-panel">
      <div
        className="image-source-panel"
        role="group"
        aria-describedby={imageSourceHelpId}
        aria-label={t('field.sourceImage')}
        data-drag-active={imageSourceDragActive && !generationActive ? 0 : undefined}
        data-drag-rejected={imageSourceDragRejected && !generationActive ? 0 : undefined}
        data-tooltip={t('hint.sourceImagePaste')}
        tabIndex={generationActive ? undefined : 0}
        onDragEnter={onImageSourceDragEnter}
        onDragOver={onImageSourceDragOver}
        onDragLeave={onImageSourceDragLeave}
        onDrop={onImageSourceDrop}
        onPaste={onImageSourcePaste}
      >
        <span id={imageSourceHelpId} className="sr-only">
          {t('hint.sourceImagePaste')}
        </span>
        <div className="image-source-actions">
          <button
            ref={imageSourceSelectButtonRef}
            type="button"
            data-zc-image-source-select="true"
            className={`file-button compact-button ${generationActive ? 'disabled' : ''}`}
            disabled={generationActive}
            onClick={() => imageSourceInputRef.current?.click()}
          >
            <Upload size={15} />
            {t('button.chooseImage')}
          </button>
          <input
            ref={imageSourceInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={onImageSourceChange}
            disabled={generationActive}
            hidden
          />
          {imageSourceFile && (
            <button
              className="ghost-button compact-button"
              type="button"
              onClick={clearImageSource}
              disabled={generationActive}
            >
              <X size={15} />
              {t('button.clearImage')}
            </button>
          )}
          <output className="image-source-name" dir="auto">
            {imageSourceFile ? imageSourceFile.name : t('notice.imageRequired')}
          </output>
        </div>
        {imageSourceUrl ? (
          <div
            className={`image-preview-stack ${
              imageTaskMode === 'inpaint' ? 'mask-editor' : ''
            }`}
          >
            <img
              key={`${imageTaskMode}:${imageSourceUrl}`}
              className="image-source-preview"
              src={imageSourceUrl}
              alt={t('field.sourceImage')}
              onError={(event) => {
                if (isCurrentImagePreview(event.currentTarget, imageSourceUrl)) {
                  onImagePreviewError()
                }
              }}
              onLoad={(event) => {
                if (
                  imageTaskMode === 'inpaint' &&
                  isCurrentImagePreview(event.currentTarget, imageSourceUrl)
                ) {
                  onImagePreviewLoad(event.currentTarget)
                }
              }}
              draggable={false}
            />
            {imageTaskMode === 'inpaint' ? (
              <>
                <canvas
                  ref={maskCanvasRef}
                  className="mask-canvas"
                  aria-label={t('message.maskImage')}
                  aria-describedby="mask-keyboard-help"
                  tabIndex={generationActive ? undefined : 0}
                  onPointerDown={onMaskPointerDown}
                  onPointerMove={onMaskPointerMove}
                  onPointerUp={onMaskPointerUp}
                  onPointerCancel={onMaskPointerUp}
                  onPointerOut={onMaskPointerCaptureBoundary}
                  onLostPointerCapture={onMaskPointerCaptureBoundary}
                  onKeyDown={onMaskKeyDown}
                />
                <span
                  className="mask-keyboard-cursor"
                  aria-hidden="true"
                  style={{
                    left: `${maskKeyboardCursor.x * 100}%`,
                    top: `${maskKeyboardCursor.y * 100}%`,
                  }}
                />
              </>
            ) : null}
          </div>
        ) : null}
        {imageTaskMode === 'inpaint' && imageSourceUrl ? (
          <div className="mask-controls">
            <span id="mask-keyboard-help" className="sr-only">
              {t('hint.maskKeyboard')}
            </span>
            <label>
              <span>{t('field.maskBrushSize')}</span>
              <input
                type="range"
                min="8"
                max="80"
                value={maskBrushSize}
                disabled={generationActive}
                onChange={(event) => onMaskBrushSizeChange(Number(event.target.value))}
              />
            </label>
            <span
              className="mask-action-tooltip-target"
              data-tooltip={maskUndoTooltip}
            >
              <button
                ref={maskUndoButtonRef}
                className="ghost-button compact-button"
                type="button"
                onClick={undoMask}
                data-mask-action="undo"
                data-tooltip={maskUndoTooltip}
                aria-describedby="mask-keyboard-help"
                disabled={generationActive || !maskUndoAvailable}
              >
                <Undo2 size={15} />
                {t('button.undoMask')}
              </button>
            </span>
            <span
              className="mask-action-tooltip-target"
              data-tooltip={maskClearTooltip}
            >
              <button
                className="ghost-button compact-button"
                type="button"
                onClick={clearMask}
                data-mask-action="clear"
                data-tooltip={maskClearTooltip}
                aria-describedby="mask-keyboard-help"
                disabled={generationActive || !maskTouched}
              >
                <RotateCcw size={15} />
                {t('button.clearMask')}
              </button>
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
