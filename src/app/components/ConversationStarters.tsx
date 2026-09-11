import type { TranslationKey, Translator } from '../../i18n'

interface ConversationStartersProps {
  disabled: boolean
  onChoose: (prompt: string) => void
  t: Translator
}

const starters = [
  {
    id: 'brainstorm',
    label: 'welcome.quickPrompt.brainstorm',
    prompt: 'welcome.quickPrompt.brainstormPrompt',
  },
  {
    id: 'code',
    label: 'welcome.quickPrompt.code',
    prompt: 'welcome.quickPrompt.codePrompt',
  },
  {
    id: 'email',
    label: 'welcome.quickPrompt.email',
    prompt: 'welcome.quickPrompt.emailPrompt',
  },
  {
    id: 'translate',
    label: 'welcome.quickPrompt.translate',
    prompt: 'welcome.quickPrompt.translatePrompt',
  },
] as const satisfies ReadonlyArray<{
  id: string
  label: TranslationKey
  prompt: TranslationKey
}>

export function ConversationStarters({
  disabled,
  onChoose,
  t,
}: ConversationStartersProps) {
  return (
    <div
      className="zc-conversation-starters"
      data-conversation-starters="true"
      role="group"
      aria-label={t('welcome.quickPromptGroup')}
    >
      {starters.map((starter) => (
        <button
          key={starter.id}
          data-conversation-starter={starter.id}
          type="button"
          disabled={disabled}
          onClick={() => onChoose(t(starter.prompt))}
        >
          <span>{t(starter.label)}</span>
        </button>
      ))}
    </div>
  )
}
