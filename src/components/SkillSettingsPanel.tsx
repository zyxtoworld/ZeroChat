import type {
  ChangeEvent,
  FormEvent,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react'
import type { Translator } from '../i18n'
import type { SkillSettings, UserSkill } from '../types'
import { SkillComposerPanel } from './SkillComposerPanel'
import { SkillListPanel } from './SkillListPanel'

interface SkillSettingsPanelProps {
  t: Translator
  skills: UserSkill[]
  skillSettings: SkillSettings
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
  skillDraftName: string
  skillDraftContent: string
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
  onUpdateSkillSettings: (patch: Partial<SkillSettings>) => void
  onSkillDraftNameChange: (value: string) => void
  onSkillDraftContentChange: (value: string) => void
  onAddSkillFromDraft: () => void | Promise<void>
  onCommitEditsOnBlur: () => void
}

export function SkillSettingsPanel({
  t,
  skills,
  skillSettings,
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
  skillDraftName,
  skillDraftContent,
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
  onUpdateSkillSettings,
  onSkillDraftNameChange,
  onSkillDraftContentChange,
  onAddSkillFromDraft,
  onCommitEditsOnBlur,
}: SkillSettingsPanelProps): ReactElement {
  return (
    <div
      id="settings-panel-skills"
      className="settings-grid skill-settings"
      role="tabpanel"
      aria-labelledby="settings-tab-skills"
    >
      <SkillListPanel
        t={t}
        skills={skills}
        renderedSkills={renderedSkills}
        renderedSkillLimit={renderedSkillLimit}
        skillCount={skillCount}
        hasMoreRenderedSkills={hasMoreRenderedSkills}
        skillListMoreRef={skillListMoreRef}
        skillImporting={skillImporting}
        skillMutationPending={skillMutationPending}
        editingSkillId={editingSkillId}
        skillEditName={skillEditName}
        skillEditContent={skillEditContent}
        skillEditLoading={skillEditLoading}
        skillEditSaving={skillEditSaving}
        systemDateLocales={systemDateLocales}
        notice={notice}
        onShowMoreSkills={onShowMoreSkills}
        onImportSkillFiles={onImportSkillFiles}
        onUpdateSkill={onUpdateSkill}
        onStartEditingSkill={onStartEditingSkill}
        onDeleteSkill={onDeleteSkill}
        onSaveEditingSkill={onSaveEditingSkill}
        onCancelEditingSkill={onCancelEditingSkill}
        onSkillEditNameChange={onSkillEditNameChange}
        onSkillEditContentChange={onSkillEditContentChange}
        onCommitEditsOnBlur={onCommitEditsOnBlur}
      />

      <SkillComposerPanel
        t={t}
        skillSettings={skillSettings}
        skillMutationPending={skillMutationPending}
        skillDraftName={skillDraftName}
        skillDraftContent={skillDraftContent}
        onUpdateSkillSettings={onUpdateSkillSettings}
        onSkillDraftNameChange={onSkillDraftNameChange}
        onSkillDraftContentChange={onSkillDraftContentChange}
        onAddSkillFromDraft={onAddSkillFromDraft}
        onCommitEditsOnBlur={onCommitEditsOnBlur}
      />
    </div>
  )
}
