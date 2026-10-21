import { Check, Lightbulb } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import {
  resolveLocale,
  translate,
  type TranslationKey,
} from '../../i18n'
import {
  restoreInteractionFocusTarget,
  scheduleInteractionFocus,
} from '../../services/interactionFocus'
import type { FeatureHintId } from '../../types'
import { featureHintDismissed } from '../featureHints'
import { useAppStore } from '../store'

export function FeatureHint({
  id,
  restoreFocus,
}: {
  id: FeatureHintId
  restoreFocus: () => HTMLElement | null
}) {
  const data = useAppStore((state) => state.data)
  const dismissFeatureHint = useAppStore((state) => state.dismissFeatureHint)
  const [dismissing, setDismissing] = useState(false)
  const mountedRef = useRef(true)
  const dismissButtonRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  if (
    !data ||
    featureHintDismissed(data.preferences.dismissedFeatureHints, id)
  ) {
    return null
  }

  const locale = resolveLocale(data.preferences.language)
  const text = translate(locale, `featureHint.${id}` as TranslationKey)
  const dismissLabel = translate(locale, 'featureHint.dismiss')

  const dismiss = () => {
    if (dismissing) return
    const focusOwner = document.activeElement
    setDismissing(true)
    void dismissFeatureHint(id)
      .catch(() => false)
      .then((accepted) => {
        if (!mountedRef.current) return
        scheduleInteractionFocus(() =>
          restoreInteractionFocusTarget({
            activeElement: document.activeElement,
            blocked: false,
            body: document.body,
            owner: focusOwner,
            target: accepted ? restoreFocus() : dismissButtonRef.current,
          }),
        )
      })
      .finally(() => {
        if (mountedRef.current) setDismissing(false)
      })
  }

  return (
    <aside
      className="zc-feature-hint"
      data-feature-hint={id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <Lightbulb size={16} aria-hidden="true" />
      <p>{text}</p>
      <button
        ref={dismissButtonRef}
        type="button"
        className="zc-btn"
        disabled={dismissing}
        onClick={dismiss}
      >
        <span className="zc-feature-hint-action" data-centered-content="true">
          <Check size={15} aria-hidden="true" />
          {dismissLabel}
        </span>
      </button>
    </aside>
  )
}
