import type { ReactElement } from 'react'

import { ChatComposer } from './ChatComposer'
import { clearComposerSectionNotice } from './ChatPaneComposerSectionNotice'
import type { ChatPaneViewProps } from './ChatPaneTypes'

type ChatPaneComposerSectionProps = Pick<
  ChatPaneViewProps,
  | 'composerMode'
  | 'imageTaskMode'
  | 'generationActive'
  | 'draft'
  | 'composerChrome'
  | 'audioSourceDragActive'
  | 'audioSourceDragRejected'
  | 'audioSourceFile'
  | 'imageSourceFile'
  | 'imageSourceUrl'
  | 'imageSourceDragActive'
  | 'imageSourceDragRejected'
  | 'maskKeyboardCursor'
  | 'maskBrushSize'
  | 'maskTouched'
  | 'maskUndoAvailable'
  | 't'
  | 'composerTextareaRef'
  | 'maskCanvasRef'
  | 'sendMessage'
  | 'setComposerMode'
  | 'closeChatModelMenu'
  | 'setNotice'
  | 'handleAudioSourceChange'
  | 'handleAudioSourceDragEnter'
  | 'handleAudioSourceDragOver'
  | 'handleAudioSourceDragLeave'
  | 'handleAudioSourceDrop'
  | 'setAudioSource'
  | 'setImageTaskMode'
  | 'abandonMaskStrokeIfUncaptured'
  | 'setDraft'
  | 'handleDraftKeyDown'
  | 'handleImageSourceChange'
  | 'handleImageSourceDragEnter'
  | 'handleImageSourceDragOver'
  | 'handleImageSourceDragLeave'
  | 'handleImageSourceDrop'
  | 'handleImageSourcePaste'
  | 'reportImageSourcePreviewFailed'
  | 'setImageSource'
  | 'syncMaskCanvasSize'
  | 'startMaskStroke'
  | 'drawMaskStroke'
  | 'stopMaskStroke'
  | 'handleMaskCanvasKeyDown'
  | 'setMaskBrushSize'
  | 'undoMaskCanvas'
  | 'clearMaskCanvas'
  | 'stopGeneration'
>

export function ChatPaneComposerSection({
  composerMode,
  imageTaskMode,
  generationActive,
  draft,
  composerChrome,
  audioSourceDragActive,
  audioSourceDragRejected,
  audioSourceFile,
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
  sendMessage,
  setComposerMode,
  closeChatModelMenu,
  setNotice,
  handleAudioSourceChange,
  handleAudioSourceDragEnter,
  handleAudioSourceDragOver,
  handleAudioSourceDragLeave,
  handleAudioSourceDrop,
  setAudioSource,
  setImageTaskMode,
  abandonMaskStrokeIfUncaptured,
  setDraft,
  handleDraftKeyDown,
  handleImageSourceChange,
  handleImageSourceDragEnter,
  handleImageSourceDragOver,
  handleImageSourceDragLeave,
  handleImageSourceDrop,
  handleImageSourcePaste,
  reportImageSourcePreviewFailed,
  setImageSource,
  syncMaskCanvasSize,
  startMaskStroke,
  drawMaskStroke,
  stopMaskStroke,
  handleMaskCanvasKeyDown,
  setMaskBrushSize,
  undoMaskCanvas,
  clearMaskCanvas,
  stopGeneration,
}: ChatPaneComposerSectionProps): ReactElement {
  return (
    <ChatComposer
      composerMode={composerMode}
      imageTaskMode={imageTaskMode}
      generationActive={generationActive}
      draft={draft}
      composerCanSubmit={composerChrome.composerCanSubmit}
      composerUnavailableReason={composerChrome.composerUnavailableReason}
      submitAccessibleLabel={composerChrome.submitAccessibleLabel}
      submitTitle={composerChrome.submitTitle}
      inputPlaceholder={composerChrome.inputPlaceholder}
      submitLabel={composerChrome.submitButtonLabel}
      audioSourceFile={audioSourceFile}
      audioSourceDragActive={audioSourceDragActive}
      audioSourceDragRejected={audioSourceDragRejected}
      imageSourceFile={imageSourceFile}
      imageSourceUrl={imageSourceUrl}
      imageSourceDragActive={imageSourceDragActive}
      imageSourceDragRejected={imageSourceDragRejected}
      maskKeyboardCursor={maskKeyboardCursor}
      maskBrushSize={maskBrushSize}
      maskTouched={maskTouched}
      maskUndoAvailable={maskUndoAvailable}
      t={t}
      composerTextareaRef={composerTextareaRef}
      maskCanvasRef={maskCanvasRef}
      onSubmit={sendMessage}
      onComposerModeChange={(mode) => {
        setComposerMode(mode)
        closeChatModelMenu()
        clearComposerSectionNotice(setNotice)
      }}
      onImageTaskModeChange={(mode) => {
        setImageTaskMode(mode)
        clearComposerSectionNotice(setNotice)
      }}
      onDraftChange={setDraft}
      onDraftKeyDown={handleDraftKeyDown}
      onAudioSourceChange={handleAudioSourceChange}
      onAudioSourceDragEnter={handleAudioSourceDragEnter}
      onAudioSourceDragOver={handleAudioSourceDragOver}
      onAudioSourceDragLeave={handleAudioSourceDragLeave}
      onAudioSourceDrop={handleAudioSourceDrop}
      onClearAudioSource={() => setAudioSource(null)}
      onImageSourceChange={handleImageSourceChange}
      onImageSourceDragEnter={handleImageSourceDragEnter}
      onImageSourceDragOver={handleImageSourceDragOver}
      onImageSourceDragLeave={handleImageSourceDragLeave}
      onImageSourceDrop={handleImageSourceDrop}
      onImageSourcePaste={handleImageSourcePaste}
      onClearImageSource={() => setImageSource(null)}
      onImagePreviewLoad={syncMaskCanvasSize}
      onImagePreviewError={() => {
        setImageSource(null)
        reportImageSourcePreviewFailed()
      }}
      onMaskPointerDown={startMaskStroke}
      onMaskPointerMove={drawMaskStroke}
      onMaskPointerUp={stopMaskStroke}
      onMaskPointerCaptureBoundary={abandonMaskStrokeIfUncaptured}
      onMaskKeyDown={handleMaskCanvasKeyDown}
      onMaskBrushSizeChange={setMaskBrushSize}
      onUndoMask={undoMaskCanvas}
      onClearMask={clearMaskCanvas}
      onStopGeneration={stopGeneration}
    />
  )
}
