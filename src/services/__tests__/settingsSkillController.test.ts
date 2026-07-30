import { describe, expect, it, vi } from 'vitest'

import type { Translator } from '../../i18n'
import type {
  AppData,
  UserSkill,
} from '../../types'
import { defaultSkillSettings } from '../appData'
import { createActionGate } from '../actionGate'
import {
  createSettingsSkillActions,
  type SettingsSkillActionContext,
  type SettingsSkillActionServices,
  type SettingsSkillService,
} from '../settingsSkillActions'
import { runCapturedSkillImport } from '../settingsSkillController'

const t = ((key: string) => key) as Translator

function skill(id: string, patch: Partial<UserSkill> = {}): UserSkill {
  return {
    id,
    name: id,
    description: '',
    contentType: 'markdown',
    sourceSize: 10,
    contentHash: id,
    keywords: [],
    chunks: [
      {
        id: 'chunk-1',
        contentRef: `${id}-ref`,
        heading: 'Overview',
        keywords: [],
        tokenEstimate: 3,
      },
    ],
    fixed: false,
    enabled: true,
    autoMatch: true,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function appData(skills: UserSkill[] = []): AppData {
  return {
    version: 1,
    providers: [],
    conversations: [],
    preferences: {
      compactMode: false,
      dismissedDangerWarnings: [],
      dismissedFeatureHints: [],
      firstRunDone: true,
      language: 'system',
      theme: 'system',
    },
    skillSettings: defaultSkillSettings(),
    skills,
    sync: {
      autoSync: false,
      encryptionEnabled: true,
      mode: 'local',
    },
    updatedAt: 10,
  }
}

function skillFiles(...names: string[]): File[] {
  return names.map((name) => ({ name })) as File[]
}

async function flushPromises(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return { promise, resolve }
}

function createHarness({
  data = appData(),
  draftContent = '',
  draftName = '',
  editingSkillId = '',
  editContent = '',
  editName = '',
  editSaving = false,
  services: serviceOverrides = {},
}: {
  data?: AppData
  draftContent?: string
  draftName?: string
  editingSkillId?: string
  editContent?: string
  editName?: string
  editSaving?: boolean
  services?: Partial<SettingsSkillActionServices>
} = {}) {
  const state = {
    draftContent,
    draftName,
    editingSkillId,
    editContent,
    editLoading: false,
    editName,
    editSaving,
    importing: false,
  }
  const dataRef = { current: data }
  const setNotice = vi.fn()
  const requestDangerConfirmation = vi.fn(async () => true)
  const requestSkillReveal = vi.fn()
  const scheduleAutoSync = vi.fn()
  const skillService: SettingsSkillService = {
    createUserSkillFromContent: vi.fn(async (name: string, content: string) =>
      skill('created-skill', {
        contentHash: content,
        name: name || 'Untitled',
      }),
    ),
    createUserSkillFromFile: vi.fn(async (file: File) =>
      skill(file.name.replace(/\W+/g, '-')),
    ),
    editableSkillContent: vi.fn(async () => 'editable content'),
  }
  const services: SettingsSkillActionServices = {
    bump: (snapshot) => ({
      ...snapshot,
      updatedAt: snapshot.updatedAt + 1,
    }),
    deleteSkillContentRefs: vi.fn(async () => undefined),
    deleteSkillContents: vi.fn(async () => undefined),
    loadSkillContents: vi.fn(),
    loadSkillService: vi.fn(async () => skillService),
    now: vi.fn(() => 500),
    persistSkillContents: vi.fn(async (item: UserSkill) => item),
    persistSkillsContents: vi.fn(async (items: UserSkill[]) => items),
    persistPublishedLocalSnapshot: vi.fn(async (snapshot) => snapshot),
    skillContentRefs: (item) =>
      item.chunks.flatMap((chunk) => (chunk.contentRef ? [chunk.contentRef] : [])),
    ...serviceOverrides,
  }
  const mutationGate = createActionGate()
  const context: SettingsSkillActionContext = {
    claimSkillMutation: mutationGate.claim,
    dataRef,
    formatErrorMessage: (error) =>
      error instanceof Error ? error.message : String(error),
    getEditingSkillId: () => state.editingSkillId,
    getSkillDraftContent: () => state.draftContent,
    getSkillDraftName: () => state.draftName,
    getSkillEditContent: () => state.editContent,
    getSkillEditName: () => state.editName,
    requestDangerConfirmation,
    requestSkillReveal,
    scheduleAutoSync,
    setEditingSkillId: (value) => {
      state.editingSkillId = value
    },
    setNotice,
    setSkillDraftContent: (value) => {
      state.draftContent = value
    },
    setSkillDraftName: (value) => {
      state.draftName = value
    },
    setSkillEditContent: (value) => {
      state.editContent = value
    },
    setSkillEditLoading: (value) => {
      state.editLoading = value
    },
    setSkillEditName: (value) => {
      state.editName = value
    },
    setSkillEditSaving: (value) => {
      state.editSaving = value
    },
    setSkillImporting: (value) => {
      state.importing = value
    },
    skillEditRequestRef: { current: 0 },
    t,
    updateData: vi.fn((updater) => {
      const current = dataRef.current

      if (!current) {
        return null
      }

      const next = updater(current)
      dataRef.current = next
      return next
    }),
  }

  return {
    actions: createSettingsSkillActions(context, services),
    context,
    dataRef,
    requestDangerConfirmation,
    requestSkillReveal,
    scheduleAutoSync,
    services,
    setNotice,
    skillService,
    state,
  }
}

describe('settings skill controller', () => {
  it('captures Skill files before the lazy action boundary and clears the settled input', async () => {
    const pendingImport = deferred<void>()
    const firstFile = { name: 'first.md' } as File
    const secondFile = { name: 'second.md' } as File
    const input = {
      files: [firstFile],
      value: 'selected',
    }
    const run = vi.fn(() => pendingImport.promise)
    const result = runCapturedSkillImport(
      { currentTarget: input } as never,
      run,
    )

    input.files = [secondFile]
    expect(run).toHaveBeenCalledWith([firstFile])
    expect(input.value).toBe('selected')

    pendingImport.resolve()
    await result
    expect(input.value).toBe('')
  })

  it('adds draft skills, clears the draft, reveals the row, and queues immediate sync', async () => {
    const harness = createHarness({
      draftContent: '  # Skill body  ',
      draftName: '  Draft Skill  ',
    })

    await harness.actions.addSkillFromDraft()

    expect(harness.skillService.createUserSkillFromContent).toHaveBeenCalledWith(
      'Draft Skill',
      '# Skill body',
    )
    expect(harness.dataRef.current?.skills).toHaveLength(1)
    expect(harness.requestSkillReveal).toHaveBeenCalledWith('created-skill')
    expect(harness.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.updateData).toHaveBeenLastCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(harness.state.draftName).toBe('')
    expect(harness.state.draftContent).toBe('')
    expect(harness.state.importing).toBe(false)
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillAdded',
      'success',
      'skills',
    )
  })

  it('rejects overlapping add while a Skill import owns the mutation gate', async () => {
    const harness = createHarness({
      draftContent: '# Draft body',
      draftName: 'Draft Skill',
    })
    const pendingService = deferred<SettingsSkillService>()
    vi.mocked(harness.services.loadSkillService).mockReturnValueOnce(
      pendingService.promise,
    )

    const importing = harness.actions.importSkillFiles(skillFiles('alpha.md'))
    const adding = harness.actions.addSkillFromDraft()

    expect(harness.services.loadSkillService).toHaveBeenCalledTimes(1)
    pendingService.resolve(harness.skillService)
    await Promise.all([importing, adding])

    expect(harness.skillService.createUserSkillFromFile).toHaveBeenCalledTimes(1)
    expect(harness.skillService.createUserSkillFromContent).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.skills).toHaveLength(1)
  })

  it('keeps draft Skill content and cleans uncommitted chunks when local save cannot commit', async () => {
    const harness = createHarness({
      draftContent: '  # Skill body  ',
      draftName: '  Draft Skill  ',
    })
    harness.context.updateData = vi.fn(() => null)

    await harness.actions.addSkillFromDraft()

    expect(harness.services.persistSkillContents).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'created-skill' }),
    )
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'created-skill-ref',
    ])
    expect(harness.dataRef.current?.skills).toHaveLength(0)
    expect(harness.requestSkillReveal).not.toHaveBeenCalled()
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.state.draftName).toBe('  Draft Skill  ')
    expect(harness.state.draftContent).toBe('  # Skill body  ')
    expect(harness.state.importing).toBe(false)
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillSaveUnavailable',
      'error',
      'skills',
    )
  })

  it('rolls back draft Skill rows and chunks when the durable AppData commit fails', async () => {
    const harness = createHarness({
      draftContent: '  # Skill body  ',
      draftName: '  Draft Skill  ',
      services: {
        persistPublishedLocalSnapshot: vi.fn(async () => {
          throw new Error('app data write blocked')
        }),
      },
    })

    await harness.actions.addSkillFromDraft()

    expect(harness.dataRef.current?.skills).toHaveLength(0)
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'created-skill-ref',
    ])
    expect(harness.requestSkillReveal).not.toHaveBeenCalled()
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.state.draftName).toBe('  Draft Skill  ')
    expect(harness.state.draftContent).toBe('  # Skill body  ')
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillImportFailed',
      'error',
      'skills',
    )
  })

  it('contains draft Skill save reporter failures without false import errors', async () => {
    const harness = createHarness({
      draftContent: '  # Skill body  ',
      draftName: '  Draft Skill  ',
    })
    harness.setNotice.mockImplementation((_message, tone) => {
      if (tone === 'success') {
        throw new Error('notice unavailable')
      }
    })

    await expect(harness.actions.addSkillFromDraft()).resolves.toBeUndefined()

    expect(harness.dataRef.current?.skills).toHaveLength(1)
    expect(harness.requestSkillReveal).toHaveBeenCalledWith('created-skill')
    expect(harness.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.state.draftName).toBe('')
    expect(harness.state.draftContent).toBe('')
    expect(harness.state.importing).toBe(false)
    expect(harness.setNotice).toHaveBeenCalledWith(
      'notice.skillAdded',
      'success',
      'skills',
    )
    expect(harness.setNotice).not.toHaveBeenCalledWith(
      'notice.skillImportFailed',
      'error',
      'skills',
    )
  })

  it('imports multiple Skill files and queues immediate sync after persistence', async () => {
    const harness = createHarness()
    const files = skillFiles('alpha.md', 'beta.txt')

    await harness.actions.importSkillFiles(files)

    expect(harness.skillService.createUserSkillFromFile).toHaveBeenCalledTimes(2)
    expect(harness.services.persistSkillsContents).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'alpha-md' }),
      expect.objectContaining({ id: 'beta-txt' }),
    ])
    expect(harness.dataRef.current?.skills.map((item) => item.id)).toEqual([
      'alpha-md',
      'beta-txt',
    ])
    expect(harness.requestSkillReveal).toHaveBeenCalledWith('alpha-md')
    expect(harness.context.updateData).toHaveBeenLastCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(harness.state.importing).toBe(false)
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillImported',
      'success',
      'skills',
    )
  })

  it('contains Skill import reporter failures without false import errors', async () => {
    const harness = createHarness()
    const files = skillFiles('alpha.md', 'beta.txt')
    harness.setNotice.mockImplementation((_message, tone) => {
      if (tone === 'success') {
        throw new Error('notice unavailable')
      }
    })

    await expect(harness.actions.importSkillFiles(files)).resolves.toBeUndefined()

    expect(harness.dataRef.current?.skills.map((item) => item.id)).toEqual([
      'alpha-md',
      'beta-txt',
    ])
    expect(harness.requestSkillReveal).toHaveBeenCalledWith('alpha-md')
    expect(harness.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.state.importing).toBe(false)
    expect(harness.setNotice).toHaveBeenCalledWith(
      'notice.skillImported',
      'success',
      'skills',
    )
    expect(harness.setNotice).not.toHaveBeenCalledWith(
      'notice.skillImportFailed',
      'error',
      'skills',
    )
  })

  it('cleans imported Skill chunks when imported rows cannot be committed', async () => {
    const harness = createHarness()
    const files = skillFiles('alpha.md', 'beta.txt')
    harness.context.updateData = vi.fn(() => null)

    await harness.actions.importSkillFiles(files)

    expect(harness.services.persistSkillsContents).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'alpha-md' }),
      expect.objectContaining({ id: 'beta-txt' }),
    ])
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'alpha-md-ref',
      'beta-txt-ref',
    ])
    expect(harness.dataRef.current?.skills).toHaveLength(0)
    expect(harness.requestSkillReveal).not.toHaveBeenCalled()
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.state.importing).toBe(false)
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillSaveUnavailable',
      'error',
      'skills',
    )
  })

  it('rolls back imported Skill rows and chunks when the durable AppData commit fails', async () => {
    const harness = createHarness({
      services: {
        persistPublishedLocalSnapshot: vi.fn(async () => {
          throw new Error('app data write blocked')
        }),
      },
    })

    await harness.actions.importSkillFiles(skillFiles('alpha.md', 'beta.txt'))

    expect(harness.dataRef.current?.skills).toHaveLength(0)
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'alpha-md-ref',
      'beta-txt-ref',
    ])
    expect(harness.requestSkillReveal).not.toHaveBeenCalled()
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillImportFailed',
      'error',
      'skills',
    )
  })

  it('saves an edited Skill while preserving user toggles and deleting stale chunk refs', async () => {
    const original = skill('skill-1', {
      autoMatch: false,
      contentType: 'json',
      enabled: false,
      fileName: 'source.json',
      fixed: true,
    })
    const rebuiltRaw = skill('raw-skill', {
      chunks: [
        {
          id: 'chunk-1',
          contentRef: 'new-ref',
          heading: 'Overview',
          keywords: [],
          tokenEstimate: 4,
        },
      ],
      name: 'Renamed',
    })
    const harness = createHarness({
      data: appData([original]),
      editingSkillId: 'skill-1',
      editContent: '  updated content  ',
      editName: '  Renamed  ',
      services: {
        loadSkillService: vi.fn(async () => ({
          createUserSkillFromContent: vi.fn(async () => rebuiltRaw),
          createUserSkillFromFile: vi.fn(),
          editableSkillContent: vi.fn(),
        })),
      },
    })

    await harness.actions.saveEditingSkill()

    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'skill-1-ref',
    ])
    expect(harness.dataRef.current?.skills[0]).toMatchObject({
      autoMatch: false,
      contentType: 'json',
      enabled: false,
      fileName: 'source.json',
      fixed: true,
      id: 'skill-1',
      name: 'Renamed',
      updatedAt: 500,
    })
    expect(harness.state.editName).toBe('Renamed')
    expect(harness.state.editContent).toBe('updated content')
    expect(harness.state.editSaving).toBe(false)
    expect(harness.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.updateData).toHaveBeenLastCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillSaved',
      'success',
      'skills',
    )
  })

  it('rejects duplicate save and delete while Skill persistence owns the mutation gate', async () => {
    const harness = createHarness({
      data: appData([skill('skill-1')]),
      editingSkillId: 'skill-1',
      editContent: 'updated content',
      editName: 'Renamed',
    })
    const pendingService = deferred<SettingsSkillService>()
    vi.mocked(harness.services.loadSkillService).mockReturnValueOnce(
      pendingService.promise,
    )

    const firstSave = harness.actions.saveEditingSkill()
    const duplicateSave = harness.actions.saveEditingSkill()
    const deleteWhileSaving = harness.actions.deleteSkill('skill-1')

    expect(harness.services.loadSkillService).toHaveBeenCalledTimes(1)
    expect(harness.requestDangerConfirmation).not.toHaveBeenCalled()
    pendingService.resolve(harness.skillService)
    await Promise.all([firstSave, duplicateSave, deleteWhileSaving])

    expect(harness.services.persistSkillContents).toHaveBeenCalledTimes(1)
    expect(harness.dataRef.current?.skills).toHaveLength(1)
    expect(harness.state.editSaving).toBe(false)
  })

  it('contains Skill edit reporter failures without false save errors', async () => {
    const original = skill('skill-1')
    const rebuiltRaw = skill('raw-skill', { name: 'Renamed' })
    const harness = createHarness({
      data: appData([original]),
      editingSkillId: 'skill-1',
      editContent: '  updated content  ',
      editName: '  Renamed  ',
      services: {
        loadSkillService: vi.fn(async () => ({
          createUserSkillFromContent: vi.fn(async () => rebuiltRaw),
          createUserSkillFromFile: vi.fn(),
          editableSkillContent: vi.fn(),
        })),
      },
    })
    harness.setNotice.mockImplementation((_message, tone) => {
      if (tone === 'success') {
        throw new Error('notice unavailable')
      }
    })

    await expect(harness.actions.saveEditingSkill()).resolves.toBeUndefined()

    expect(harness.dataRef.current?.skills[0]).toMatchObject({
      id: 'skill-1',
      name: 'Renamed',
    })
    expect(harness.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.state.editSaving).toBe(false)
    expect(harness.setNotice).toHaveBeenCalledWith(
      'notice.skillSaved',
      'success',
      'skills',
    )
    expect(harness.setNotice).not.toHaveBeenCalledWith(
      'notice unavailable',
      'error',
      'skills',
    )
  })

  it('preserves existing Skill chunks when edited Skill rows cannot be committed', async () => {
    const original = skill('skill-1', {
      chunks: [
        {
          id: 'chunk-1',
          contentRef: 'old-ref',
          heading: 'Overview',
          keywords: [],
          tokenEstimate: 3,
        },
      ],
    })
    const rebuiltRaw = skill('raw-skill', {
      chunks: [
        {
          id: 'chunk-1',
          contentRef: 'new-ref',
          heading: 'Overview',
          keywords: [],
          tokenEstimate: 4,
        },
      ],
      name: 'Renamed',
    })
    const harness = createHarness({
      data: appData([original]),
      editingSkillId: 'skill-1',
      editContent: '  updated content  ',
      editName: '  Renamed  ',
      services: {
        loadSkillService: vi.fn(async () => ({
          createUserSkillFromContent: vi.fn(async () => rebuiltRaw),
          createUserSkillFromFile: vi.fn(),
          editableSkillContent: vi.fn(),
        })),
      },
    })
    harness.context.updateData = vi.fn(() => null)

    await harness.actions.saveEditingSkill()

    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'new-ref',
    ])
    expect(harness.services.deleteSkillContentRefs).not.toHaveBeenCalledWith([
      'old-ref',
    ])
    expect(harness.dataRef.current?.skills[0]?.chunks[0]?.contentRef).toBe(
      'old-ref',
    )
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.state.editContent).toBe('  updated content  ')
    expect(harness.state.editSaving).toBe(false)
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillSaveUnavailable',
      'error',
      'skills',
    )
  })

  it('restores edited Skill rows and preserves old chunks when the durable AppData commit fails', async () => {
    const original = skill('skill-1', {
      chunks: [
        {
          id: 'chunk-old',
          contentRef: 'old-ref',
          heading: 'Overview',
          keywords: [],
          tokenEstimate: 3,
        },
      ],
    })
    const rebuiltRaw = skill('raw-skill', {
      chunks: [
        {
          id: 'chunk-new',
          contentRef: 'new-ref',
          heading: 'Overview',
          keywords: [],
          tokenEstimate: 4,
        },
      ],
      contentHash: 'updated-hash',
      name: 'Renamed',
    })
    const harness = createHarness({
      data: appData([original]),
      editingSkillId: 'skill-1',
      editContent: 'updated content',
      editName: 'Renamed',
      services: {
        loadSkillService: vi.fn(async () => ({
          createUserSkillFromContent: vi.fn(async () => rebuiltRaw),
          createUserSkillFromFile: vi.fn(),
          editableSkillContent: vi.fn(),
        })),
        persistPublishedLocalSnapshot: vi.fn(async () => {
          throw new Error('app data write blocked')
        }),
      },
    })

    await harness.actions.saveEditingSkill()

    expect(harness.dataRef.current?.skills[0]).toEqual(original)
    expect(harness.services.deleteSkillContentRefs).toHaveBeenCalledWith([
      'new-ref',
    ])
    expect(harness.services.deleteSkillContentRefs).not.toHaveBeenCalledWith([
      'old-ref',
    ])
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.state.editContent).toBe('updated content')
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'app data write blocked',
      'error',
      'skills',
    )
  })

  it('updates Skill toggles and deletes Skill content through immediate sync paths', async () => {
    const harness = createHarness({
      data: appData([skill('skill-1'), skill('skill-2')]),
    })

    harness.actions.updateSkill('skill-1', { enabled: false })
    expect(harness.dataRef.current?.skills[0]).toMatchObject({
      enabled: false,
      updatedAt: 500,
    })
    expect(harness.scheduleAutoSync).toHaveBeenLastCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.updateData).toHaveBeenLastCalledWith(
      expect.any(Function),
      { autoSync: false },
    )

    harness.actions.updateSkillSettings({ maxAutoSkills: 3 })
    expect(harness.dataRef.current?.skillSettings.maxAutoSkills).toBe(3)
    expect(harness.scheduleAutoSync).toHaveBeenLastCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.updateData).toHaveBeenLastCalledWith(
      expect.any(Function),
      { autoSync: false },
    )

    await harness.actions.deleteSkill('skill-1')
    expect(harness.requestDangerConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'delete-skill',
        body: 'danger.deleteSkill.body',
      }),
    )
    expect(harness.services.deleteSkillContents).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'skill-1' }),
    )
    expect(harness.dataRef.current?.skills.map((item) => item.id)).toEqual([
      'skill-2',
    ])
    expect(harness.scheduleAutoSync).toHaveBeenLastCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.context.updateData).toHaveBeenLastCalledWith(
      expect.any(Function),
      { autoSync: false },
    )
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillDeleted',
      'success',
      'skills',
    )
  })

  it('invalidates a pending Skill editor load after committed deletion', async () => {
    const pendingContent = deferred<string>()
    const harness = createHarness({
      data: appData([skill('skill-1')]),
      services: {
        loadSkillService: vi.fn(async () => ({
          createUserSkillFromContent: vi.fn(),
          createUserSkillFromFile: vi.fn(),
          editableSkillContent: vi.fn(() => pendingContent.promise),
        })),
      },
    })

    const editing = harness.actions.startEditingSkill(
      harness.dataRef.current?.skills[0] as UserSkill,
    )
    expect(harness.state.editLoading).toBe(true)

    await harness.actions.deleteSkill('skill-1')
    pendingContent.resolve('stale editor content')
    await editing

    expect(harness.dataRef.current?.skills).toHaveLength(0)
    expect(harness.state.editingSkillId).toBe('')
    expect(harness.state.editContent).toBe('')
    expect(harness.state.editLoading).toBe(false)
  })

  it('cleans the latest Skill content snapshot after deletion confirmation', async () => {
    const harness = createHarness({
      data: appData([skill('skill-1')]),
    })
    harness.requestDangerConfirmation.mockImplementationOnce(async () => {
      harness.dataRef.current = appData([
        skill('skill-1', {
          chunks: [
            {
              id: 'chunk-latest',
              contentRef: 'latest-ref',
              heading: 'Latest',
              keywords: [],
              tokenEstimate: 5,
            },
          ],
        }),
      ])
      return true
    })

    await harness.actions.deleteSkill('skill-1')

    expect(harness.services.deleteSkillContents).toHaveBeenCalledWith(
      expect.objectContaining({
        chunks: [expect.objectContaining({ contentRef: 'latest-ref' })],
      }),
    )
  })

  it('keeps Skill contents when deletion cannot be committed', async () => {
    const harness = createHarness({
      data: appData([skill('skill-1'), skill('skill-2')]),
    })
    harness.context.updateData = vi.fn(() => null)

    await harness.actions.deleteSkill('skill-1')

    expect(harness.requestDangerConfirmation).toHaveBeenCalled()
    expect(harness.services.deleteSkillContents).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.skills.map((item) => item.id)).toEqual([
      'skill-1',
      'skill-2',
    ])
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillSaveUnavailable',
      'error',
      'skills',
    )
  })

  it('keeps Skill contents when the durable deletion commit fails', async () => {
    const harness = createHarness({
      data: appData([skill('skill-1'), skill('skill-2')]),
      services: {
        persistPublishedLocalSnapshot: vi.fn(async () => {
          throw new Error('app data write blocked')
        }),
      },
    })

    await harness.actions.deleteSkill('skill-1')

    expect(harness.services.deleteSkillContents).not.toHaveBeenCalled()
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'app data write blocked',
      'error',
      'skills',
    )
  })

  it('keeps Skill contents when conflict recovery retains the Skill', async () => {
    const retained = appData([skill('skill-1'), skill('skill-2')])
    const harness = createHarness({
      data: retained,
      services: {
        persistPublishedLocalSnapshot: vi.fn(async () => retained),
      },
    })

    await harness.actions.deleteSkill('skill-1')

    expect(harness.services.deleteSkillContents).not.toHaveBeenCalled()
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillSaveUnavailable',
      'error',
      'skills',
    )
  })

  it('contains Skill delete reporter failures without leaking the promise', async () => {
    const harness = createHarness({
      data: appData([skill('skill-1'), skill('skill-2')]),
    })
    harness.setNotice.mockImplementation((_message, tone) => {
      if (tone === 'success') {
        throw new Error('notice unavailable')
      }
    })

    await expect(harness.actions.deleteSkill('skill-1')).resolves.toBeUndefined()

    expect(harness.services.deleteSkillContents).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'skill-1' }),
    )
    expect(harness.dataRef.current?.skills.map((item) => item.id)).toEqual([
      'skill-2',
    ])
    expect(harness.scheduleAutoSync).toHaveBeenCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.setNotice).toHaveBeenCalledWith(
      'notice.skillDeleted',
      'success',
      'skills',
    )
  })

  it('keeps Skill data when delete confirmation is cancelled', async () => {
    const harness = createHarness({
      data: appData([skill('skill-1')]),
    })
    harness.requestDangerConfirmation.mockResolvedValueOnce(false)

    await harness.actions.deleteSkill('skill-1')

    expect(harness.services.deleteSkillContents).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.skills.map((item) => item.id)).toEqual([
      'skill-1',
    ])
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
  })

  it('reports rejected Skill delete confirmations without leaking the promise', async () => {
    const harness = createHarness({
      data: appData([skill('skill-1')]),
    })
    harness.requestDangerConfirmation.mockRejectedValueOnce(
      new Error('dialog unavailable'),
    )

    await expect(harness.actions.deleteSkill('skill-1')).resolves.toBeUndefined()

    expect(harness.services.deleteSkillContents).not.toHaveBeenCalled()
    expect(harness.context.updateData).not.toHaveBeenCalled()
    expect(harness.dataRef.current?.skills.map((item) => item.id)).toEqual([
      'skill-1',
    ])
    expect(harness.scheduleAutoSync).not.toHaveBeenCalled()
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'notice.skillSaveUnavailable',
      'error',
      'skills',
    )
  })

  it('reports Skill content cleanup failures after committed deletion', async () => {
    const cleanupFailure = new Error('Storage quota exhausted')
    const harness = createHarness({
      data: appData([skill('skill-1'), skill('skill-2')]),
      services: {
        deleteSkillContents: vi.fn(async () => {
          throw cleanupFailure
        }),
      },
    })

    await harness.actions.deleteSkill('skill-1')
    await flushPromises()

    expect(harness.dataRef.current?.skills.map((item) => item.id)).toEqual([
      'skill-2',
    ])
    expect(harness.scheduleAutoSync).toHaveBeenLastCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.setNotice).toHaveBeenCalledWith(
      'notice.skillDeleted',
      'success',
      'skills',
    )
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'Storage quota exhausted',
      'error',
      'skills',
    )
  })

  it('contains Skill content cleanup reporter failures after committed deletion', async () => {
    const cleanupFailure = new Error('Storage quota exhausted')
    const harness = createHarness({
      data: appData([skill('skill-1'), skill('skill-2')]),
      services: {
        deleteSkillContents: vi.fn(async () => {
          throw cleanupFailure
        }),
      },
    })
    harness.setNotice.mockImplementation((_message, tone) => {
      if (tone === 'error') {
        throw new Error('notice unavailable')
      }
    })

    await expect(harness.actions.deleteSkill('skill-1')).resolves.toBeUndefined()
    await flushPromises()

    expect(harness.dataRef.current?.skills.map((item) => item.id)).toEqual([
      'skill-2',
    ])
    expect(harness.scheduleAutoSync).toHaveBeenLastCalledWith(
      harness.dataRef.current,
      0,
    )
    expect(harness.setNotice).toHaveBeenCalledWith(
      'notice.skillDeleted',
      'success',
      'skills',
    )
    expect(harness.setNotice).toHaveBeenLastCalledWith(
      'Storage quota exhausted',
      'error',
      'skills',
    )
  })
})
