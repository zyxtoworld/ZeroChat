import { beforeAll, describe, expect, it, vi } from 'vitest'

import { loadLocale, setRuntimeLocale } from '../../i18n'
import type { SkillSettings, UserSkill, UserSkillChunk } from '../../types'
import {
  buildSkillChunks,
  buildSkillSystemMessage,
  createUserSkillFromContent,
  createUserSkillFromFile,
  editableSkillContent,
  editableSkillContentFromChunks,
  estimateTokens,
  isFallbackSkillHeading,
  skillTokenTotal,
} from '../skills'

beforeAll(async () => {
  await loadLocale('en-US')
  setRuntimeLocale('en-US')
})

async function skill(name: string, content: string): Promise<UserSkill> {
  return createUserSkillFromContent(name, content, 'markdown')
}

function chunkContent(_skill: UserSkill, chunk: UserSkillChunk): Promise<string> {
  return Promise.resolve(chunk.content ?? chunk.contentPreview ?? '')
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true
    }
  }

  return false
}

describe('skills service', () => {
  it('builds bounded chunks with localized fallback headings', async () => {
    const chunks = await buildSkillChunks(
      [
        'Introductory notes about reviewing provider sync behavior.',
        '',
        '# Deep Section',
        'x'.repeat(3200),
      ].join('\n'),
    )

    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0].heading).toBe('Overview')
    expect(chunks.some((chunk) => chunk.heading === 'Deep Section')).toBe(true)
    expect(chunks.every((chunk) => chunk.tokenEstimate > 0)).toBe(true)
  })

  it('yields through requestIdleCallback while chunking large Skills', async () => {
    const originalRequestIdleCallback = globalThis.requestIdleCallback
    const idleCallbacks: IdleRequestCallback[] = []

    vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
      idleCallbacks.push(callback)
      callback({
        didTimeout: false,
        timeRemaining: () => 16,
      } as IdleDeadline)
      return 1
    })

    try {
      const chunks = await buildSkillChunks(
        Array.from(
          { length: 7 },
          (_, index) => `# Section ${index + 1}\n${'chunking guidance '.repeat(180)}`,
        ).join('\n\n'),
      )

      expect(chunks.length).toBeGreaterThanOrEqual(6)
      expect(idleCallbacks.length).toBeGreaterThan(0)
    } finally {
      vi.stubGlobal('requestIdleCallback', originalRequestIdleCallback)
    }
  })

  it('falls back to a timer when requestIdleCallback throws synchronously', async () => {
    const originalRequestIdleCallback = globalThis.requestIdleCallback

    vi.stubGlobal('requestIdleCallback', () => {
      throw new Error('embedded idle scheduler is unavailable')
    })

    try {
      const chunks = await buildSkillChunks(
        Array.from(
          { length: 7 },
          (_, index) => `# Section ${index + 1}\n${'chunking guidance '.repeat(180)}`,
        ).join('\n\n'),
      )

      expect(chunks.length).toBeGreaterThanOrEqual(6)
    } finally {
      vi.stubGlobal('requestIdleCallback', originalRequestIdleCallback)
    }
  })

  it('settles chunking when both idle scheduling paths throw synchronously', async () => {
    const originalRequestIdleCallback = globalThis.requestIdleCallback
    const originalSetTimeout = globalThis.setTimeout

    vi.stubGlobal('requestIdleCallback', () => {
      throw new Error('embedded idle scheduler is unavailable')
    })
    vi.stubGlobal('setTimeout', () => {
      throw new Error('embedded timer is unavailable')
    })

    try {
      const chunks = await buildSkillChunks(
        Array.from(
          { length: 7 },
          (_, index) => `# Section ${index + 1}\n${'chunking guidance '.repeat(180)}`,
        ).join('\n\n'),
      )

      expect(chunks.length).toBeGreaterThan(0)
    } finally {
      vi.stubGlobal('requestIdleCallback', originalRequestIdleCallback)
      vi.stubGlobal('setTimeout', originalSetTimeout)
    }
  })

  it('prefers paragraph soft breaks when splitting long Skill sections', async () => {
    const chunks = await buildSkillChunks(
      `# Soft Breaks\n${'alpha '.repeat(130)}\n\n${'beta '.repeat(520)}`,
    )

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.content).toBe('alpha '.repeat(130).trim())
    expect(chunks[1]?.content?.startsWith('beta beta')).toBe(true)
  })

  it('does not split a Unicode surrogate pair at a chunk boundary', async () => {
    const emoji = '😀'
    const chunks = await buildSkillChunks(
      `# Unicode boundary\n${'a'.repeat(2599)}${emoji}tail`,
    )

    expect(chunks).toHaveLength(2)
    expect(chunks.every((chunk) => !hasUnpairedSurrogate(chunk.content ?? ''))).toBe(
      true,
    )
    expect(chunks.map((chunk) => chunk.content ?? '').join('')).toContain(emoji)
  })

  it('does not split a Unicode surrogate pair while trimming Skill context', async () => {
    const fixed = {
      ...(await skill('Unicode policy', 'Keep this policy pinned.')),
      fixed: true,
    }
    const emoji = '😀'
    const content = `${'a'.repeat(379)}${emoji}tail`

    const message = await buildSkillSystemMessage(
      [fixed],
      {
        autoMatch: false,
        contextBudget: 100,
        maxAutoSkills: 1,
      },
      '',
      async () => content,
    )

    expect(hasUnpairedSurrogate(message)).toBe(false)
    expect(message).toContain(emoji)
  })

  it('creates stable searchable metadata from pasted Skill content', async () => {
    const created = await skill(
      '',
      [
        '# React Hooks',
        'Review dependency arrays, cleanup functions, stale closures, memoization, and effect ordering.',
      ].join('\n'),
    )

    expect(created.name).toBe('Skill')
    expect(created.contentType).toBe('markdown')
    expect(created.description).toBe('React Hooks')
    expect(created.keywords).toContain('react')
    expect(created.chunks[0]).toMatchObject({
      id: 'chunk-1',
      heading: 'React Hooks',
    })
    expect(skillTokenTotal(created)).toBeGreaterThan(0)
    expect(estimateTokens('abcd')).toBe(2)
  })

  it('falls back to deterministic content hashes when WebCrypto is unavailable', async () => {
    const originalCrypto = globalThis.crypto

    vi.stubGlobal('crypto', undefined)

    try {
      const created = await skill(
        'Fallback hash',
        'alpha beta beta gamma gamma gamma',
      )

      expect(created.contentHash).toMatch(/^\d+:/)
      expect(created.contentHash).toContain('gamma')
    } finally {
      vi.stubGlobal('crypto', originalCrypto)
    }
  })

  it('keeps Skill ids unique in the same millisecond without WebCrypto', async () => {
    const originalCrypto = globalThis.crypto
    vi.spyOn(Date, 'now').mockReturnValue(123_456)
    vi.stubGlobal('crypto', undefined)

    try {
      const first = await skill('First fallback id', 'alpha guidance')
      const second = await skill('Second fallback id', 'beta guidance')

      expect(first.id).toMatch(/^skill-[a-z0-9]+-123456-[0-9]+$/)
      expect(second.id).not.toBe(first.id)
    } finally {
      vi.stubGlobal('crypto', originalCrypto)
      vi.restoreAllMocks()
    }
  })

  it('keeps skill creation usable when WebCrypto id generation fails', async () => {
    const originalCrypto = globalThis.crypto
    vi.stubGlobal('crypto', {
      subtle: originalCrypto?.subtle,
      randomUUID: () => {
        throw new Error('randomUUID unavailable')
      },
    })

    try {
      const created = await skill('Fallback skill id', 'alpha guidance')

      expect(created.id).toMatch(/^skill-/)
    } finally {
      vi.stubGlobal('crypto', originalCrypto)
    }
  })

  it('handles empty content, heading-only content, files, and CJK keywords', async () => {
    await expect(createUserSkillFromContent('Empty', '   ')).rejects.toThrow(
      /skill content/i,
    )

    const headingOnly = await buildSkillChunks('# Heading only')
    expect(headingOnly).toMatchObject([
      {
        heading: 'Overview',
        content: '# Heading only',
      },
    ])

    const fromFile = await createUserSkillFromFile(
      new File(['{"sync":true}'], 'sync-rules.json', {
        type: 'application/json',
      }),
    )
    expect(fromFile).toMatchObject({
      name: 'sync rules',
      contentType: 'json',
      fileName: 'sync-rules.json',
    })

    const markdownFile = await createUserSkillFromFile(
      new File(['# Markdown\nUse structured notes.'], 'release-notes.markdown', {
        type: 'text/plain',
      }),
    )
    expect(markdownFile).toMatchObject({
      name: 'release notes',
      contentType: 'markdown',
      fileName: 'release-notes.markdown',
    })

    const textFile = await createUserSkillFromFile(
      new File(['Plain text instructions.'], 'plain.txt', {
        type: 'text/plain',
      }),
    )
    expect(textFile).toMatchObject({
      name: 'plain',
      contentType: 'text',
      fileName: 'plain.txt',
    })

    const cjk = await skill('CJK sync', '# 国际化\n请检查同步同步错误恢复')
    expect(cjk.keywords).toContain('同步')
  })

  it('normalizes odd Skill files and long descriptions without misleading metadata', async () => {
    const fallbackName = await createUserSkillFromFile(
      new File(['```'], '.txt', {
        type: 'application/octet-stream',
      }),
    )
    expect(fallbackName).toMatchObject({
      name: 'Skill',
      contentType: 'text',
      description: '',
      fileName: '.txt',
    })

    const longHeading = 'A'.repeat(160)
    const longDescription = await skill(
      'Long description',
      `# ${longHeading}\nKeep the generated Skill list compact.`,
    )
    expect(longDescription.description).toBe(`${'A'.repeat(137)}...`)
  })

  it('uses readable sentence breaks when paragraph breaks are unavailable', async () => {
    const chunks = await buildSkillChunks(
      `# Sentence Breaks\n${'alpha '.repeat(150)}. ${'beta '.repeat(520)}`,
    )

    expect(chunks.length).toBeGreaterThan(1)
    const [firstChunk, secondChunk] = chunks

    if (
      !firstChunk ||
      !secondChunk ||
      typeof firstChunk.content !== 'string' ||
      typeof secondChunk.content !== 'string'
    ) {
      throw new Error('Expected sentence-break fixture to create two chunks.')
    }

    expect(firstChunk.content.endsWith('.')).toBe(true)
    expect(secondChunk.content.startsWith('beta beta')).toBe(true)
  })

  it('skips whitespace-only slices in pathologically spaced Skill content', async () => {
    const chunks = await buildSkillChunks(
      `# Spacing\nstart${' '.repeat(7000)}end`,
    )

    expect(chunks.map((chunk) => chunk.content)).toEqual(['start', 'end'])
  })

  it('rebuilds editable Skill content without leaking localized fallback headings', async () => {
    const source = await skill(
      'Editable skill',
      [
        'Plain opening guidance.',
        '',
        '# Hooks',
        'Check cleanup behavior.',
        '',
        '# Hooks',
        'Check stale closures.',
      ].join('\n'),
    )
    const hydrated = [
      {
        chunk: {
          id: 'chunk-1',
          heading: 'Overview',
          content: 'Plain opening guidance.',
          keywords: [],
          tokenEstimate: 1,
        },
        content: 'Plain opening guidance.',
      },
      {
        chunk: {
          id: 'chunk-2',
          heading: 'Hooks',
          content: 'Check cleanup behavior.',
          keywords: [],
          tokenEstimate: 1,
        },
        content: 'Check cleanup behavior.',
      },
      {
        chunk: {
          id: 'chunk-3',
          heading: 'Hooks',
          content: 'Check stale closures.',
          keywords: [],
          tokenEstimate: 1,
        },
        content: 'Check stale closures.',
      },
      {
        chunk: {
          id: 'chunk-4',
          heading: '概览',
          content: '本地化默认标题不该写回正文。',
          keywords: [],
          tokenEstimate: 1,
        },
        content: '本地化默认标题不该写回正文。',
      },
    ]

    expect(isFallbackSkillHeading(' Overview ')).toBe(true)
    expect(isFallbackSkillHeading('Hooks')).toBe(false)
    expect(editableSkillContentFromChunks(hydrated)).toBe(
      [
        'Plain opening guidance.',
        '',
        '# Hooks',
        'Check cleanup behavior.',
        '',
        'Check stale closures.',
        '',
        '本地化默认标题不该写回正文。',
      ].join('\n'),
    )
    await expect(
      editableSkillContent(source, async (skillToLoad) => {
        expect(skillToLoad).toBe(source)
        return hydrated
      }),
    ).resolves.toContain('# Hooks\nCheck cleanup behavior.')
  })

  it('injects only relevant auto-matched Skills within configured limits', async () => {
    const reactSkill = await skill(
      'React review',
      '# Hooks\nCheck dependency arrays, stale closures, cleanup functions, and memoized callbacks.',
    )
    const sqlSkill = await skill(
      'Database review',
      '# SQL\nCheck indexes, migrations, transaction isolation, slow queries, and rollback paths.',
    )
    const disabledSkill = {
      ...(await skill('Disabled React', '# Hooks\nThis disabled content must not appear.')),
      enabled: false,
    }
    const settings: SkillSettings = {
      autoMatch: true,
      contextBudget: 400,
      maxAutoSkills: 1,
    }

    const message = await buildSkillSystemMessage(
      [sqlSkill, disabledSkill, reactSkill],
      settings,
      'Please review React hook dependencies and cleanup behavior.',
      chunkContent,
    )

    expect(message).toContain('[Skill: React review]')
    expect(message).not.toContain('Database review')
    expect(message).not.toContain('Disabled React')
  })

  it('always includes fixed enabled Skills, even when auto-match is off', async () => {
    const fixed = {
      ...(await skill('Pinned release policy', '# Release\nAlways check release blockers.')),
      fixed: true,
    }
    const auto = await skill(
      'React review',
      '# Hooks\nCheck dependency arrays, stale closures, cleanup functions.',
    )

    const message = await buildSkillSystemMessage(
      [auto, fixed],
      {
        autoMatch: false,
        contextBudget: 400,
        maxAutoSkills: 3,
      },
      'React dependency review',
      chunkContent,
    )

    expect(message).toContain('[Skill: Pinned release policy]')
    expect(message).not.toContain('[Skill: React review]')
  })

  it('handles punctuation-only prompts and short auto-match terms', async () => {
    const fixed = {
      ...(await skill('Pinned policy', '# Policy\nAlways preserve release evidence.')),
      fixed: true,
    }
    const punctuationMessage = await buildSkillSystemMessage(
      [fixed],
      {
        autoMatch: false,
        contextBudget: 400,
        maxAutoSkills: 1,
      },
      '---',
      chunkContent,
    )

    expect(punctuationMessage).toContain('[Skill: Pinned policy]')

    const sql = await skill('SQL review', '# SQL\nCheck SQL joins and indexes.')
    const shortTermMessage = await buildSkillSystemMessage(
      [sql],
      {
        autoMatch: true,
        contextBudget: 400,
        maxAutoSkills: 1,
      },
      'sql',
      chunkContent,
    )

    expect(shortTermMessage).toContain('[Skill: SQL review]')
  })

  it('uses default Skill settings and stable ordering for equal auto matches', async () => {
    const beta = await skill(
      'Beta review',
      '# Shared\nCheck stability, cleanup, and rollback behavior.',
    )
    const alpha = await skill(
      'Alpha review',
      '# Shared\nCheck stability, cleanup, and rollback behavior.',
    )

    const message = await buildSkillSystemMessage(
      [beta, alpha],
      undefined,
      'stability cleanup rollback',
      chunkContent,
    )

    expect(message).toContain('[Skill: Alpha review]')
    expect(message).toContain('[Skill: Beta review]')
    expect(message.indexOf('[Skill: Alpha review]')).toBeLessThan(
      message.indexOf('[Skill: Beta review]'),
    )
  })

  it('returns no system message when no Skill is relevant', async () => {
    const sqlSkill = await skill(
      'Database review',
      '# SQL\nCheck indexes, migrations, transaction isolation, and rollback paths.',
    )

    await expect(
      buildSkillSystemMessage(
        [sqlSkill],
        {
          autoMatch: true,
          contextBudget: 400,
          maxAutoSkills: 3,
        },
        'Review button alignment and contrast.',
        chunkContent,
      ),
    ).resolves.toBe('')
  })

  it('trims large Skill chunks to the remaining token budget', async () => {
    const fixed = {
      ...(await skill('Large pinned policy', `# Policy\n${'release blocker '.repeat(1000)}`)),
      fixed: true,
    }
    const message = await buildSkillSystemMessage(
      [fixed],
      {
        autoMatch: false,
        contextBudget: 600,
        maxAutoSkills: 1,
      },
      'release',
      chunkContent,
    )

    expect(message).toContain('[Skill: Large pinned policy]')
    expect(message).toContain('...')
    expect(message.length).toBeLessThan(2600)
  })
})
