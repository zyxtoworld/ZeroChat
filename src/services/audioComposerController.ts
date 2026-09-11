import type {
  ChangeEvent,
  DragEvent,
} from 'react'
import {
  useCallback,
  useEffect,
  useState,
} from 'react'

import {
  acceptedAudioSourceFromDrop,
  audioSourceFileRejection,
  type AudioSourceFileRejection,
  dragHasAcceptedAudioSource,
  isAcceptedAudioSourceFile,
} from './audioAttachments'
import {
  installDragDropCancelListeners,
  setDataTransferDropEffect,
} from './dragDropEffects'
import { transferHasFile } from './imageAttachments'

interface UseAudioComposerControllerOptions {
  generationActive: boolean
  onClearNotice: () => void
  onAudioSourceTooLarge: () => void
  onUnsupportedAudioSource: () => void
}

interface UseAudioComposerControllerResult {
  audioSourceDragActive: boolean
  audioSourceDragRejected: boolean
  audioSourceFile: File | null
  handleAudioSourceChange: (event: ChangeEvent<HTMLInputElement>) => void
  handleAudioSourceDragEnter: (event: DragEvent<HTMLDivElement>) => void
  handleAudioSourceDragLeave: (event: DragEvent<HTMLDivElement>) => void
  handleAudioSourceDragOver: (event: DragEvent<HTMLDivElement>) => void
  handleAudioSourceDrop: (event: DragEvent<HTMLDivElement>) => void
  setAudioSource: (file: File | null) => void
}

interface AudioSourcePickerSelection {
  blocked: boolean
  file: File | null
  rejection: AudioSourceFileRejection | null
}

interface AudioSourceDragState {
  active: boolean
  rejected: boolean
}

export function acceptedAudioSourceFromPicker(
  files: FileList | null | undefined,
): File | null {
  return Array.from(files ?? []).find(isAcceptedAudioSourceFile) ?? null
}

export function audioSourceDragStateForGeneration(
  current: AudioSourceDragState,
  generationActive: boolean,
): AudioSourceDragState {
  return generationActive ? { active: false, rejected: false } : current
}

export function audioSourcePickerSelection(
  files: FileList | null | undefined,
  generationActive: boolean,
): AudioSourcePickerSelection {
  if (generationActive) {
    return { blocked: true, file: null, rejection: null }
  }

  const candidates = Array.from(files ?? [])
  const file = candidates.find(isAcceptedAudioSourceFile) ?? null
  const rejection = file
    ? null
    : candidates.some(
        (candidate) => audioSourceFileRejection(candidate) === 'too-large',
      )
      ? 'too-large'
      : candidates.length > 0
        ? 'unsupported'
        : null

  return {
    blocked: false,
    file,
    rejection,
  }
}

export function useAudioComposerController({
  generationActive,
  onAudioSourceTooLarge,
  onClearNotice,
  onUnsupportedAudioSource,
}: UseAudioComposerControllerOptions): UseAudioComposerControllerResult {
  const [audioSourceFile, setAudioSourceFile] = useState<File | null>(null)
  const [audioSourceDragActive, setAudioSourceDragActive] = useState(false)
  const [audioSourceDragRejected, setAudioSourceDragRejected] = useState(false)
  const [audioSourceDragInvalidated, setAudioSourceDragInvalidated] =
    useState(false)
  const [previousAudioGenerationActive, setPreviousAudioGenerationActive] =
    useState(generationActive)

  if (previousAudioGenerationActive !== generationActive) {
    setPreviousAudioGenerationActive(generationActive)
    if (generationActive) {
      setAudioSourceDragInvalidated(true)
    }
  }

  const setAudioSource = useCallback((file: File | null): void => {
    setAudioSourceDragInvalidated(false)
    setAudioSourceFile(file)
    setAudioSourceDragActive(false)
    setAudioSourceDragRejected(false)
  }, [])

  useEffect(
    () =>
      installDragDropCancelListeners(() => {
        setAudioSourceDragActive(false)
        setAudioSourceDragRejected(false)
      }),
    [],
  )

  const reportAudioSourceRejection = useCallback(
    (rejection: AudioSourceFileRejection | null): void => {
      if (rejection === 'too-large') {
        onAudioSourceTooLarge()
      } else if (rejection === 'unsupported') {
        onUnsupportedAudioSource()
      }
    },
    [onAudioSourceTooLarge, onUnsupportedAudioSource],
  )

  const handleAudioSourceChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const selection = audioSourcePickerSelection(event.target.files, generationActive)

      if (selection.blocked) {
        event.target.value = ''
        return
      }

      if (!selection.file) {
        reportAudioSourceRejection(selection.rejection)
        event.target.value = ''
        return
      }

      onClearNotice()
      setAudioSource(selection.file)
      event.target.value = ''
    },
    [generationActive, onClearNotice, reportAudioSourceRejection, setAudioSource],
  )

  const handleAudioSourceDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (generationActive || !transferHasFile(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      setAudioSourceDragInvalidated(false)
      const accepted = dragHasAcceptedAudioSource(event.dataTransfer)
      setDataTransferDropEffect(event.dataTransfer, accepted ? 'copy' : 'none')
      setAudioSourceDragActive(accepted)
      setAudioSourceDragRejected(!accepted)
    },
    [generationActive],
  )

  const handleAudioSourceDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      if (generationActive || !transferHasFile(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      setAudioSourceDragInvalidated(false)
      const accepted = dragHasAcceptedAudioSource(event.dataTransfer)
      setDataTransferDropEffect(event.dataTransfer, accepted ? 'copy' : 'none')
      setAudioSourceDragActive(accepted)
      setAudioSourceDragRejected(!accepted)
    },
    [generationActive],
  )

  const handleAudioSourceDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      const nextTarget = event.relatedTarget

      if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
        return
      }

      setAudioSourceDragActive(false)
      setAudioSourceDragRejected(false)
    },
    [],
  )

  const handleAudioSourceDrop = useCallback(
    (event: DragEvent<HTMLDivElement>): void => {
      event.preventDefault()
      setAudioSourceDragActive(false)
      setAudioSourceDragRejected(false)

      if (generationActive) {
        return
      }

      const hasFile = transferHasFile(event.dataTransfer)
      const file = acceptedAudioSourceFromDrop(event.dataTransfer)

      if (!file) {
        if (hasFile) {
          const selection = audioSourcePickerSelection(
            event.dataTransfer.files,
            false,
          )
          reportAudioSourceRejection(selection.rejection ?? 'unsupported')
        }
        return
      }

      onClearNotice()
      setAudioSource(file)
    },
    [generationActive, onClearNotice, reportAudioSourceRejection, setAudioSource],
  )

  const visibleAudioSourceDragState = audioSourceDragStateForGeneration(
    { active: audioSourceDragActive, rejected: audioSourceDragRejected },
    generationActive || audioSourceDragInvalidated,
  )

  return {
    audioSourceDragActive: visibleAudioSourceDragState.active,
    audioSourceDragRejected: visibleAudioSourceDragState.rejected,
    audioSourceFile,
    handleAudioSourceChange,
    handleAudioSourceDragEnter,
    handleAudioSourceDragLeave,
    handleAudioSourceDragOver,
    handleAudioSourceDrop,
    setAudioSource,
  }
}
