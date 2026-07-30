import {
  Check,
  RefreshCw,
} from 'lucide-react'
import type { ReactElement } from 'react'
import type { Translator } from '../i18n'
import type { AppData } from '../types'

interface FirstRunGuideActionsProps {
  data: AppData
  t: Translator
  checkingProviderId: string
  guideCanFinish: boolean
  guideRequirement: string
  guideRequirementId?: string
  guideCheckingProvider: boolean
  guideSuccessPending: boolean
  onCloseGuide: () => void
  onFinishGuide: (localOnly?: boolean) => void | Promise<void>
}

async function runFirstRunGuideAction(
  action: () => void | Promise<void>,
): Promise<void> {
  try {
    await action()
  } catch {
    // The controller owns user-facing guide errors; this leaf boundary prevents leaks.
  }
}

export function FirstRunGuideActions({
  data,
  t,
  checkingProviderId,
  guideCanFinish,
  guideRequirement,
  guideRequirementId,
  guideCheckingProvider,
  guideSuccessPending,
  onCloseGuide,
  onFinishGuide,
}: FirstRunGuideActionsProps): ReactElement {
  const guideBusyHintId = 'guide-check-busy'
  const guideDoneLabel = guideCheckingProvider
    ? t('button.checking')
    : guideSuccessPending
      ? t('button.connected')
      : t('button.done')
  const guideCheckInProgress = Boolean(checkingProviderId)
  const guideBlockedByOtherCheck = guideCheckInProgress && !guideCheckingProvider
  const guideDoneTooltip = !guideCanFinish
    ? guideRequirement || t('guide.requirement.setup')
    : guideCheckingProvider
      ? t('button.checking')
      : guideBlockedByOtherCheck
        ? t('guide.requirement.waitForCheck')
        : guideDoneLabel
  const guideDoneDescriptionId = !guideCanFinish
    ? guideRequirementId
    : guideBlockedByOtherCheck
      ? guideBusyHintId
      : undefined
  const handleSkipLocal = (): void => {
    void runFirstRunGuideAction(() => onFinishGuide(true))
  }
  const handleDone = (): void => {
    void runFirstRunGuideAction(() => onFinishGuide())
  }

  return (
    <div className="modal-actions">
      {data.preferences.firstRunDone ? (
        <button className="ghost-button" type="button" onClick={onCloseGuide}>
          {t('button.closeGuide')}
        </button>
      ) : (
        <button
          className="ghost-button"
          data-guide-skip-local-action="true"
          type="button"
          onClick={handleSkipLocal}
          disabled={guideSuccessPending}
        >
          {t('button.skipLocal')}
        </button>
      )}
      <span
        className="guide-done-tooltip-target"
        data-tooltip={guideDoneTooltip}
      >
        <button
          className={`primary-button ${guideSuccessPending ? 'guide-success-button' : ''}`}
          type="button"
          onClick={handleDone}
          data-tooltip={guideDoneTooltip}
          aria-describedby={guideDoneDescriptionId}
          disabled={!guideCanFinish || guideCheckInProgress || guideSuccessPending}
        >
          {guideCheckingProvider ? (
            <RefreshCw size={16} className="spin" />
          ) : (
            <Check size={16} />
          )}
          {guideDoneLabel}
        </button>
      </span>
      {guideBlockedByOtherCheck ? (
        <span className="sr-only" id={guideBusyHintId}>
          {t('guide.requirement.waitForCheck')}
        </span>
      ) : null}
    </div>
  )
}
