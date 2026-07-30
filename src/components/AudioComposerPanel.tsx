import { Upload, X } from 'lucide-react'
import type {
  ChangeEvent,
  DragEvent,
  ReactElement,
} from 'react'
import { useId } from 'react'

import type { Translator } from '../i18n'
import { AUDIO_SOURCE_ACCEPT } from '../services/audioAttachments'

interface AudioComposerPanelProps {
  audioSourceDragActive: boolean
  audioSourceDragRejected: boolean
  audioSourceFile: File | null
  generationActive: boolean
  t: Translator
  onAudioSourceChange: (event: ChangeEvent<HTMLInputElement>) => void
  onAudioSourceDragEnter: (event: DragEvent<HTMLDivElement>) => void
  onAudioSourceDragLeave: (event: DragEvent<HTMLDivElement>) => void
  onAudioSourceDragOver: (event: DragEvent<HTMLDivElement>) => void
  onAudioSourceDrop: (event: DragEvent<HTMLDivElement>) => void
  onClearAudioSource: () => void
}

export function AudioComposerPanel({
  audioSourceDragActive,
  audioSourceDragRejected,
  audioSourceFile,
  generationActive,
  t,
  onAudioSourceChange,
  onAudioSourceDragEnter,
  onAudioSourceDragLeave,
  onAudioSourceDragOver,
  onAudioSourceDrop,
  onClearAudioSource,
}: AudioComposerPanelProps): ReactElement {
  const audioSourceHelpId = useId()

  return (
    <div className="audio-compose-panel">
      <div
        className="audio-source-panel"
        role="group"
        aria-describedby={audioSourceHelpId}
        aria-label={t('button.chooseAudio')}
        data-drag-active={audioSourceDragActive && !generationActive ? 0 : undefined}
        data-drag-rejected={audioSourceDragRejected && !generationActive ? 0 : undefined}
        onDragEnter={onAudioSourceDragEnter}
        onDragOver={onAudioSourceDragOver}
        onDragLeave={onAudioSourceDragLeave}
        onDrop={onAudioSourceDrop}
      >
        <div className="audio-source-actions">
          <label
            className={`file-button compact-button ${generationActive ? 'disabled' : ''}`}
            aria-disabled={generationActive}
          >
            <Upload size={15} />
            {t('button.chooseAudio')}
            <input
              type="file"
              accept={AUDIO_SOURCE_ACCEPT}
              onChange={onAudioSourceChange}
              disabled={generationActive}
            />
          </label>
          {audioSourceFile && (
            <button
              className="ghost-button compact-button"
              type="button"
              onClick={onClearAudioSource}
              disabled={generationActive}
            >
              <X size={15} />
              {t('button.clearAudio')}
            </button>
          )}
          <output
            className="audio-source-name"
            dir="auto"
          >
            {audioSourceFile ? audioSourceFile.name : t('notice.audioRequired')}
          </output>
        </div>
        <p id={audioSourceHelpId} className="audio-source-note">
          {t('hint.audioTranscription')}
        </p>
      </div>
    </div>
  )
}
