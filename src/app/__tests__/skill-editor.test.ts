import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UserSkill } from '../../types'
import { createAppTranslator } from '../i18n'
import {
  createSkillEditorLoadOwner,
  isCurrentSkillEditorLoad,
  loadSkillEditorDraft,
  resetSkillEditorDraft,
  submitSkillEditorDraft,
} from '../skillEditor'
import settingsSource from '../components/SettingsView.tsx?raw'

describe('skill editor loading', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('localizes load failures and restores the draft without exposing diagnostics', async () => {
    const sentinel = 'C:\\Users\\private\\skill.md sk-test-secret-1234567890'
    const error = new Error(sentinel)
    const state = {
      editingId: null as string | null,
      nameDraft: '',
      contentDraft: '',
      loadingId: null as string | null,
    }
    const notify = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const set = <K extends keyof typeof state>(
      key: K,
      value:
        | (typeof state)[K]
        | ((current: (typeof state)[K]) => (typeof state)[K]),
    ) => {
      state[key] =
        typeof value === 'function'
          ? (value as (current: (typeof state)[K]) => (typeof state)[K])(
              state[key],
            )
          : value
    }
    const resetDraft = () => {
      state.editingId = null
      state.nameDraft = ''
      state.contentDraft = ''
      state.loadingId = null
    }

    await loadSkillEditorDraft(
      { id: 'skill-1', name: 'Private skill' },
      async () => {
        throw error
      },
      {
        setEditingId: (value) => set('editingId', value),
        setNameDraft: (value) => set('nameDraft', value),
        setContentDraft: (value) => set('contentDraft', value),
        setLoadingId: (value) => set('loadingId', value),
        resetDraft,
        notify,
        translate: createAppTranslator('zh'),
      },
    )

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith('技能内容读取失败，请稍后重试。', 'error')
    expect(notify.mock.calls.flat().join(' ')).not.toContain(sentinel)
    expect(state).toEqual({
      editingId: null,
      nameDraft: '',
      contentDraft: '',
      loadingId: null,
    })
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(sentinel)
    expect(consoleError).toHaveBeenCalledWith('[app] skill content load failed')
  })

  it('contains notification failures after a skill load error', async () => {
    const state = {
      editingId: 'old-skill' as string | null,
      nameDraft: 'Old skill',
      contentDraft: 'old content',
      loadingId: 'old-skill' as string | null,
    }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const notificationSentinel =
      'C:\\private\\notification.log sk-notify-secret-1234567890'
    const notify = vi.fn(() => {
      throw new Error(notificationSentinel)
    })

    await expect(
      loadSkillEditorDraft(
        { id: 'skill-2', name: 'New skill' },
        async () => {
          throw new Error('load failed')
        },
        {
          setEditingId: (value) => {
            state.editingId = value
          },
          setNameDraft: (value) => {
            state.nameDraft = value
          },
          setContentDraft: (value) => {
            state.contentDraft = value
          },
          setLoadingId: (value) => {
            state.loadingId =
              typeof value === 'function' ? value(state.loadingId) : value
          },
          resetDraft: () => {
            state.editingId = null
            state.nameDraft = ''
            state.contentDraft = ''
            state.loadingId = null
          },
          notify,
          translate: createAppTranslator('en'),
        },
      ),
    ).resolves.toBeUndefined()

    expect(state).toEqual({
      editingId: null,
      nameDraft: '',
      contentDraft: '',
      loadingId: null,
    })
    expect(notify).toHaveBeenCalledWith(
      'Could not load the skill content. Try again.',
      'error',
    )
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(notificationSentinel)
    expect(consoleError).toHaveBeenCalledWith('[app] skill content load failed')
    expect(consoleError).toHaveBeenCalledWith(
      '[app] skill content load failure notification failed',
    )
  })

  it('does not let an older skill load overwrite a newer editor selection', async () => {
    const state = {
      editingId: null as string | null,
      nameDraft: '',
      contentDraft: '',
      loadingId: null as string | null,
    }
    let resolveFirst!: (content: string) => void
    let resolveSecond!: (content: string) => void
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<string>((resolve) => {
      resolveSecond = resolve
    })
    const loadSkillContent = vi.fn((id: string) =>
      id === 'skill-first' ? first : second,
    )
    let currentGeneration = 0
    const createActions = (generation: number) => ({
      isCurrent: () => currentGeneration === generation,
      setEditingId: (value: string | null) => {
        state.editingId = value
      },
      setNameDraft: (value: string) => {
        state.nameDraft = value
      },
      setContentDraft: (value: string) => {
        state.contentDraft = value
      },
      setLoadingId: (
        value:
          | string
          | null
          | ((current: string | null) => string | null),
      ) => {
        state.loadingId =
          typeof value === 'function' ? value(state.loadingId) : value
      },
      resetDraft: () => {
        state.editingId = null
        state.nameDraft = ''
        state.contentDraft = ''
        state.loadingId = null
      },
      notify: vi.fn(),
      translate: createAppTranslator('en'),
    })

    const firstGeneration = ++currentGeneration
    const firstLoad = loadSkillEditorDraft(
      { id: 'skill-first', name: 'First skill' },
      loadSkillContent,
      createActions(firstGeneration),
    )
    await vi.waitFor(() =>
      expect(loadSkillContent).toHaveBeenCalledWith('skill-first'),
    )

    const secondGeneration = ++currentGeneration
    const secondLoad = loadSkillEditorDraft(
      { id: 'skill-second', name: 'Second skill' },
      loadSkillContent,
      createActions(secondGeneration),
    )
    await vi.waitFor(() =>
      expect(loadSkillContent).toHaveBeenCalledWith('skill-second'),
    )

    resolveSecond('second content')
    await secondLoad
    resolveFirst('first content')
    await firstLoad

    expect(state).toMatchObject({
      editingId: 'skill-second',
      nameDraft: 'Second skill',
      contentDraft: 'second content',
      loadingId: null,
    })
  })

  it('does not let a cancelled skill load repopulate the cleared editor', async () => {
    const state = {
      editingId: null as string | null,
      nameDraft: '',
      contentDraft: '',
      loadingId: null as string | null,
    }
    let resolvePending!: (content: string) => void
    const pending = new Promise<string>((resolve) => {
      resolvePending = resolve
    })
    let currentGeneration = 1
    const notify = vi.fn()
    const setters = {
      setEditingId: (value: string | null) => {
        state.editingId = value
      },
      setNameDraft: (value: string) => {
        state.nameDraft = value
      },
      setContentDraft: (value: string) => {
        state.contentDraft = value
      },
      setLoadingId: (
        value:
          | string
          | null
          | ((current: string | null) => string | null),
      ) => {
        state.loadingId =
          typeof value === 'function' ? value(state.loadingId) : value
      },
    }
    const load = loadSkillEditorDraft(
      { id: 'skill-cancelled', name: 'Cancelled skill' },
      async () => pending,
      {
        isCurrent: () => currentGeneration === 1,
        ...setters,
        resetDraft: () =>
          resetSkillEditorDraft({
            invalidateLoad: () => {
              currentGeneration += 1
            },
            ...setters,
          }),
        notify,
        translate: createAppTranslator('en'),
      },
    )

    resetSkillEditorDraft({
      invalidateLoad: () => {
        currentGeneration += 1
      },
      ...setters,
    })
    resolvePending('stale content')
    await load

    expect(state).toEqual({
      editingId: null,
      nameDraft: '',
      contentDraft: '',
      loadingId: null,
    })
    expect(notify).not.toHaveBeenCalled()
  })

  it('contains a late skill load after its editor owner is unmounted', async () => {
    const owner = createSkillEditorLoadOwner()
    const generation = owner.begin()
    let rejectPending!: (error: Error) => void
    const pending = new Promise<string>((_resolve, reject) => {
      rejectPending = reject
    })
    const setContentDraft = vi.fn()
    const setLoadingId = vi.fn()
    const resetDraft = vi.fn()
    const notify = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const load = loadSkillEditorDraft(
      { id: 'skill-unmounted', name: 'Unmounted skill' },
      async () => pending,
      {
        isCurrent: () => owner.current() === generation,
        setEditingId: vi.fn(),
        setNameDraft: vi.fn(),
        setContentDraft,
        setLoadingId,
        resetDraft,
        notify,
        translate: createAppTranslator('en'),
      },
    )

    owner.invalidate()
    rejectPending(new Error('C:\\private\\late-skill.md sk-late-secret'))
    await load

    expect(setContentDraft).toHaveBeenCalledTimes(1)
    expect(setContentDraft).toHaveBeenCalledWith('')
    expect(setLoadingId).toHaveBeenCalledTimes(1)
    expect(resetDraft).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(consoleError).not.toHaveBeenCalled()
  })

  it('drops a load after its Skill is deleted or replaced', async () => {
    const skill = {
      contentHash: 'hash-deleted',
      id: 'skill-deleted',
      name: 'Deleted skill',
    } as UserSkill
    let resolvePending: (content: string) => void = () => undefined
    const pending = new Promise<string>((resolve) => {
      resolvePending = resolve
    })
    let currentSkills: readonly UserSkill[] | undefined = [skill]
    let currentGeneration = 1
    const state = {
      contentDraft: '',
      editingId: null as string | null,
      loadingId: null as string | null,
      nameDraft: '',
    }
    const load = loadSkillEditorDraft(skill, async () => pending, {
      isCurrent: () =>
        isCurrentSkillEditorLoad(
          skill,
          1,
          currentGeneration,
          currentSkills,
        ),
      setEditingId: (value) => {
        state.editingId = value
      },
      setNameDraft: (value) => {
        state.nameDraft = value
      },
      setContentDraft: (value) => {
        state.contentDraft = value
      },
      setLoadingId: (value) => {
        state.loadingId =
          typeof value === 'function' ? value(state.loadingId) : value
      },
      isTargetDeleted: () =>
        currentGeneration === 1 &&
        currentSkills?.some((candidate) => candidate.id === skill.id) !== true,
      resetDraft: () => {
        state.editingId = null
        state.nameDraft = ''
        state.contentDraft = ''
        state.loadingId = null
      },
      notify: vi.fn(),
      translate: createAppTranslator('en'),
    })

    currentSkills = []
    resolvePending('stale content')
    await load

    expect(state).toMatchObject({
      contentDraft: '',
      editingId: null,
      loadingId: null,
      nameDraft: '',
    })
    expect(
      isCurrentSkillEditorLoad(
        skill,
        1,
        currentGeneration,
        [{ ...skill, contentHash: 'hash-replaced' }],
      ),
    ).toBe(false)
    expect(
      isCurrentSkillEditorLoad(
        skill,
        1,
        currentGeneration,
        [{ ...skill, enabled: !skill.enabled } as UserSkill],
      ),
    ).toBe(true)
    currentGeneration += 1
    expect(
      isCurrentSkillEditorLoad(skill, 1, currentGeneration, [skill]),
    ).toBe(false)
  })

  it('keeps the Settings view wired to the sanitized loading action', () => {
    expect(settingsSource).toContain(
      'await loadSkillEditorDraft(skill, loadSkillContent',
    )
    expect(settingsSource).toContain('resetSkillEditorDraft({')
    expect(settingsSource).toContain(
      'const [skillLoadOwner] = useState(createSkillEditorLoadOwner)',
    )
    expect(settingsSource).toContain('skillLoadOwner.invalidate()')
    expect(settingsSource).toContain('invalidateLoad: skillLoadOwner.invalidate')
    expect(settingsSource).toContain('isTargetDeleted: () =>')
    expect(settingsSource).toContain(
      'const skillEditFocusOwner = document.activeElement',
    )
    expect(settingsSource).toContain(
      'restoreSkillEditorFocus(skillEditFocusOwner)',
    )
    expect(settingsSource).toContain(
      'const cancelSkillEdit = () => {\n    const skillEditFocusOwner = document.activeElement\n    resetDraft()\n    restoreSkillEditorFocus(skillEditFocusOwner)',
    )
    expect(settingsSource).toContain('submitSkillEditorDraft(')
    expect(settingsSource).not.toContain(
      "useAppStore.getState().notify(t('skills.addRequired')",
    )
    expect(settingsSource).not.toMatch(/notify\(\s*error(?:\.message|\b)/)
  })
})

describe('skill editor submission', () => {
  it('delegates blank drafts to the store validation boundary', async () => {
    const addSkill = vi.fn(async () => false)
    const saveSkillContent = vi.fn(async () => false)

    await expect(
      submitSkillEditorDraft(null, '  ', '\n\t', {
        addSkill,
        saveSkillContent,
      }),
    ).resolves.toBe(false)

    expect(addSkill).toHaveBeenCalledOnce()
    expect(addSkill).toHaveBeenCalledWith('', '')
    expect(saveSkillContent).not.toHaveBeenCalled()
  })

  it('uses the edit action for a trimmed draft and preserves its result', async () => {
    const addSkill = vi.fn(async () => true)
    const saveSkillContent = vi.fn(async () => false)

    await expect(
      submitSkillEditorDraft('skill-1', '  Name  ', '  Content  ', {
        addSkill,
        saveSkillContent,
      }),
    ).resolves.toBe(false)

    expect(saveSkillContent).toHaveBeenCalledWith('skill-1', 'Name', 'Content')
    expect(addSkill).not.toHaveBeenCalled()
  })
})
