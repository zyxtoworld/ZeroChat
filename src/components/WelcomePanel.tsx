import {
  Code2,
  Languages,
  Lightbulb,
  Mail,
  Settings,
} from 'lucide-react'
import type {
  MouseEvent,
  ReactElement,
} from 'react'
import type { Translator } from '../i18n'
import type { ComposerMode } from '../services/imageComposerChrome'
import { AppLogo } from './AppLogo'

interface WelcomePanelProps {
  mode: ComposerMode
  t: Translator
  title: string
  hint: string
  setupRequired: boolean
  onOpenSettings: (event: MouseEvent<HTMLButtonElement>) => void
  onApplyPrompt: (prompt: string) => void
}

export function WelcomePanel({
  mode,
  t,
  title,
  hint,
  setupRequired,
  onOpenSettings,
  onApplyPrompt,
}: WelcomePanelProps): ReactElement {
  const promptCards = [
    {
      id: 'code',
      label: t('welcome.quickPrompt.code'),
      prompt: t('welcome.quickPrompt.codePrompt'),
      icon: <Code2 size={18} />,
    },
    {
      id: 'email',
      label: t('welcome.quickPrompt.email'),
      prompt: t('welcome.quickPrompt.emailPrompt'),
      icon: <Mail size={18} />,
    },
    {
      id: 'translate',
      label: t('welcome.quickPrompt.translate'),
      prompt: t('welcome.quickPrompt.translatePrompt'),
      icon: <Languages size={18} />,
    },
    {
      id: 'brainstorm',
      label: t('welcome.quickPrompt.brainstorm'),
      prompt: t('welcome.quickPrompt.brainstormPrompt'),
      icon: <Lightbulb size={18} />,
    },
  ]

  return (
    <div className="welcome-panel">
      <AppLogo size="welcome" />
      <h2>{title}</h2>
      <p>{hint}</p>
      {setupRequired ? (
        <div className="welcome-actions">
          <button
            className="primary-button"
            type="button"
            data-settings-opener="true"
            onClick={onOpenSettings}
          >
            <Settings size={16} />
            {t('button.openSettings')}
          </button>
        </div>
      ) : null}
      {mode === 'chat' && !setupRequired ? (
        <div
          className="welcome-prompts"
          role="group"
          aria-label={t('welcome.quickPromptGroup')}
        >
          {promptCards.map((card) => {
            const actionLabel = t('welcome.quickPromptUse', {
              prompt: card.label,
            })

            return (
              <button
                className="welcome-prompt-card"
                type="button"
                data-welcome-prompt={card.id}
                key={card.id}
                data-tooltip={actionLabel}
                aria-label={actionLabel}
                onClick={() => onApplyPrompt(card.prompt)}
              >
                <span className="welcome-prompt-icon" aria-hidden="true">
                  {card.icon}
                </span>
                <span>{card.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
