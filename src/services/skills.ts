import {
  createRuntimeId,
  defaultSkillSettings,
  normalizeSkillSettings,
} from './appData'
import { rt } from '../i18n'
import type { SkillSettings, UserSkill, UserSkillChunk } from '../types'
import {
  localFileTooLargeMessage,
  MAX_SKILL_FILE_BYTES,
  readLocalFileText,
} from './localFileLimits'

const MAX_CHUNK_CHARS = 2600
const MIN_CHUNK_CHARS = 720
const MAX_KEYWORDS_PER_CHUNK = 28
const MAX_KEYWORDS_PER_SKILL = 48
const MAX_CANDIDATE_SKILLS = 16
const MAX_CHUNKS_PER_AUTO_SKILL = 2
const MAX_CHUNKS_PER_FIXED_SKILL = 4

const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'has',
  'have',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'use',
  'with',
  'you',
  'your',
])

interface RankedChunk {
  chunk: UserSkillChunk
  score: number
  index: number
}

interface CandidateSkill {
  skill: UserSkill
  score: number
  fixed: boolean
}

interface PickedChunk {
  skill: UserSkill
  chunk: UserSkillChunk
  tokenBudget: number
}

export type SkillChunkContentLoader = (
  skill: UserSkill,
  chunk: UserSkillChunk,
) => Promise<string>

export interface HydratedSkillChunk {
  chunk: UserSkillChunk
  content: string
}

export type SkillContentListLoader = (
  skill: UserSkill,
) => Promise<HydratedSkillChunk[]>

const fallbackSkillHeadings = new Set([
  '概览',
  'Overview',
  'Resumen',
  'सारांश',
  'نظرة عامة',
  'Visão geral',
  'Обзор',
  '概要',
  '개요',
  'Aperçu',
])

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof globalThis.requestIdleCallback === 'function') {
      globalThis.requestIdleCallback(() => resolve(), { timeout: 32 })
      return
    }

    globalThis.setTimeout(resolve, 0)
  })
}

function stableId(prefix: string, index: number): string {
  return `${prefix}-${index + 1}`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim()
}

export function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 3.8))
}

function isCjk(value: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(
    value,
  )
}

function termsFromText(value: string): string[] {
  const terms: string[] = []
  const matches = value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []

  for (const match of matches) {
    if (isCjk(match)) {
      if (match.length <= 8) {
        terms.push(match)
      }

      for (let index = 0; index < match.length - 1; index += 1) {
        terms.push(match.slice(index, index + 2))
      }
      continue
    }

    if (match.length >= 2 && !stopWords.has(match)) {
      terms.push(match)
    }
  }

  return terms
}

