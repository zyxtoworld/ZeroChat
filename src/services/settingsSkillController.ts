import type {
  ChangeEvent,
  FormEvent,
  MutableRefObject,
  RefObject,
} from 'react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { SettingsTab } from '../components/SettingsNav'
import type { Translator } from '../i18n'
import { createActionGate } from './actionGate'
import type { DangerPrompt } from './dangerConfirmation'
import type {
  AppData,
  SkillSettings,
  UserSkill,
} from '../types'
import { reportDetachedFormattedFailure } from './detachedFailureReporting'
import type {
  SettingsSkillActionContext,
  SettingsSkillActions,
} from './settingsSkillActions'
import { loadSettingsSkillActionService } from './settingsSkillActionsLoader'
import { useSettingsSkillListController } from './settingsSkillListController'
import type { NoticeTone } from './uiRuntime'

export type {
  SettingsSkillActionContext,
  SettingsSkillActions,
  SettingsSkillActionServices,
  SettingsSkillService,
} from './settingsSkillActions'

export function runCapturedSkillImport(
  event: ChangeEvent<HTMLInputElement>,
  run: (files: File[]) => Promise<void>,
): Promise<void> {
  const input = event.currentTarget
  const files = Array.from(input.files ?? [])

  return run(files).finally(() => {
    try {
      input.value = ''
    } catch {
      // The import result is settled; a detached input needs no cleanup.
    }
  })
}

