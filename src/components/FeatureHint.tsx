import { Check, Lightbulb } from 'lucide-react'
import type {
  MouseEvent as ReactMouseEvent,
  ReactElement,
} from 'react'
import type {
  Translator,
  TranslationKey,
} from '../i18n'
import { CHAT_MODEL_MENU_ITEM_SELECTOR } from '../services/chatModelMenu'
import type { FeatureHintPlacement } from '../services/featureHints'
import { scheduleInteractionFocus } from '../services/interactionFocus'
import type { FeatureHintId } from '../types'

interface FeatureHintProps {
  id: FeatureHintId
  placement: FeatureHintPlacement
  t: Translator
  onDismiss: (id: FeatureHintId) => void
}

export function FeatureHint({
  id,
  placement,
  t,
  onDismiss,
}: FeatureHintProps): ReactElement {
  const menuHint = placement === 'menu'
  const descriptionId = `feature-hint-${id}-description`

  function handleDismiss(event: ReactMouseEvent<HTMLButtonElement>): void {
    const menu = menuHint
      ? event.currentTarget.closest<HTMLElement>('[role="menu"]')
      : null

    onDismiss(id)

    if (menu) {
      scheduleInteractionFocus(() =>
        menu.querySelector<HTMLElement>(CHAT_MODEL_MENU_ITEM_SELECTOR),
      )
    }
  }

  return (
    <aside
      className={`feature-hint feature-hint-${placement}`}
      data-feature-hint={id}
      role={menuHint ? 'none' : 'status'}
      aria-live={menuHint ? undefined : 'polite'}
      aria-atomic={menuHint ? undefined : 'true'}
    >
      <span className="feature-hint-icon" aria-hidden="true">
        <Lightbulb size={16} />
      </span>
      <p id={descriptionId}>{t(`featureHint.${id}` as TranslationKey)}</p>
      <button
        className="ghost-button compact-button feature-hint-dismiss"
        type="button"
        role={menuHint ? 'menuitem' : undefined}
        aria-describedby={menuHint ? descriptionId : undefined}
        onClick={handleDismiss}
      >
        <Check size={15} />
        {t('featureHint.dismiss')}
      </button>
    </aside>
  )
}
