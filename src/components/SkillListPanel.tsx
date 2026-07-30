import { ChevronDown } from 'lucide-react'
import type {
  ChangeEvent,
  FormEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'

import type { Translator } from '../i18n'
import { formatSystemNumber } from '../services/uiRuntime'
import type { UserSkill } from '../types'
import { SkillImportPanel } from './SkillImportPanel'
import { SkillRow } from './SkillRow'

interface SkillListPanelProps {
  t: Translator
  skills: UserSkill[]
  renderedSkills: UserSkill[]
  renderedSkillLimit: number
  skillCount: number
  hasMoreRenderedSkills: boolean
  skillListMoreRef: RefObject<HTMLDivElement | null>
  skillImporting: boolean
  skillMutationPending: boolean
  editingSkillId: string
  skillEditName: string
  skillEditContent: string
  skillEditLoading: boolean
  skillEditSaving: boolean
  systemDateLocales: string[]
  notice: ReactNode
  onShowMoreSkills: () => void
  onImportSkillFiles: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>
  onUpdateSkill: (skillId: string, patch: Partial<UserSkill>) => void
  onStartEditingSkill: (skill: UserSkill) => void | Promise<void>
  onDeleteSkill: (skillId: string) => void | Promise<void>
  onSaveEditingSkill: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  onCancelEditingSkill: () => void
  onSkillEditNameChange: (value: string) => void
  onSkillEditContentChange: (value: string) => void
  onCommitEditsOnBlur: () => void
}

export function SkillListPanel({
  t,
  skills,
  renderedSkills,
  renderedSkillLimit,
  skillCount,
  hasMoreRenderedSkills,
  skillListMoreRef,
  skillImporting,
  skillMutationPending,
  editingSkillId,
  skillEditName,
  skillEditContent,
  skillEditLoading,
  skillEditSaving,
  systemDateLocales,
  notice,
  onShowMoreSkills,
  onImportSkillFiles,
  onUpdateSkill,
  onStartEditingSkill,
  onDeleteSkill,
  onSaveEditingSkill,
  onCancelEditingSkill,
  onSkillEditNameChange,
  onSkillEditContentChange,
  onCommitEditsOnBlur,
}: SkillListPanelProps): ReactElement {
  function renderSkillListProgress(placement: 'top' | 'bottom') {
    if (!hasMoreRenderedSkills) {
      return null
    }

    return (
      <div
        className={`skill-list-more skill-list-more-${placement}`}
        ref={placement === 'bottom' ? skillListMoreRef : undefined}
      >
        <span>
          {t('settings.skillListProgress', {
            shown: formatSystemNumber(renderedSkillLimit, systemDateLocales),
            total: formatSystemNumber(skillCount, systemDateLocales),
          })}
        </span>
        <button
          type="button"
          className="ghost-button compact-button"
          onClick={onShowMoreSkills}
        >
          <ChevronDown />
          {t('button.showMoreSkills')}
        </button>
      </div>
    )
  }

  return (
    <div className="provider-list skill-list">
      <SkillImportPanel
        t={t}
        skillImporting={skillImporting}
        skillMutationPending={skillMutationPending}
        onImportSkillFiles={onImportSkillFiles}
      />

      {renderSkillListProgress('top')}

      {skills.length === 0 ? (
        <p className="settings-note skill-empty">
          {t('settings.skillsEmpty')}
        </p>
      ) : (
        renderedSkills.map((skill) => (
          <SkillRow
            key={skill.id}
            t={t}
            skill={skill}
            editing={editingSkillId === skill.id}
            skillEditName={skillEditName}
            skillEditContent={skillEditContent}
            skillEditLoading={skillEditLoading}
            skillEditSaving={skillEditSaving}
            skillMutationPending={skillMutationPending}
            systemDateLocales={systemDateLocales}
            onUpdateSkill={onUpdateSkill}
            onStartEditingSkill={onStartEditingSkill}
            onDeleteSkill={onDeleteSkill}
            onSaveEditingSkill={onSaveEditingSkill}
            onCancelEditingSkill={onCancelEditingSkill}
            onSkillEditNameChange={onSkillEditNameChange}
            onSkillEditContentChange={onSkillEditContentChange}
            onCommitEditsOnBlur={onCommitEditsOnBlur}
          />
        ))
      )}

      {renderSkillListProgress('bottom')}
      {notice}
    </div>
  )
}
