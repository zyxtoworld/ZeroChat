import { Upload } from 'lucide-react'
import type { ChangeEvent, ReactElement } from 'react'

import type { Translator } from '../i18n'
import { runLeafAction, type LeafActionResult } from './MessageActionBoundary'

interface SkillImportPanelProps {
  t: Translator
  skillImporting: boolean
  skillMutationPending: boolean
  onImportSkillFiles: (event: ChangeEvent<HTMLInputElement>) => LeafActionResult
}

export function SkillImportPanel({
  t,
  skillImporting,
  skillMutationPending,
  onImportSkillFiles,
}: SkillImportPanelProps): ReactElement {
  const skillImportHintId = 'skill-import-hint'

  return (
    <div className="skill-import-panel">
      <label
        className={`ghost-button file-button ${
          skillMutationPending ? 'disabled' : ''
        }`}
        aria-disabled={skillMutationPending}
        aria-describedby={skillImportHintId}
      >
        <Upload />
        {skillImporting ? t('button.checking') : t('button.importSkill')}
        <input
          type="file"
          multiple
          accept=".md,.markdown,.txt,.json,application/json,text/plain,text/markdown"
          disabled={skillMutationPending}
          aria-describedby={skillImportHintId}
          onChange={(event) => runLeafAction(onImportSkillFiles, event)}
        />
      </label>
      <p className="settings-note" id={skillImportHintId}>
        {t('settings.skillsHelp')}
      </p>
    </div>
  )
}
