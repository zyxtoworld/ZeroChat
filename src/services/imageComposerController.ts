import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent,
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  acceptedImageSourceFromClipboard,
  acceptedImageSourceFromDrop,
  dragHasAcceptedImageSource,
  isAcceptedImageSourceFile,
  namedPastedImageSource,
  transferHasFile,
} from './imageAttachments'
import {
  installDragDropCancelListeners,
  setDataTransferDropEffect,
} from './dragDropEffects'

export interface MaskKeyboardCursor {
  x: number
  y: number
}

export const INITIAL_MASK_KEYBOARD_CURSOR: MaskKeyboardCursor = {
  x: 0.5,
  y: 0.5,
}
export const MASK_KEYBOARD_STEP = 0.035
export const MASK_KEYBOARD_LARGE_STEP = 0.1

interface MaskPointerStartEventLike {
  button: number
  isPrimary: boolean
  pointerId: number
}

export function maskPointerCanStartStroke(
  event: MaskPointerStartEventLike,
  activePointerId: number | null,
): boolean {
  return activePointerId === null && event.button === 0 && event.isPrimary
}

export function maskPointerOwnsStroke(
  activePointerId: number | null,
  eventPointerId: number,
): boolean {
  return activePointerId !== null && activePointerId === eventPointerId
}

interface MaskPointerStopEventLike {
  currentTarget: Pick<
    HTMLCanvasElement,
    'hasPointerCapture' | 'releasePointerCapture'
  >
  pointerId: number
}

interface MaskPointerCaptureStateEventLike {
  currentTarget: Pick<HTMLCanvasElement, 'hasPointerCapture'>
  pointerId: number
}

export function abandonUncapturedMaskPointerStroke(
  activePointerId: number | null,
  event: MaskPointerCaptureStateEventLike,
): number | null {
  if (!maskPointerOwnsStroke(activePointerId, event.pointerId)) {
    return activePointerId
  }

  try {
    return event.currentTarget.hasPointerCapture(event.pointerId)
      ? activePointerId
      : null
  } catch {
    return null
  }
}

export function stopOwnedMaskPointerStroke(
  activePointerId: number | null,
  event: MaskPointerStopEventLike,
): number | null {
  if (!maskPointerOwnsStroke(activePointerId, event.pointerId)) {
    return activePointerId
  }

  try {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  } catch {
    // Keep pointer cleanup best-effort for synthetic QA events.
  }

  return null
}

interface UseImageComposerControllerOptions {
  generationActive: boolean
  maskRequiredMessage: string
  onClearNotice: () => void
  onImageSourcePreviewFailed: () => void
  onUnsupportedImageSource: () => void
}

