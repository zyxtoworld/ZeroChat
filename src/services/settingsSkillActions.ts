import type { MutableRefObject } from 'react'

import type { NoticeTarget } from '../components/Notice'
import type { Translator } from '../i18n'
import {
  deleteSkillDangerPrompt,
  type DangerPrompt,
} from './dangerConfirmation'
import {
  reportDetachedFormattedFailure,
  reportDetachedNotice,
} from './detachedFailureReporting'
import type {
  AppData,
  SkillSettings,
  UserSkill,
} from '../types'
import {
  bump as bumpAppData,
  now as currentTimestamp,
} from './appData'
import { loadSkillService as loadLazySkillService } from './lazy'
import type { NoticeTone } from './uiRuntime'
import {
  deleteSkillContentRefs as deleteStoredSkillContentRefs,
  deleteSkillContents as deleteStoredSkillContents,
  loadSkillContents as loadStoredSkillContents,
  persistSkillContents as persistStoredSkillContents,
  persistSkillsContents as persistStoredSkillsContents,
  skillContentRefs as storedSkillContentRefs,
} from '../storage/db'
import {
  persistPublishedLocalSnapshot as persistPublishedLocalSnapshotDefault,
} from './localSaveQueueController'

export interface SettingsSkillService {
  createUserSkillFromContent: (
    name: string,
    content: string,
    contentType?: UserSkill['contentType'],
    fileName?: string,
  ) => Promise<UserSkill>
  createUserSkillFromFile: (file: File) => Promise<UserSkill>
  editableSkillContent: (
    skill: UserSkill,
    loadSkillContents: typeof loadStoredSkillContents,
  ) => Promise<string>
}

export interface SettingsSkillActionServices {
  bump: (data: AppData) => AppData
  deleteSkillContentRefs: (refs: string[]) => Promise<void>
  deleteSkillContents: (skill: UserSkill) => Promise<void>
  loadSkillContents: typeof loadStoredSkillContents
  loadSkillService: () => Promise<SettingsSkillService>
  now: () => number
  persistSkillContents: (skill: UserSkill) => Promise<UserSkill>
  persistSkillsContents: (skills: UserSkill[]) => Promise<UserSkill[]>
  persistPublishedLocalSnapshot: (snapshot: AppData) => Promise<AppData>
  skillContentRefs: (skill: UserSkill) => string[]
}

export interface SettingsSkillActionContext {
  claimSkillMutation: () => (() => void) | null
  dataRef: MutableRefObject<AppData | null>
  formatErrorMessage: (error: unknown) => string
  getEditingSkillId: () => string
  getSkillDraftContent: () => string
  getSkillDraftName: () => string
  getSkillEditContent: () => string
  getSkillEditName: () => string
  requestDangerConfirmation: (prompt: DangerPrompt) => Promise<boolean>
  requestSkillReveal: (skillId: string) => void
  scheduleAutoSync: (snapshot: AppData, delayMs?: number) => void
  setEditingSkillId: (value: string) => void
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
  ) => void
  setSkillDraftContent: (value: string) => void
  setSkillDraftName: (value: string) => void
  setSkillEditContent: (value: string) => void
  setSkillEditLoading: (value: boolean) => void
  setSkillEditName: (value: string) => void
  setSkillEditSaving: (value: boolean) => void
  setSkillImporting: (value: boolean) => void
  skillEditRequestRef: MutableRefObject<number>
  t: Translator
  updateData: (
    updater: (current: AppData) => AppData,
    options?: { autoSync?: boolean },
  ) => AppData | null
}

export interface SettingsSkillActions {
  addSkillFromDraft: () => Promise<void>
  cancelEditingSkill: () => void
  deleteSkill: (skillId: string) => Promise<void>
  importSkillFiles: (
    files: File[],
  ) => Promise<void>
  saveEditingSkill: () => Promise<void>
  startEditingSkill: (skill: UserSkill) => Promise<void>
  updateSkill: (skillId: string, patch: Partial<UserSkill>) => void
  updateSkillSettings: (patch: Partial<SkillSettings>) => void
}

