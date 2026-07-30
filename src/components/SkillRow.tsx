import { Check, Pencil, Trash2 } from 'lucide-react'
import type { FormEvent, ReactElement } from 'react'

import type { Translator } from '../i18n'
import { formatSystemNumber } from '../services/uiRuntime'
import type { UserSkill } from '../types'
import { runLeafAction, type LeafActionResult } from './MessageActionBoundary'

interface SkillRowProps {
  t: Translator
  skill: UserSkill
  editing: boolean
  skillEditName: string
  skillEditContent: string
  skillEditLoading: boolean
  skillEditSaving: boolean
  skillMutationPending: boolean
  systemDateLocales: string[]
  onUpdateSkill: (skillId: string, patch: Partial<UserSkill>) => void
  onStartEditingSkill: (skill: UserSkill) => LeafActionResult
  onDeleteSkill: (skillId: string) => LeafActionResult
  onSaveEditingSkill: (event: FormEvent<HTMLFormElement>) => LeafActionResult
  onCancelEditingSkill: () => void
  onSkillEditNameChange: (value: string) => void
  onSkillEditContentChange: (value: string) => void
  onCommitEditsOnBlur: () => void
}

function totalSkillTokens(skill: UserSkill): number {
  return skill.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0)
}

export function SkillRow({
  t,
  skill,
  editing,
  skillEditName,
  skillEditContent,
  skillEditLoading,
  skillEditSaving,
  skillMutationPending,
  systemDateLocales,
  onUpdateSkill,
  onStartEditingSkill,
  onDeleteSkill,
  onSaveEditingSkill,
  onCancelEditingSkill,
  onSkillEditNameChange,
  onSkillEditContentChange,
  onCommitEditsOnBlur,
}: SkillRowProps): ReactElement {
  const skillEditHintId = `skill-edit-hint-${skill.id}`
  const skillEditRequirementId = `skill-edit-requirement-${skill.id}`
  const skillEditContentMissing = skillEditContent.trim().length === 0
  const skillEditBlocked =
    skillEditLoading ||
    skillEditSaving ||
    skillMutationPending ||
    skillEditContentMissing
  const skillEditRequirement =
    skillEditLoading || skillEditSaving || skillMutationPending
      ? t('button.checking')
      : t('notice.skillContentRequired')
  const skillEditTooltip = skillEditBlocked
    ? skillEditRequirement
    : t('button.save')
  const skillEditDescriptionIds = skillEditBlocked
    ? `${skillEditHintId} ${skillEditRequirementId}`
    : skillEditHintId
  const skillEnabledLabel = `${skill.name}: ${t('label.enabled')}`
  const skillFixedLabel = `${skill.name}: ${t('label.skillFixed')}`
  const skillAutoMatchLabel = `${skill.name}: ${t('label.skillAutoMatch')}`
  const skillEditLabel = `${skill.name}: ${t('button.editSkill')}`
  const skillDeleteLabel = `${skill.name}: ${t('button.deleteSkill')}`

  return (
    <div
      className={`skill-row ${skill.enabled ? '' : 'disabled'}`}
      data-skill-id={skill.id}
    >
      <div className="skill-summary">
        <strong>{skill.name}</strong>
        <span>{skill.description || skill.fileName}</span>
        <small>
          {t('settings.skillMeta', {
            chunks: formatSystemNumber(skill.chunks.length, systemDateLocales),
            tokens: formatSystemNumber(totalSkillTokens(skill), systemDateLocales),
          })}
        </small>
      </div>
      <div className="skill-row-actions">
        <label className="provider-list-toggle">
          <input
            type="checkbox"
            checked={skill.enabled}
            disabled={skillMutationPending}
            aria-label={skillEnabledLabel}
            onChange={(event) =>
              onUpdateSkill(skill.id, {
                enabled: event.target.checked,
              })
            }
            onBlur={onCommitEditsOnBlur}
          />
          <span>{t('label.enabled')}</span>
        </label>
        <label className="provider-list-toggle">
          <input
            type="checkbox"
            checked={skill.fixed}
            disabled={skillMutationPending}
            aria-label={skillFixedLabel}
            onChange={(event) =>
              onUpdateSkill(skill.id, {
                fixed: event.target.checked,
              })
            }
            onBlur={onCommitEditsOnBlur}
          />
          <span>{t('label.skillFixed')}</span>
        </label>
        <label className="provider-list-toggle">
          <input
            type="checkbox"
            checked={skill.autoMatch}
            disabled={skillMutationPending}
            aria-label={skillAutoMatchLabel}
            onChange={(event) =>
              onUpdateSkill(skill.id, {
                autoMatch: event.target.checked,
              })
            }
            onBlur={onCommitEditsOnBlur}
          />
          <span>{t('label.skillAutoMatch')}</span>
        </label>
        <div className="skill-row-icon-actions">
          <button
            type="button"
            className="icon-button skill-edit-button"
            aria-label={skillEditLabel}
            disabled={skillEditLoading || skillMutationPending}
            onClick={() => runLeafAction(onStartEditingSkill, skill)}
          >
            <Pencil />
          </button>
          <button
            type="button"
            className="icon-button skill-delete-button"
            aria-label={skillDeleteLabel}
            disabled={skillMutationPending}
            onClick={() => runLeafAction(onDeleteSkill, skill.id)}
          >
            <Trash2 />
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="skill-edit-form"
          onSubmit={(event) => runLeafAction(onSaveEditingSkill, event)}
        >
          <label>
            {t('field.skillName')}
            <input
              value={skillEditName}
              onChange={(event) => onSkillEditNameChange(event.target.value)}
              disabled={skillEditLoading || skillMutationPending}
              aria-describedby={skillEditHintId}
              placeholder={t('placeholder.skillName')}
            />
          </label>
          <label>
            {t('field.skillContent')}
            <textarea
              value={skillEditContent}
              onChange={(event) => onSkillEditContentChange(event.target.value)}
              disabled={skillEditLoading || skillMutationPending}
              aria-describedby={skillEditHintId}
              placeholder={
                skillEditLoading ? t('ui.loading') : t('placeholder.skillContent')
              }
            />
          </label>
          <p className="settings-note" id={skillEditHintId}>
            {t('settings.skillsHelp')}
          </p>
          <div className="skill-edit-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={onCancelEditingSkill}
              disabled={skillMutationPending}
            >
              {t('button.cancel')}
            </button>
            <span
              className="skill-save-tooltip-target"
              data-tooltip={skillEditTooltip}
            >
              <button
                className="primary-button"
                type="submit"
                disabled={skillEditBlocked}
                aria-describedby={skillEditDescriptionIds}
              >
                <Check />
                {skillEditSaving ? t('button.checking') : t('button.save')}
              </button>
            </span>
          </div>
          {skillEditBlocked ? (
            <p
              className="settings-note guide-requirement"
              id={skillEditRequirementId}
              aria-live="polite"
            >
              {skillEditRequirement}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  )
}