interface UseImageComposerControllerResult {
  abandonMaskStrokeIfUncaptured: (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => void
  clearMaskCanvas: () => void
  drawMaskStroke: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  handleImageSourceChange: (event: ChangeEvent<HTMLInputElement>) => void
  handleImageSourceDragEnter: (event: DragEvent<HTMLDivElement>) => void
  handleImageSourceDragLeave: (event: DragEvent<HTMLDivElement>) => void
  handleImageSourceDragOver: (event: DragEvent<HTMLDivElement>) => void
  handleImageSourceDrop: (event: DragEvent<HTMLDivElement>) => void
  handleImageSourcePaste: (event: ReactClipboardEvent<HTMLDivElement>) => void
  handleMaskCanvasKeyDown: (event: KeyboardEvent<HTMLCanvasElement>) => void
  imageSourceDragActive: boolean
  imageSourceDragRejected: boolean
  imageSourceFile: File | null
  imageSourceUrl: string
  isCurrentImagePreview: (
    image: Pick<HTMLImageElement, 'currentSrc' | 'src'>,
    renderedSourceUrl: string,
  ) => boolean
  maskBrushSize: number
  maskCanvasRef: RefObject<HTMLCanvasElement | null>
  maskFileFromCanvas: () => Promise<File>
  maskKeyboardCursor: MaskKeyboardCursor
  maskTouched: boolean
  maskUndoAvailable: boolean
  reportImageSourcePreviewFailed: () => void
  setImageSource: (file: File | null) => void
  setMaskBrushSize: (value: number) => void
  startMaskStroke: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  stopMaskStroke: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  syncMaskCanvasSize: (image: HTMLImageElement) => void
  undoMaskCanvas: () => void
}

interface ImageSourcePickerSelection {
  blocked: boolean
  file: File | null
  unsupported: boolean
}

interface ImageSourceDragState {
  active: boolean
  rejected: boolean
}

export function clampMaskKeyboardRatio(value: number): number {
  return Math.min(0.98, Math.max(0.02, value))
}

export function imageDataHasMaskPaint(imageData: ImageData): boolean {
  for (let index = 3; index < imageData.data.length; index += 4) {
    if (imageData.data[index] > 0) {
      return true
    }
  }

  return false
}

export function acceptedImageSourceFromPicker(
  files: FileList | null | undefined,
): File | null {
  return Array.from(files ?? []).find(isAcceptedImageSourceFile) ?? null
}

export function imageSourceDragStateForGeneration(
  current: ImageSourceDragState,
  generationActive: boolean,
): ImageSourceDragState {
  return generationActive ? { active: false, rejected: false } : current
}

export function imageSourcePickerSelection(
  files: FileList | null | undefined,
  generationActive: boolean,
): ImageSourcePickerSelection {
  if (generationActive) {
    return { blocked: true, file: null, unsupported: false }
  }

  const hasFile = (files?.length ?? 0) > 0
  const file = acceptedImageSourceFromPicker(files)

  return {
    blocked: false,
    file,
    unsupported: hasFile && !file,
  }
}

export function imageSourcePreviewUrl(file: File | null): string {
  return file ? URL.createObjectURL(file) : ''
}

export function imagePreviewBelongsToSource(
  image: Pick<HTMLImageElement, 'currentSrc' | 'src'>,
  sourceUrl: string,
): boolean {
  if (!sourceUrl) {
    return false
  }

  return (image.currentSrc || image.src) === sourceUrl
}

export function imagePreviewBelongsToCurrentSource(
  image: Pick<HTMLImageElement, 'currentSrc' | 'src'>,
  renderedSourceUrl: string,
  currentSourceUrl: string,
): boolean {
  return (
    renderedSourceUrl.length > 0 &&
    renderedSourceUrl === currentSourceUrl &&
    imagePreviewBelongsToSource(image, renderedSourceUrl)
  )
}

export function revokeImageSourcePreviewUrl(url: string): boolean {
  if (!url) {
    return true
  }

  try {
    URL.revokeObjectURL(url)
    return true
  } catch {
    // Preview URL cleanup is best-effort; image selection state already owns the user-visible result.
    return false
  }
}

export function replaceOwnedImageSourcePreviewUrl(
  owner: { current: string },
  file: File | null,
): string {
  const nextUrl = imageSourcePreviewUrl(file)
  const previousUrl = owner.current
  owner.current = nextUrl
  revokeImageSourcePreviewUrl(previousUrl)
  return nextUrl
}

export function releaseOwnedImageSourcePreviewUrl(owner: {
  current: string
}): boolean {
  const url = owner.current
  owner.current = ''
  return revokeImageSourcePreviewUrl(url)
}

export function useImageComposerController({
  generationActive,
  maskRequiredMessage,
  onClearNotice,
  onImageSourcePreviewFailed,
  onUnsupportedImageSource,
}: UseImageComposerControllerOptions): UseImageComposerControllerResult {
  const [imageSourceFile, setImageSourceFile] = useState<File | null>(null)
  const [imageSourceUrl, setImageSourceUrl] = useState('')
  const imageSourceUrlOwnerRef = useRef('')
  const [imageSourceDragActive, setImageSourceDragActive] = useState(false)
  const [imageSourceDragRejected, setImageSourceDragRejected] = useState(false)
  const [imageSourceDragInvalidated, setImageSourceDragInvalidated] =
    useState(false)
  const [previousImageGenerationActive, setPreviousImageGenerationActive] =
    useState(generationActive)
  const [maskTouched, setMaskTouched] = useState(false)
  const [maskUndoAvailable, setMaskUndoAvailable] = useState(false)
  const [maskBrushSize, setMaskBrushSize] = useState(36)
  const [maskKeyboardCursor, setMaskKeyboardCursor] = useState<MaskKeyboardCursor>(
    INITIAL_MASK_KEYBOARD_CURSOR,
  )
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const maskDrawingPointerIdRef = useRef<number | null>(null)
  const maskKeyboardCursorRef =
    useRef<MaskKeyboardCursor>(INITIAL_MASK_KEYBOARD_CURSOR)
  const maskUndoStackRef = useRef<ImageData[]>([])

  if (previousImageGenerationActive !== generationActive) {
    setPreviousImageGenerationActive(generationActive)
    if (generationActive) {
      setImageSourceDragInvalidated(true)
    }
  }

  useEffect(() => {
    maskDrawingPointerIdRef.current = null
  }, [generationActive])

  useEffect(
    () => () => {
      releaseOwnedImageSourcePreviewUrl(imageSourceUrlOwnerRef)
    },
    [],
  )

  const clearImageSourceDragState = useCallback(() => {
    setImageSourceDragActive(false)
    setImageSourceDragRejected(false)
  }, [])

  useEffect(
    () => installDragDropCancelListeners(clearImageSourceDragState),
    [clearImageSourceDragState],
  )

  const resetMaskKeyboardCursor = useCallback(() => {
    maskKeyboardCursorRef.current = INITIAL_MASK_KEYBOARD_CURSOR
    setMaskKeyboardCursor(INITIAL_MASK_KEYBOARD_CURSOR)
  }, [])

  const resetMaskUndoStack = useCallback(() => {
    maskUndoStackRef.current = []
    setMaskUndoAvailable(false)
  }, [])

  const setImageSource = useCallback(
    (file: File | null): void => {
      setImageSourceDragInvalidated(false)
      maskDrawingPointerIdRef.current = null
      let nextImageSourceUrl: string

      try {
        nextImageSourceUrl = replaceOwnedImageSourcePreviewUrl(
          imageSourceUrlOwnerRef,
          file,
        )
      } catch {
        setImageSourceDragActive(false)
        setImageSourceDragRejected(false)
        onImageSourcePreviewFailed()
        return
      }

      setImageSourceFile(file)
      setImageSourceUrl(nextImageSourceUrl)
      setImageSourceDragActive(false)
      setImageSourceDragRejected(false)
      setMaskTouched(false)
      resetMaskKeyboardCursor()
      resetMaskUndoStack()
    },
    [
      onImageSourcePreviewFailed,
      resetMaskKeyboardCursor,
      resetMaskUndoStack,
    ],
  )

  const isCurrentImagePreview = useCallback(
    (
      image: Pick<HTMLImageElement, 'currentSrc' | 'src'>,
      renderedSourceUrl: string,
    ): boolean =>
      imagePreviewBelongsToCurrentSource(
        image,
        renderedSourceUrl,
        imageSourceUrlOwnerRef.current,
      ),
    [],
  )

  const pushMaskUndoSnapshot = useCallback(
    (canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void => {
      const snapshot = context.getImageData(0, 0, canvas.width, canvas.height)
      maskUndoStackRef.current = [...maskUndoStackRef.current.slice(-19), snapshot]
      setMaskUndoAvailable(true)
    },
    [],
  )

  const handleImageSourceChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const selection = imageSourcePickerSelection(event.target.files, generationActive)

      if (selection.blocked) {
        event.target.value = ''
        return
      }

      if (!selection.file) {
        if (selection.unsupported) {
          onUnsupportedImageSource()
        }
        event.target.value = ''
        return
      }

      onClearNotice()
      setImageSource(selection.file)
      event.target.value = ''
    },
    [generationActive, onClearNotice, onUnsupportedImageSource, setImageSource],
  )

