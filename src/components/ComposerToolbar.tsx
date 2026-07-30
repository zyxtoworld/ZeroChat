import { Bot, Image as ImageIcon, Mic } from 'lucide-react'
import type { ReactElement } from 'react'

import type { Translator } from '../i18n'
import {
  IMAGE_TASK_MODES,
  imageModeLabel,
  imageModeShortLabel,
  type ComposerMode,
  type ImageTaskMode,
} from '../services/imageComposerChrome'

interface ComposerToolbarProps {
  composerMode: ComposerMode
  imageTaskMode: ImageTaskMode
  generationActive: boolean
  t: Translator
  onComposerModeChange: (mode: ComposerMode) => void
  onImageTaskModeChange: (mode: ImageTaskMode) => void
}

const COMPOSER_MODE_BUTTONS = [
  { Icon: Bot, labelKey: 'mode.chat', mode: 'chat' },
  { Icon: ImageIcon, labelKey: 'mode.image', mode: 'image' },
  { Icon: Mic, labelKey: 'mode.audio', mode: 'audio' },
] as const satisfies readonly {
  Icon: typeof Bot
  labelKey: string
  mode: ComposerMode
}[]

export function ComposerToolbar({
  composerMode,
  imageTaskMode,
  generationActive,
  t,
  onComposerModeChange,
  onImageTaskModeChange,
}: ComposerToolbarProps): ReactElement {
  const streamingTooltip = generationActive ? t('message.streaming') : ''

  return (
    <div className="composer-toolbar" role="group" aria-label={t('field.composeMode')}>
      {COMPOSER_MODE_BUTTONS.map(({ Icon, labelKey, mode }) => {
        const active = composerMode === mode
        const label = t(labelKey)
        const tooltip = streamingTooltip || label

        return (
          <span
            className="composer-mode-tooltip-target"
            data-tooltip={tooltip}
            key={mode}
          >
            <button
              className={active ? 'active' : ''}
              data-compose-mode={mode}
              type="button"
              aria-pressed={active}
              disabled={generationActive}
              onClick={() => onComposerModeChange(mode)}
            >
              <Icon size={15} />
              {label}
            </button>
          </span>
        )
      })}
      {composerMode === 'image' ? (
        <div className="image-mode-tabs" role="group" aria-label={t('mode.image')}>
          {IMAGE_TASK_MODES.map((mode) => {
            const label = imageModeLabel(t, mode)
            const shortLabel = imageModeShortLabel(t, mode)
            const tooltip = generationActive ? t('message.streaming') : label

            return (
              <span
                className="composer-mode-tooltip-target"
                data-tooltip={tooltip}
                key={mode}
              >
                <button
                  className={imageTaskMode === mode ? 'active' : ''}
                  type="button"
                  data-image-task-mode={mode}
                  aria-pressed={imageTaskMode === mode}
                  aria-label={label}
                  disabled={generationActive}
                  onClick={() => onImageTaskModeChange(mode)}
                >
                  <span className="image-mode-label-full" aria-hidden="true">
                    {label}
                  </span>
                  <span className="image-mode-label-compact" aria-hidden="true">
                    {shortLabel}
                  </span>
                </button>
              </span>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