const defaultSettingsSkillActionServices: SettingsSkillActionServices = {
  bump: bumpAppData,
  deleteSkillContentRefs: deleteStoredSkillContentRefs,
  deleteSkillContents: deleteStoredSkillContents,
  loadSkillContents: loadStoredSkillContents,
  loadSkillService: loadLazySkillService,
  now: currentTimestamp,
  persistSkillContents: persistStoredSkillContents,
  persistSkillsContents: persistStoredSkillsContents,
  persistPublishedLocalSnapshot: persistPublishedLocalSnapshotDefault,
  skillContentRefs: storedSkillContentRefs,
}

export function reportSkillContentDeleteFailure(
  context: Pick<SettingsSkillActionContext, 'formatErrorMessage' | 'setNotice'>,
  error: unknown,
): void {
  reportDetachedFormattedFailure(context, error, 'skills')
}

export function reportSettingsSkillNotice(
  context: Pick<SettingsSkillActionContext, 'setNotice'>,
  message: () => string,
  tone?: NoticeTone,
  target?: NoticeTarget,
): void {
  reportDetachedNotice(context.setNotice, message, tone, target)
}

export function reportSkillSaveUnavailable(
  context: Pick<SettingsSkillActionContext, 'setNotice' | 't'>,
): void {
  reportSettingsSkillNotice(
    context,
    () => context.t('notice.skillSaveUnavailable'),
    'error',
    'skills',
  )
}

function samePublishedSkillContent(
  left: UserSkill,
  right: UserSkill,
  services: Pick<SettingsSkillActionServices, 'skillContentRefs'>,
): boolean {
  const leftRefs = services.skillContentRefs(left)
  const rightRefs = services.skillContentRefs(right)

  return (
    left.id === right.id &&
    left.contentHash === right.contentHash &&
    leftRefs.length === rightRefs.length &&
    leftRefs.every((ref, index) => ref === rightRefs[index])
  )
}

async function cleanupUncommittedSkillContents(
  context: Pick<SettingsSkillActionContext, 'formatErrorMessage' | 'setNotice'>,
  services: Pick<
    SettingsSkillActionServices,
    'deleteSkillContentRefs' | 'skillContentRefs'
  >,
  skills: UserSkill[],
  visibleData: AppData | null,
): Promise<void> {
  const visibleRefs = new Set(
    visibleData?.skills.flatMap((skill) => services.skillContentRefs(skill)) ?? [],
  )
  const unpublishedRefs = skills
    .flatMap((skill) => services.skillContentRefs(skill))
    .filter((ref) => !visibleRefs.has(ref))

  try {
    await services.deleteSkillContentRefs(unpublishedRefs)
  } catch (error: unknown) {
    reportSkillContentDeleteFailure(context, error)
  }
}

function rollbackUnpublishedSkillRows(
  context: Pick<SettingsSkillActionContext, 'dataRef' | 'updateData'>,
  services: Pick<SettingsSkillActionServices, 'bump' | 'skillContentRefs'>,
  candidates: UserSkill[],
  previousSkills: UserSkill[],
): AppData | null {
  const candidateById = new Map(candidates.map((skill) => [skill.id, skill]))
  const previousById = new Map(previousSkills.map((skill) => [skill.id, skill]))
  const current = context.dataRef.current

  if (
    !current?.skills.some((skill) => {
      const candidate = candidateById.get(skill.id)
      return candidate && samePublishedSkillContent(skill, candidate, services)
    })
  ) {
    return current
  }

  return context.updateData(
    (snapshot) =>
      services.bump({
        ...snapshot,
        skills: snapshot.skills.flatMap((skill) => {
          const candidate = candidateById.get(skill.id)

          if (!candidate || !samePublishedSkillContent(skill, candidate, services)) {
            return [skill]
          }

          const previous = previousById.get(skill.id)
          return previous ? [previous] : []
        }),
      }),
    { autoSync: false },
  )
}