  const handleImageSourceDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (generationActive || !transferHasFile(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      setImageSourceDragInvalidated(false)
      const accepted = dragHasAcceptedImageSource(event.dataTransfer)
      setDataTransferDropEffect(event.dataTransfer, accepted ? 'copy' : 'none')
      setImageSourceDragActive(accepted)
      setImageSourceDragRejected(!accepted)
    },
    [generationActive],
  )

  const handleImageSourceDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (generationActive || !transferHasFile(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      setImageSourceDragInvalidated(false)
      const accepted = dragHasAcceptedImageSource(event.dataTransfer)
      setDataTransferDropEffect(event.dataTransfer, accepted ? 'copy' : 'none')
      setImageSourceDragActive(accepted)
      setImageSourceDragRejected(!accepted)
    },
    [generationActive],
  )

  const handleImageSourceDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      const nextTarget = event.relatedTarget

      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return
      }

      setImageSourceDragActive(false)
      setImageSourceDragRejected(false)
    },
    [],
  )

  const handleImageSourceDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault()
      setImageSourceDragActive(false)
      setImageSourceDragRejected(false)

      if (generationActive) {
        return
      }

      const hasFile = transferHasFile(event.dataTransfer)
      const file = acceptedImageSourceFromDrop(event.dataTransfer)

      if (!file) {
        if (hasFile) {
          onUnsupportedImageSource()
        }
        return
      }

      onClearNotice()
      setImageSource(file)
    },
    [generationActive, onClearNotice, onUnsupportedImageSource, setImageSource],
  )

  const handleImageSourcePaste = useCallback(
    (event: ReactClipboardEvent<HTMLDivElement>): void => {
      if (generationActive) {
        return
      }

      const file = acceptedImageSourceFromClipboard(event.clipboardData)

      if (!file) {
        if (transferHasFile(event.clipboardData)) {
          event.preventDefault()
          onUnsupportedImageSource()
        }
        return
      }

      event.preventDefault()
      onClearNotice()
      setImageSource(namedPastedImageSource(file))
    },
    [generationActive, onClearNotice, onUnsupportedImageSource, setImageSource],
  )

  const syncMaskCanvasSize = useCallback(
    (image: HTMLImageElement): void => {
      const canvas = maskCanvasRef.current

      if (!canvas) {
        return
      }

      maskDrawingPointerIdRef.current = null
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      const context = canvas.getContext('2d')
      context?.clearRect(0, 0, canvas.width, canvas.height)
      setMaskTouched(false)
      resetMaskKeyboardCursor()
      resetMaskUndoStack()
    },
    [resetMaskKeyboardCursor, resetMaskUndoStack],
  )

  const clearMaskCanvas = useCallback((): void => {
    const canvas = maskCanvasRef.current
    const context = canvas?.getContext('2d')

    if (!canvas || !context || generationActive || !maskTouched) {
      return
    }

    pushMaskUndoSnapshot(canvas, context)
    context.clearRect(0, 0, canvas.width, canvas.height)
    setMaskTouched(false)
  }, [generationActive, maskTouched, pushMaskUndoSnapshot])

  const undoMaskCanvas = useCallback((): void => {
    if (generationActive) {
      return
    }

    const canvas = maskCanvasRef.current
    const context = canvas?.getContext('2d')
    const previous = maskUndoStackRef.current.at(-1)

    if (!canvas || !context || !previous) {
      return
    }

    maskUndoStackRef.current = maskUndoStackRef.current.slice(0, -1)
    context.putImageData(previous, 0, 0)
    setMaskTouched(imageDataHasMaskPaint(previous))
    setMaskUndoAvailable(maskUndoStackRef.current.length > 0)
  }, [generationActive])

  const paintMaskPoint = useCallback(
    (context: CanvasRenderingContext2D, x: number, y: number): void => {
      const radius = Math.max(4, maskBrushSize)

      context.fillStyle = 'rgba(79, 184, 156, 0.62)'
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
      setMaskTouched(true)
    },
    [maskBrushSize],
  )

  const drawMaskStroke = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (
        generationActive ||
        !maskPointerOwnsStroke(
          maskDrawingPointerIdRef.current,
          event.pointerId,
        )
      ) {
        return
      }

      const canvas = event.currentTarget
      const context = canvas.getContext('2d')

      if (!context) {
        return
      }

      const rect = canvas.getBoundingClientRect()
      const x = ((event.clientX - rect.left) / rect.width) * canvas.width
      const y = ((event.clientY - rect.top) / rect.height) * canvas.height

      paintMaskPoint(context, x, y)
    },
    [generationActive, paintMaskPoint],
  )

  const paintMaskAtKeyboardCursor = useCallback((): void => {
    if (generationActive) {
      return
    }

    const canvas = maskCanvasRef.current
    const context = canvas?.getContext('2d')

    if (!canvas || !context) {
      return
    }

    pushMaskUndoSnapshot(canvas, context)
    const cursor = maskKeyboardCursorRef.current
    paintMaskPoint(context, cursor.x * canvas.width, cursor.y * canvas.height)
  }, [generationActive, paintMaskPoint, pushMaskUndoSnapshot])

  const moveMaskKeyboardCursor = useCallback((deltaX: number, deltaY: number): void => {
    setMaskKeyboardCursor((cursor) => ({
      x: clampMaskKeyboardRatio(cursor.x + deltaX),
      y: clampMaskKeyboardRatio(cursor.y + deltaY),
    }))
    maskKeyboardCursorRef.current = {
      x: clampMaskKeyboardRatio(maskKeyboardCursorRef.current.x + deltaX),
      y: clampMaskKeyboardRatio(maskKeyboardCursorRef.current.y + deltaY),
    }
  }, [])

  const handleMaskCanvasKeyDown = useCallback(
    (event: KeyboardEvent<HTMLCanvasElement>): void => {
      if (generationActive) {
        return
      }

      const step = event.shiftKey ? MASK_KEYBOARD_LARGE_STEP : MASK_KEYBOARD_STEP

      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        moveMaskKeyboardCursor(-step, 0)
        return
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault()
        moveMaskKeyboardCursor(step, 0)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        moveMaskKeyboardCursor(0, -step)
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        moveMaskKeyboardCursor(0, step)
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        paintMaskAtKeyboardCursor()
      }
    },
    [generationActive, moveMaskKeyboardCursor, paintMaskAtKeyboardCursor],
  )

  const startMaskStroke = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      if (
        generationActive ||
        !maskPointerCanStartStroke(event, maskDrawingPointerIdRef.current)
      ) {
        return
      }

      const canvas = event.currentTarget
      const context = canvas.getContext('2d')

      if (!context) {
        return
      }

      pushMaskUndoSnapshot(canvas, context)
      maskDrawingPointerIdRef.current = event.pointerId
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Synthetic QA pointer events and some embedded WebViews can reject capture.
      }
      drawMaskStroke(event)
    },
    [drawMaskStroke, generationActive, pushMaskUndoSnapshot],
  )

  const stopMaskStroke = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      maskDrawingPointerIdRef.current = stopOwnedMaskPointerStroke(
        maskDrawingPointerIdRef.current,
        event,
      )
    },
    [],
  )

  const abandonMaskStrokeIfUncaptured = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): void => {
      maskDrawingPointerIdRef.current = abandonUncapturedMaskPointerStroke(
        maskDrawingPointerIdRef.current,
        event,
      )
    },
    [],
  )

  const maskFileFromCanvas = useCallback(async (): Promise<File> => {
    const canvas = maskCanvasRef.current
    const context = canvas?.getContext('2d')

    if (!canvas || !context) {
      throw new Error(maskRequiredMessage)
    }

    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = canvas.width
    maskCanvas.height = canvas.height
    const maskContext = maskCanvas.getContext('2d')

    if (!maskContext) {
      throw new Error(maskRequiredMessage)
    }

    const overlay = context.getImageData(0, 0, canvas.width, canvas.height)
    const mask = maskContext.createImageData(canvas.width, canvas.height)

    for (let index = 0; index < overlay.data.length; index += 4) {
      const painted = overlay.data[index + 3] > 0
      mask.data[index] = 0
      mask.data[index + 1] = 0
      mask.data[index + 2] = 0
      mask.data[index + 3] = painted ? 0 : 255
    }

    maskContext.putImageData(mask, 0, 0)

    return new Promise((resolve, reject) => {
      maskCanvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error(maskRequiredMessage))
          return
        }

        resolve(new File([blob], 'zerochat-mask.png', { type: 'image/png' }))
      }, 'image/png')
    })
  }, [maskRequiredMessage])

  const visibleImageSourceDragState = imageSourceDragStateForGeneration(
    { active: imageSourceDragActive, rejected: imageSourceDragRejected },
    generationActive || imageSourceDragInvalidated,
  )

  return {
    abandonMaskStrokeIfUncaptured,
    clearMaskCanvas,
    drawMaskStroke,
    handleImageSourceChange,
    handleImageSourceDragEnter,
    handleImageSourceDragLeave,
    handleImageSourceDragOver,
    handleImageSourceDrop,
    handleImageSourcePaste,
    handleMaskCanvasKeyDown,
    imageSourceDragActive: visibleImageSourceDragState.active,
    imageSourceDragRejected: visibleImageSourceDragState.rejected,
    imageSourceFile,
    imageSourceUrl,
    isCurrentImagePreview,
    maskBrushSize,
    maskCanvasRef,
    maskFileFromCanvas,
    maskKeyboardCursor,
    maskTouched,
    maskUndoAvailable,
    reportImageSourcePreviewFailed: onImageSourcePreviewFailed,
    setImageSource,
    setMaskBrushSize,
    startMaskStroke,
    stopMaskStroke,
    syncMaskCanvasSize,
    undoMaskCanvas,
  }
}