function extractKeywords(value: string, limit: number): string[] {
  const counts = new Map<string, number>()

  for (const term of termsFromText(value)) {
    counts.set(term, (counts.get(term) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([term]) => term)
}

function headingFromLine(line: string): string | null {
  const markdown = line.match(/^#{1,6}\s+(.+)$/)

  if (markdown?.[1]) {
    return markdown[1].replace(/#+$/, '').trim()
  }

  return null
}

function splitSections(content: string): Array<{ heading: string; content: string }> {
  const lines = content.split('\n')
  const sections: Array<{ heading: string; lines: string[] }> = []
  let current: { heading: string; lines: string[] } = {
    heading: rt('fallback.skillHeading'),
    lines: [],
  }

  for (const line of lines) {
    const heading = headingFromLine(line)

    if (heading) {
      if (current.lines.join('\n').trim()) {
        sections.push(current)
      }

      current = {
        heading,
        lines: [],
      }
      continue
    }

    current.lines.push(line)
  }

  if (current.lines.join('\n').trim()) {
    sections.push(current)
  }

  return sections.map((section) => ({
    heading: section.heading,
    content: normalizeWhitespace(section.lines.join('\n')),
  }))
}

function splitLongText(value: string): string[] {
  const chunks: string[] = []
  let start = 0

  while (start < value.length) {
    let end = Math.min(start + MAX_CHUNK_CHARS, value.length)

    if (end < value.length) {
      const paragraphBreak = value.lastIndexOf('\n\n', end)
      const lineBreak = value.lastIndexOf('\n', end)
      const sentenceBreak = Math.max(
        value.lastIndexOf('。', end),
        value.lastIndexOf('.', end),
        value.lastIndexOf('!', end),
        value.lastIndexOf('?', end),
      )
      const softBreak = [paragraphBreak, lineBreak, sentenceBreak].find(
        (breakAt) => breakAt > start + MIN_CHUNK_CHARS,
      )

      if (softBreak) {
        end = softBreak + 1
      }
    }

    const chunk = normalizeWhitespace(value.slice(start, end))

    if (chunk) {
      chunks.push(chunk)
    }

    start = end
  }

  return chunks
}

export async function buildSkillChunks(content: string): Promise<UserSkillChunk[]> {
  const normalized = normalizeWhitespace(content)
  const chunks: UserSkillChunk[] = []

  for (const section of splitSections(normalized)) {
    for (const part of splitLongText(section.content)) {
      chunks.push({
        id: stableId('chunk', chunks.length),
        heading: section.heading,
        content: part,
        keywords: extractKeywords(`${section.heading}\n${part}`, MAX_KEYWORDS_PER_CHUNK),
        tokenEstimate: estimateTokens(part),
      })

      if (chunks.length % 6 === 0) {
        await yieldToBrowser()
      }
    }
  }

  if (chunks.length === 0 && normalized) {
    chunks.push({
      id: stableId('chunk', 0),
      heading: rt('fallback.skillHeading'),
      content: normalized,
      keywords: extractKeywords(normalized, MAX_KEYWORDS_PER_CHUNK),
      tokenEstimate: estimateTokens(normalized),
    })
  }

  return chunks
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return `${value.length}:${extractKeywords(value, 4).join('|')}`
  }

  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function contentTypeFromFile(file: File): UserSkill['contentType'] {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()

  if (name.endsWith('.json') || type.includes('json')) {
    return 'json'
  }

  if (
    name.endsWith('.md') ||
    name.endsWith('.markdown') ||
    type.includes('markdown')
  ) {
    return 'markdown'
  }

  return 'text'
}

function nameFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '')
  return withoutExtension.replace(/[-_]+/g, ' ').trim() || rt('fallback.skillName')
}

function descriptionFromContent(content: string): string {
  const line =
    content
      .split('\n')
      .map((item) => item.replace(/^#{1,6}\s+/, '').trim())
      .find((item) => item && !item.startsWith('```')) ?? ''

  return line.length > 140 ? `${line.slice(0, 137)}...` : line
}

export async function createUserSkillFromContent(
  name: string,
  content: string,
  contentType: UserSkill['contentType'] = 'text',
  fileName?: string,
): Promise<UserSkill> {
  const normalized = normalizeWhitespace(content)

  if (!normalized) {
    throw new Error(rt('notice.skillContentRequired'))
  }

  const chunks = await buildSkillChunks(normalized)
  const keywords = extractKeywords(
    [
      name,
      descriptionFromContent(normalized),
      ...chunks.map((chunk) => `${chunk.heading} ${chunk.keywords.join(' ')}`),
    ].join('\n'),
    MAX_KEYWORDS_PER_SKILL,
  )
  const now = Date.now()

  return {
    id: createRuntimeId('skill'),
    name: name.trim() || fileName || rt('fallback.skillName'),
    description: descriptionFromContent(normalized),
    fileName,
    contentType,
    sourceSize: normalized.length,
    contentHash: await sha256(normalized),
    keywords,
    chunks,
    fixed: false,
    enabled: true,
    autoMatch: true,
    createdAt: now,
    updatedAt: now,
  }
}

export async function createUserSkillFromFile(file: File): Promise<UserSkill> {
  return createUserSkillFromContent(
    nameFromFileName(file.name),
    await readLocalFileText(
      file,
      MAX_SKILL_FILE_BYTES,
      localFileTooLargeMessage(rt, MAX_SKILL_FILE_BYTES),
    ),
    contentTypeFromFile(file),
    file.name,
  )
}

export function isFallbackSkillHeading(heading: string): boolean {
  return fallbackSkillHeadings.has(heading.trim())
}

export function editableSkillContentFromChunks(
  chunks: HydratedSkillChunk[],
): string {
  let previousHeading = ''

  return chunks
    .map(({ chunk, content }) => {
      const heading = chunk.heading.trim()
      const shouldShowHeading =
        heading &&
        heading !== previousHeading &&
        !isFallbackSkillHeading(heading)

      previousHeading = heading

      return shouldShowHeading ? `# ${heading}\n${content}` : content
    })
    .join('\n\n')
}

export async function editableSkillContent(
  skill: UserSkill,
  loadSkillContents: SkillContentListLoader,
): Promise<string> {
  const chunks = await loadSkillContents(skill)

  return editableSkillContentFromChunks(chunks)
}

function overlapScore(left: Iterable<string>, right: Set<string>): number {
  let score = 0

  for (const item of left) {
    if (right.has(item)) {
      score += item.length >= 5 ? 3 : 1
    }
  }

  return score
}

function rankChunks(skill: UserSkill, queryKeywords: Set<string>): RankedChunk[] {
  return skill.chunks
    .map((chunk, index) => ({
      chunk,
      score:
        overlapScore(chunk.keywords, queryKeywords) +
        overlapScore(termsFromText(chunk.heading), queryKeywords) * 2,
      index,
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.index - right.index,
    )
}

function candidateScore(skill: UserSkill, queryKeywords: Set<string>): number {
  return (
    overlapScore(skill.keywords, queryKeywords) * 2 +
    overlapScore(termsFromText(`${skill.name} ${skill.description}`), queryKeywords)
  )
}

function candidateSkills(
  skills: UserSkill[],
  settings: SkillSettings,
  queryKeywords: Set<string>,
): CandidateSkill[] {
  const enabled = skills.filter((skill) => skill.enabled)
  const fixed = enabled
    .filter((skill) => skill.fixed)
    .map((skill) => ({
      skill,
      score: Number.MAX_SAFE_INTEGER,
      fixed: true,
    }))

  if (!settings.autoMatch || queryKeywords.size === 0) {
    return fixed
  }

  const auto = enabled
    .filter((skill) => !skill.fixed && skill.autoMatch)
    .map((skill) => ({
      skill,
      score: candidateScore(skill, queryKeywords),
      fixed: false,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.skill.name.localeCompare(right.skill.name))
    .slice(0, Math.max(MAX_CANDIDATE_SKILLS, settings.maxAutoSkills * 4))

  return [...fixed, ...auto]
}

function trimToBudget(content: string, tokenBudget: number): string {
  if (estimateTokens(content) <= tokenBudget) {
    return content
  }

  const charBudget = Math.max(120, Math.floor(tokenBudget * 3.8))
  return `${content.slice(0, charBudget).trim()}...`
}

function pickedChunks(
  skills: UserSkill[],
  rawSettings: SkillSettings | undefined,
  latestInput: string,
): PickedChunk[] {
  const settings = normalizeSkillSettings(rawSettings ?? defaultSkillSettings())
  const queryKeywords = new Set(termsFromText(latestInput))
  const candidates = candidateSkills(skills, settings, queryKeywords)
  const picked: PickedChunk[] = []
  let remainingTokens = settings.contextBudget
  let autoSkillCount = 0

  for (const candidate of candidates) {
    if (!candidate.fixed && autoSkillCount >= settings.maxAutoSkills) {
      continue
    }

    const ranked = rankChunks(candidate.skill, queryKeywords)
    const useful = candidate.fixed
      ? ranked
      : ranked.filter((rankedChunk) => rankedChunk.score > 0)
    const chunkLimit = candidate.fixed ? MAX_CHUNKS_PER_FIXED_SKILL : MAX_CHUNKS_PER_AUTO_SKILL
    let usedForSkill = 0

    for (const rankedChunk of useful.slice(0, chunkLimit)) {
      if (remainingTokens <= 80) {
        return picked
      }

      picked.push({
        skill: candidate.skill,
        chunk: rankedChunk.chunk,
        tokenBudget: remainingTokens,
      })
      remainingTokens -= Math.min(
        rankedChunk.chunk.tokenEstimate,
        remainingTokens,
      )
      usedForSkill += 1
    }

    if (!candidate.fixed && usedForSkill > 0) {
      autoSkillCount += 1
    }
  }

  return picked
}

export async function buildSkillSystemMessage(
  skills: UserSkill[],
  settings: SkillSettings | undefined,
  latestInput: string,
  loadChunkContent: SkillChunkContentLoader,
): Promise<string> {
  const chunks = pickedChunks(skills, settings, latestInput)

  if (chunks.length === 0) {
    return ''
  }

  const hydrated = await Promise.all(
    chunks.map(async (item) => ({
      ...item,
      content: trimToBudget(
        await loadChunkContent(item.skill, item.chunk),
        item.tokenBudget,
      ),
    })),
  )

  return [
    'Use these user-provided skills only when relevant. If they conflict with the latest user message, follow the latest user message.',
    '',
    ...hydrated.map(
      (item) =>
        `[Skill: ${item.skill.name}]\n${item.chunk.heading}\n${item.content}`,
    ),
  ].join('\n\n')
}

export function skillTokenTotal(skill: UserSkill): number {
  return skill.chunks.reduce((sum, chunk) => sum + chunk.tokenEstimate, 0)
}
