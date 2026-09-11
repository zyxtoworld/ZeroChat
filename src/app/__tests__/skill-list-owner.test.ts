import { afterEach, describe, expect, it, vi } from 'vitest'

type HookSlot =
  | { kind: 'ref'; value: { current: unknown } }
  | { kind: 'state'; value: unknown }

const harness = vi.hoisted(() => {
  const slots: HookSlot[] = []
  const effects: Array<() => void | (() => void)> = []
  const observers: FakeObserver[] = []
  let cursor = 0

  class FakeObserver {
    callback: (entries: Array<{ isIntersecting: boolean }>) => void
    disconnected = false

    constructor(
      callback: (entries: Array<{ isIntersecting: boolean }>) => void,
    ) {
      this.callback = callback
      observers.push(this)
    }

    observe = vi.fn()
    disconnect = vi.fn(() => {
      this.disconnected = true
    })
  }

  return {
    FakeObserver,
    observers,
    effects,
    beginRender() {
      cursor = 0
      effects.length = 0
    },
    useRef(initial: unknown) {
      const index = cursor++
      const current = slots[index]
      if (!current) {
        const slot: HookSlot = {
          kind: 'ref',
          value: { current: initial },
        }
        slots[index] = slot
        return slot.value
      }
      if (current.kind !== 'ref') {
        throw new Error(`hook ${index} changed from state to ref`)
      }
      return current.value
    },
    useState(initial: unknown) {
      const index = cursor++
      const current = slots[index]
      if (!current) {
        const slot: HookSlot = {
          kind: 'state',
          value: typeof initial === 'function' ? (initial as () => unknown)() : initial,
        }
        slots[index] = slot
      }
      const slot = slots[index]
      if (!slot || slot.kind !== 'state') {
        throw new Error(`hook ${index} changed from ref to state`)
      }
      const setState = (next: unknown) => {
        slot.value =
          typeof next === 'function'
            ? (next as (value: unknown) => unknown)(slot.value)
            : next
      }
      return [slot.value, setState] as const
    },
    useEffect(effect: () => void | (() => void)) {
      effects.push(effect)
    },
    getRef(index: number) {
      const slot = slots[index]
      if (!slot || slot.kind !== 'ref') throw new Error(`missing ref ${index}`)
      return slot.value
    },
    getState(index: number) {
      const slot = slots[index]
      if (!slot || slot.kind !== 'state') throw new Error(`missing state ${index}`)
      return slot.value
    },
    reset() {
      slots.length = 0
      effects.length = 0
      observers.length = 0
      cursor = 0
    },
  }
})

const storeHarness = vi.hoisted(() => ({
  state: {
    data: {
      preferences: { language: 'en-US' },
      skillSettings: { autoMatch: true, contextBudget: 1000, maxAutoSkills: 4 },
      skills: [] as Array<Record<string, unknown>>,
    },
    skillMutationPending: false,
  },
}))

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: harness.useEffect,
  useRef: harness.useRef,
  useState: harness.useState,
}))

vi.mock('lucide-react', () =>
  Object.fromEntries(
    [
      'Check',
      'ArrowLeft',
      'ChevronDown',
      'ChevronUp',
      'Copy',
      'GripVertical',
      'Pencil',
      'Plus',
      'RefreshCw',
      'Trash2',
      'X',
    ].map((name) => [name, () => null]),
  ),
)

vi.mock('../store', () => ({
  appT: (_data: unknown, key: string) => key,
  useAppStore: Object.assign(
    (selector: (state: typeof storeHarness.state) => unknown) =>
      selector(storeHarness.state),
    { getState: () => storeHarness.state },
  ),
}))

vi.mock('../../services/interactionFocus', () => ({
  focusInteractionElement: () => true,
  restoreInteractionFocusTarget: () => null,
  scheduleInteractionFocus: () => undefined,
  scheduleInteractionFocusRetry: () => undefined,
  scrollInteractionElementIntoView: () => true,
}))

vi.mock('../skillEditor', () => ({
  createSkillEditorLoadOwner: () => ({
    begin: () => 1,
    current: () => 1,
    invalidate: vi.fn(),
  }),
  finishSkillEditorDeletion: vi.fn(),
  isCurrentSkillEditorLoad: () => true,
  loadSkillEditorDraft: vi.fn(),
  resetSkillEditorDraft: vi.fn(),
  submitSkillEditorDraft: vi.fn(async () => false),
}))

vi.mock('../../i18n', () => ({
  formatSyncTimestamp: () => '',
  providerPresetLabel: () => '',
  resolveAppLocale: () => 'en-US',
  resolveLocale: () => 'en-US',
  translate: () => 'label',
}))

vi.mock('./FeatureHint', () => ({ FeatureHint: () => null }))
vi.mock('./SecretInput', () => ({ SecretInput: () => null }))

const { SkillsTab } = await import('../components/SettingsView')

function skills(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    autoMatch: true,
    chunks: [],
    contentHash: `hash-${index}`,
    contentType: 'markdown',
    createdAt: index,
    description: '',
    enabled: true,
    fixed: false,
    id: `skill-${index}`,
    keywords: [],
    name: `skill-${index}`,
    sourceSize: 1,
    updatedAt: index,
  }))
}

function runEffects() {
  return harness.effects.map((effect) => effect())
}

afterEach(() => {
  harness.reset()
  vi.unstubAllGlobals()
})

describe('SkillsTab intersection observer ownership', () => {
  it('does not let an old observer reduce the current list render limit', () => {
    vi.stubGlobal('IntersectionObserver', harness.FakeObserver)
    const target = { closest: vi.fn(() => null) }

    storeHarness.state.data.skills = skills(100)
    harness.beginRender()
    SkillsTab()
    harness.getRef(10).current = target
    const firstCleanups = runEffects()
    const oldObserver = harness.observers[0]
    expect(oldObserver).toBeDefined()

    oldObserver.callback([{ isIntersecting: true }])
    expect(harness.getState(8)).toBe(100)

    firstCleanups[2]?.()
    storeHarness.state.data.skills = skills(1000)
    harness.beginRender()
    SkillsTab()
    harness.getRef(10).current = target
    runEffects()
    const currentObserver = harness.observers[1]
    currentObserver.callback([{ isIntersecting: true }])
    expect(harness.getState(8)).toBe(180)

    oldObserver.callback([{ isIntersecting: true }])

    expect(harness.getState(8)).toBe(180)
  })
})