interface UseSettingsSkillControllerOptions {
  data: AppData | null
  dataRef: MutableRefObject<AppData | null>
  formatErrorMessage: (error: unknown) => string
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  scrollSettingsTargetIntoView: (target: HTMLElement) => void
  settingsModalRef: RefObject<HTMLElement | null>
  settingsOpen: boolean
  settingsTab: SettingsTab
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  t: Translator
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

export function useSettingsSkillController({
  data,
  dataRef,
  formatErrorMessage,
  requestDangerConfirmation,
  scheduleAutoSync,
  scrollSettingsTargetIntoView,
  settingsModalRef,
  settingsOpen,
  settingsTab,
  setNotice,
  t,
  updateData,
}: UseSettingsSkillControllerOptions) {
  const [skillDraftName, setSkillDraftName] = useState('')
  const [skillDraftContent, setSkillDraftContent] = useState('')
  const [editingSkillId, setEditingSkillId] = useState('')
  const [skillEditName, setSkillEditName] = useState('')
  const [skillEditContent, setSkillEditContent] = useState('')
  const [skillEditLoading, setSkillEditLoading] = useState(false)
  const [skillEditSaving, setSkillEditSaving] = useState(false)
  const [skillImporting, setSkillImporting] = useState(false)
  const [skillMutationPending, setSkillMutationPending] = useState(false)
  const skillEditRequestRef = useRef(0)
  const skillMutationGate = useMemo(() => createActionGate(), [])
  const claimSkillMutation = useCallback(() => {
    const release = skillMutationGate.claim()

    if (!release) {
      return null
    }

    setSkillMutationPending(true)
    return () => {
      release()
      setSkillMutationPending(false)
    }
  }, [skillMutationGate])
  const {
    hasMoreRenderedSkills,
    renderedSkillLimit,
    renderedSkills,
    requestSkillReveal,
    resetRenderedSkillList,
    showMoreSkills,
    skillCount,
    skillListMoreRef,
  } = useSettingsSkillListController({
    editingSkillId,
    scrollSettingsTargetIntoView,
    settingsModalRef,
    settingsOpen,
    settingsTab,
    skills: data?.skills ?? [],
  })
  const createActionContext = useCallback(
    (): SettingsSkillActionContext => ({
      dataRef,
      claimSkillMutation,
      formatErrorMessage,
      getEditingSkillId: () => editingSkillId,
      getSkillDraftContent: () => skillDraftContent,
      getSkillDraftName: () => skillDraftName,
      getSkillEditContent: () => skillEditContent,
      getSkillEditName: () => skillEditName,
      requestDangerConfirmation,
      requestSkillReveal,
      scheduleAutoSync,
      setEditingSkillId,
      setNotice,
      setSkillDraftContent,
      setSkillDraftName,
      setSkillEditContent,
      setSkillEditLoading,
      setSkillEditName,
      setSkillEditSaving,
      setSkillImporting,
      skillEditRequestRef,
      t,
      updateData,
    }),
    [
      dataRef,
      claimSkillMutation,
      editingSkillId,
      formatErrorMessage,
      requestDangerConfirmation,
      requestSkillReveal,
      scheduleAutoSync,
      setNotice,
      skillDraftContent,
      skillDraftName,
      skillEditContent,
      skillEditName,
      t,
      updateData,
    ],
  )
  const reportActionLoadFailure = useCallback(
    (error: unknown) => {
      reportDetachedFormattedFailure(
        { formatErrorMessage, setNotice },
        error,
        'skills',
      )
    },
    [formatErrorMessage, setNotice],
  )
  const runSettingsSkillAction = useCallback(
    async (
      run: (actions: SettingsSkillActions) => Promise<void> | void,
    ): Promise<void> => {
      const context = createActionContext()

      try {
        const service = await loadSettingsSkillActionService()
        await run(service.createSettingsSkillActions(context))
      } catch (error: unknown) {
        reportActionLoadFailure(error)
      }
    },
    [createActionContext, reportActionLoadFailure],
  )

  useEffect(() => {
    if (!settingsOpen || settingsTab !== 'skills') {
      return
    }

    void loadSettingsSkillActionService().catch(reportActionLoadFailure)
  }, [reportActionLoadFailure, settingsOpen, settingsTab])

  const addSkillFromDraft = useCallback(
    () => runSettingsSkillAction((actions) => actions.addSkillFromDraft()),
    [runSettingsSkillAction],
  )
  const cancelEditingSkill = useCallback(
    () => runSettingsSkillAction((actions) => actions.cancelEditingSkill()),
    [runSettingsSkillAction],
  )
  const deleteSkill = useCallback(
    (skillId: string) =>
      runSettingsSkillAction((actions) => actions.deleteSkill(skillId)),
    [runSettingsSkillAction],
  )
  const importSkillFiles = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      runCapturedSkillImport(event, (files) =>
        runSettingsSkillAction((actions) => actions.importSkillFiles(files)),
      ),
    [runSettingsSkillAction],
  )
  const saveEditingSkill = useCallback(
    (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault()
      return runSettingsSkillAction((actions) => actions.saveEditingSkill())
    },
    [runSettingsSkillAction],
  )
  const startEditingSkill = useCallback(
    (skill: UserSkill) =>
      runSettingsSkillAction((actions) => actions.startEditingSkill(skill)),
    [runSettingsSkillAction],
  )
  const updateSkill = useCallback(
    (skillId: string, patch: Partial<UserSkill>) =>
      runSettingsSkillAction((actions) => actions.updateSkill(skillId, patch)),
    [runSettingsSkillAction],
  )
  const updateSkillSettings = useCallback(
    (patch: Partial<SkillSettings>) =>
      runSettingsSkillAction((actions) => actions.updateSkillSettings(patch)),
    [runSettingsSkillAction],
  )

  return {
    addSkillFromDraft,
    cancelEditingSkill,
    deleteSkill,
    editingSkillId,
    hasMoreRenderedSkills,
    importSkillFiles,
    renderedSkillLimit,
    renderedSkills,
    resetRenderedSkillList,
    saveEditingSkill,
    setSkillDraftContent,
    setSkillDraftName,
    setSkillEditContent,
    setSkillEditName,
    showMoreSkills,
    skillCount,
    skillDraftContent,
    skillDraftName,
    skillEditContent,
    skillEditLoading,
    skillEditName,
    skillEditSaving,
    skillImporting,
    skillMutationPending,
    skillListMoreRef,
    startEditingSkill,
    updateSkill,
    updateSkillSettings,
  }
}
