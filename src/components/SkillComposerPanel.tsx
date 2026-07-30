import { Check } from 'lucide-react'
import type { ReactElement } from 'react'

import type { Translator } from '../i18n'
import {
  MAX_SKILL_CONTEXT_BUDGET,
  MIN_SKILL_CONTEXT_BUDGET,
} from '../services/appData'
import type { SkillSettings } from '../types'
import { runLeafAction, type LeafActionResult } from './MessageActionBoundary'

interface SkillComposerPanelProps {
  t: Translator
  skillSettings: SkillSettings
  skillMutationPending: boolean
  skillDraftName: string
  skillDraftContent: string
  onUpdateSkillSettings: (patch: Partial<SkillSettings>) => void
  onSkillDraftNameChange: (value: string) => void
  onSkillDraftContentChange: (value: string) => void
  onAddSkillFromDraft: () => LeafActionResult
  onCommitEditsOnBlur: () => void
}

export function SkillComposerPanel({
  t,
  skillSettings,
  skillMutationPending,
  skillDraftName,
  skillDraftContent,
  onUpdateSkillSettings,
  onSkillDraftNameChange,
  onSkillDraftContentChange,
  onAddSkillFromDraft,
  onCommitEditsOnBlur,
}: SkillComposerPanelProps): ReactElement {
  const skillBudgetHintId = 'skill-budget-hint'
  const skillDraftHintId = 'skill-draft-hint'
  const skillAddRequirementId = 'skill-add-requirement'
  const skillDraftEmpty = skillDraftContent.trim().length === 0
  const skillAddBlocked = skillMutationPending || skillDraftEmpty
  const skillAddRequirement = skillMutationPending
    ? t('button.checking')
    : t('notice.skillContentRequired')
  const skillAddTooltip = skillAddBlocked ? skillAddRequirement : t('button.addSkill')
  const skillAddDescriptionIds = skillAddBlocked
    ? `${skillDraftHintId} ${skillAddRequirementId}`
    : skillDraftHintId

  return (
    <div className="form-stack">
      <label className="switch-row">
        <input
          type="checkbox"
          checked={skillSettings.autoMatch}
          disabled={skillMutationPending}
          onChange={(event) =>
            onUpdateSkillSettings({ autoMatch: event.target.checked })
          }
          onBlur={onCommitEditsOnBlur}
        />
        {t('label.skillGlobalAutoMatch')}
      </label>
      <div className="skill-budget-grid">
        <label>
          {t('field.skillContextBudget')}
          <input
            type="number"
            min={MIN_SKILL_CONTEXT_BUDGET}
            max={MAX_SKILL_CONTEXT_BUDGET}
            step={100}
            value={skillSettings.contextBudget}
            disabled={skillMutationPending}
            aria-describedby={skillBudgetHintId}
            onChange={(event) => {
              const value = Number(event.target.value)
              onUpdateSkillSettings({
                contextBudget: Number.isFinite(value)
                  ? Math.min(
                      Math.max(value, MIN_SKILL_CONTEXT_BUDGET),
                      MAX_SKILL_CONTEXT_BUDGET,
                    )
                  : skillSettings.contextBudget,
              })
            }}
            onBlur={onCommitEditsOnBlur}
          />
        </label>
        <label>
          {t('field.skillAutoCount')}
          <input
            type="number"
            min={1}
            max={8}
            step={1}
            value={skillSettings.maxAutoSkills}
            disabled={skillMutationPending}
            aria-describedby={skillBudgetHintId}
            onChange={(event) => {
              const value = Number(event.target.value)
              onUpdateSkillSettings({
                maxAutoSkills: Number.isFinite(value)
                  ? Math.min(Math.max(Math.round(value), 1), 8)
                  : skillSettings.maxAutoSkills,
              })
            }}
            onBlur={onCommitEditsOnBlur}
          />
        </label>
      </div>
      <p className="settings-note" id={skillBudgetHintId}>
        {t('settings.skillBudgetNote')}
      </p>
      <p className="settings-note" id={skillDraftHintId}>
        {t('settings.skillsHelp')}
      </p>
      <label>
        {t('field.skillName')}
        <input
          value={skillDraftName}
          aria-describedby={skillDraftHintId}
          onChange={(event) => onSkillDraftNameChange(event.target.value)}
          placeholder={t('placeholder.skillName')}
        />
      </label>
      <label>
        {t('field.skillContent')}
        <textarea
          className="skill-draft"
          value={skillDraftContent}
          aria-describedby={skillDraftHintId}
          onChange={(event) => onSkillDraftContentChange(event.target.value)}
          placeholder={t('placeholder.skillContent')}
        />
      </label>
      <span
        className="skill-add-tooltip-target"
        data-tooltip={skillAddTooltip}
      >
        <button
          type="button"
          className="primary-button"
          onClick={() => runLeafAction(onAddSkillFromDraft)}
          disabled={skillAddBlocked}
          aria-describedby={skillAddDescriptionIds}
        >
          <Check />
          {t('button.addSkill')}
        </button>
      </span>
      {skillAddBlocked ? (
        <p
          className="settings-note guide-requirement"
          id={skillAddRequirementId}
          aria-live="polite"
        >
          {skillAddRequirement}
        </p>
      ) : null}
    </div>
  )
}