async function commitSkillContentRows(
  context: Pick<
    SettingsSkillActionContext,
    'dataRef' | 'formatErrorMessage' | 'setNotice' | 'updateData'
  >,
  services: Pick<
    SettingsSkillActionServices,
    | 'bump'
    | 'deleteSkillContentRefs'
    | 'persistPublishedLocalSnapshot'
    | 'skillContentRefs'
  >,
  saved: AppData,
  candidates: UserSkill[],
  previousSkills: UserSkill[] = [],
): Promise<AppData> {
  try {
    const committed = await services.persistPublishedLocalSnapshot(saved)
    const allCandidatesPublished = candidates.every((candidate) => {
      const published = committed.skills.find((skill) => skill.id === candidate.id)
      return published && samePublishedSkillContent(published, candidate, services)
    })

    if (!allCandidatesPublished) {
      throw new Error('The Skill content was not included in the durable snapshot.')
    }

    return committed
  } catch (error: unknown) {
    rollbackUnpublishedSkillRows(context, services, candidates, previousSkills)
    await cleanupUncommittedSkillContents(
      context,
      services,
      candidates,
      context.dataRef.current,
    )
    throw error
  }
}

export function createSettingsSkillActions(
  context: SettingsSkillActionContext,
  services: SettingsSkillActionServices = defaultSettingsSkillActionServices,
): SettingsSkillActions {
  function clearEditingSkillState(): void {
    context.skillEditRequestRef.current += 1
    context.setEditingSkillId('')
    context.setSkillEditName('')
    context.setSkillEditContent('')
    context.setSkillEditLoading(false)
    context.setSkillEditSaving(false)
  }

  function cancelEditingSkill(): void {
    const releaseMutation = context.claimSkillMutation()

    if (!releaseMutation) {
      return
    }

    try {
      clearEditingSkillState()
    } finally {
      releaseMutation()
    }
  }

  async function editableSkillContent(skill: UserSkill): Promise<string> {
    const skillService = await services.loadSkillService()

    return skillService.editableSkillContent(skill, services.loadSkillContents)
  }

  async function startEditingSkill(skill: UserSkill): Promise<void> {
    const releaseMutation = context.claimSkillMutation()

    if (!releaseMutation) {
      return
    }

    releaseMutation()

    if (context.getEditingSkillId() === skill.id) {
      cancelEditingSkill()
      return
    }

    const requestId = context.skillEditRequestRef.current + 1
    context.skillEditRequestRef.current = requestId
    context.setEditingSkillId(skill.id)
    context.setSkillEditName(skill.name)
    context.setSkillEditContent('')
    context.setSkillEditLoading(true)
    reportSettingsSkillNotice(context, () => '', undefined, 'skills')

    try {
      const content = await editableSkillContent(skill)

      if (context.skillEditRequestRef.current === requestId) {
        context.setSkillEditContent(content)
      }
    } catch (error: unknown) {
      if (context.skillEditRequestRef.current === requestId) {
        context.setEditingSkillId('')
        reportSettingsSkillNotice(
          context,
          () => context.formatErrorMessage(error),
          'error',
          'skills',
        )
      }
    } finally {
      if (context.skillEditRequestRef.current === requestId) {
        context.setSkillEditLoading(false)
      }
    }
  }

  async function saveEditingSkill(): Promise<void> {
    const editingSkillId = context.getEditingSkillId()
    const currentData = context.dataRef.current

    if (!currentData) {
      reportSkillSaveUnavailable(context)
      return
    }

    const original = currentData.skills.find((skill) => skill.id === editingSkillId)

    if (!original) {
      return
    }

    const skillEditContent = context.getSkillEditContent()

    if (!skillEditContent.trim()) {
      reportSettingsSkillNotice(
        context,
        () => context.t('notice.skillContentRequired'),
        'warning',
        'skills',
      )
      return
    }

    const releaseMutation = context.claimSkillMutation()

    if (!releaseMutation) {
      return
    }

    context.setSkillEditSaving(true)
    reportSettingsSkillNotice(context, () => '', undefined, 'skills')

    try {
      const skillService = await services.loadSkillService()
      const rebuiltRaw = await skillService.createUserSkillFromContent(
        context.getSkillEditName().trim() || original.name,
        skillEditContent,
        original.contentType,
        original.fileName,
      )
      const rebuilt: UserSkill = {
        ...rebuiltRaw,
        id: original.id,
        fileName: original.fileName,
        contentType: original.contentType,
        fixed: original.fixed,
        enabled: original.enabled,
        autoMatch: original.autoMatch,
        createdAt: original.createdAt,
        updatedAt: services.now(),
      }
      const persisted = await services.persistSkillContents(rebuilt)
      const nextRefs = new Set(services.skillContentRefs(persisted))
      const staleRefs = services
        .skillContentRefs(original)
        .filter((ref) => !nextRefs.has(ref))

      const saved = context.updateData(
        (current) =>
          services.bump({
            ...current,
            skills: current.skills.map((skill) =>
              skill.id === original.id ? persisted : skill,
            ),
          }),
        { autoSync: false },
      )

      if (!saved) {
        await cleanupUncommittedSkillContents(
          context,
          services,
          [persisted],
          context.dataRef.current,
        )
        reportSkillSaveUnavailable(context)
        return
      }

      const committed = await commitSkillContentRows(
        context,
        services,
        saved,
        [persisted],
        [original],
      )

      context.scheduleAutoSync(committed, 0)
      context.setSkillEditName(persisted.name)
      context.setSkillEditContent(skillEditContent.trim())
      reportSettingsSkillNotice(
        context,
        () => context.t('notice.skillSaved'),
        'success',
        'skills',
      )

      void services.deleteSkillContentRefs(staleRefs).catch((error: unknown) => {
        reportSkillContentDeleteFailure(context, error)
      })
    } catch (error: unknown) {
      reportSettingsSkillNotice(
        context,
        () => context.formatErrorMessage(error),
        'error',
        'skills',
      )
    } finally {
      context.setSkillEditSaving(false)
      releaseMutation()
    }
  }

  function updateSkill(skillId: string, patch: Partial<UserSkill>): void {
    const releaseMutation = context.claimSkillMutation()

    if (!releaseMutation) {
      return
    }

    try {
      const saved = context.updateData(
        (current) =>
          services.bump({
            ...current,
            skills: current.skills.map((skill) =>
              skill.id === skillId
                ? {
                    ...skill,
                    ...patch,
                    updatedAt: services.now(),
                  }
                : skill,
            ),
          }),
        { autoSync: false },
      )

      if (!saved) {
        reportSkillSaveUnavailable(context)
        return
      }

      context.scheduleAutoSync(saved, 0)
      reportSettingsSkillNotice(
        context,
        () => context.t('notice.skillSaved'),
        'success',
        'skills',
      )
    } finally {
      releaseMutation()
    }
  }

  function updateSkillSettings(patch: Partial<SkillSettings>): void {
    const releaseMutation = context.claimSkillMutation()

    if (!releaseMutation) {
      return
    }

    try {
      const saved = context.updateData(
        (current) =>
          services.bump({
            ...current,
            skillSettings: {
              ...current.skillSettings,
              ...patch,
            },
          }),
        { autoSync: false },
      )

      if (!saved) {
        reportSkillSaveUnavailable(context)
        return
      }

      context.scheduleAutoSync(saved, 0)
      reportSettingsSkillNotice(context, () => '')
    } finally {
      releaseMutation()
    }
  }

  async function importSkillFiles(files: File[]): Promise<void> {
    if (files.length === 0) {
      return
    }

    if (!context.dataRef.current) {
      reportSkillSaveUnavailable(context)
      return
    }

    const releaseMutation = context.claimSkillMutation()

    if (!releaseMutation) {
      return
    }

    context.setSkillImporting(true)
    reportSettingsSkillNotice(context, () => '', undefined, 'skills')

    try {
      const skillService = await services.loadSkillService()
      const importedRaw: UserSkill[] = []

      for (const file of files) {
        importedRaw.push(await skillService.createUserSkillFromFile(file))
      }

      const imported = await services.persistSkillsContents(importedRaw)
      const saved = context.updateData(
        (current) =>
          services.bump({
            ...current,
            skills: [...current.skills, ...imported],
          }),
        { autoSync: false },
      )

      if (!saved) {
        await cleanupUncommittedSkillContents(
          context,
          services,
          imported,
          context.dataRef.current,
        )
        reportSkillSaveUnavailable(context)
        return
      }

      const committed = await commitSkillContentRows(
        context,
        services,
        saved,
        imported,
      )

      context.scheduleAutoSync(committed, 0)
      context.requestSkillReveal(imported[0]?.id ?? '')
      reportSettingsSkillNotice(
        context,
        () => context.t('notice.skillImported', { count: imported.length }),
        'success',
        'skills',
      )
    } catch (error: unknown) {
      reportSettingsSkillNotice(
        context,
        () => context.t('notice.skillImportFailed', {
          message: context.formatErrorMessage(error),
        }),
        'error',
        'skills',
      )
    } finally {
      context.setSkillImporting(false)
      releaseMutation()
    }
  }

  async function addSkillFromDraft(): Promise<void> {
    const content = context.getSkillDraftContent().trim()

    if (!content) {
      reportSettingsSkillNotice(
        context,
        () => context.t('notice.skillContentRequired'),
        'warning',
        'skills',
      )
      return
    }

    if (!context.dataRef.current) {
      reportSkillSaveUnavailable(context)
      return
    }

    const releaseMutation = context.claimSkillMutation()

    if (!releaseMutation) {
      return
    }

    context.setSkillImporting(true)
    reportSettingsSkillNotice(context, () => '', undefined, 'skills')

    try {
      const skillService = await services.loadSkillService()
      const skill = await services.persistSkillContents(
        await skillService.createUserSkillFromContent(
          context.getSkillDraftName().trim(),
          content,
        ),
      )
      const saved = context.updateData(
        (current) =>
          services.bump({
            ...current,
            skills: [...current.skills, skill],
          }),
        { autoSync: false },
      )

      if (!saved) {
        await cleanupUncommittedSkillContents(
          context,
          services,
          [skill],
          context.dataRef.current,
        )
        reportSkillSaveUnavailable(context)
        return
      }

      const committed = await commitSkillContentRows(
        context,
        services,
        saved,
        [skill],
      )

      context.scheduleAutoSync(committed, 0)
      context.requestSkillReveal(skill.id)
      context.setSkillDraftName('')
      context.setSkillDraftContent('')
      reportSettingsSkillNotice(
        context,
        () => context.t('notice.skillAdded'),
        'success',
        'skills',
      )
    } catch (error: unknown) {
      reportSettingsSkillNotice(
        context,
        () => context.t('notice.skillImportFailed', {
          message: context.formatErrorMessage(error),
        }),
        'error',
        'skills',
      )
    } finally {
      context.setSkillImporting(false)
      releaseMutation()
    }
  }

  async function deleteSkill(skillId: string): Promise<void> {
    const currentData = context.dataRef.current

    if (!currentData) {
      reportSkillSaveUnavailable(context)
      return
    }

    const skill = currentData.skills.find((item) => item.id === skillId)

    if (!skill) {
      return
    }

    const releaseMutation = context.claimSkillMutation()

    if (!releaseMutation) {
      return
    }

    try {
      const dangerPrompt = deleteSkillDangerPrompt(context.t, skill.name)
      let confirmed: boolean

      try {
        confirmed = await context.requestDangerConfirmation(dangerPrompt)
      } catch {
        reportSkillSaveUnavailable(context)
        return
      }

      if (!confirmed) {
        return
      }

      const latestSkill = context.dataRef.current?.skills.find(
        (item) => item.id === skillId,
      )

      if (!latestSkill) {
        return
      }

      const saved = context.updateData(
        (current) =>
          services.bump({
            ...current,
            skills: current.skills.filter((skill) => skill.id !== skillId),
          }),
        { autoSync: false },
      )

      if (!saved) {
        reportSkillSaveUnavailable(context)
        return
      }

      let committed: AppData

      try {
        committed = await services.persistPublishedLocalSnapshot(saved)
      } catch (error: unknown) {
        reportDetachedFormattedFailure(context, error, 'skills')
        return
      }

      if (committed.skills.some((skill) => skill.id === skillId)) {
        reportSkillSaveUnavailable(context)
        return
      }

      context.scheduleAutoSync(committed, 0)
      if (context.getEditingSkillId() === skillId) {
        clearEditingSkillState()
      }
      reportSettingsSkillNotice(
        context,
        () => context.t('notice.skillDeleted'),
        'success',
        'skills',
      )

      void services.deleteSkillContents(latestSkill).catch((error: unknown) => {
        reportSkillContentDeleteFailure(context, error)
      })
    } finally {
      releaseMutation()
    }
  }

  return {
    addSkillFromDraft,
    cancelEditingSkill,
    deleteSkill,
    importSkillFiles,
    saveEditingSkill,
    startEditingSkill,
    updateSkill,
    updateSkillSettings,
  }
}
