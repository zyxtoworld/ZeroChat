import type { SkillChunkContentLoader } from './skills'
import { now as currentNow } from './appData'
import { loadSkillService as loadDefaultSkillService } from './lazy'
import { loadSkillChunkContent as loadDefaultSkillChunkContent } from '../storage/db'
import type {
  AppData,
  ChatMessage,
} from '../types'

interface SkillSystemMessageService {
  buildSkillSystemMessage: (
    skills: AppData['skills'],
    settings: AppData['skillSettings'],
    latestInput: string,
    loadChunkContent: SkillChunkContentLoader,
  ) => Promise<string>
}

export interface RequestMessagesWithSkillsOptions {
  latestInput: string
  loadSkillChunkContent?: SkillChunkContentLoader
  loadSkillService?: () => Promise<SkillSystemMessageService>
  messages: ChatMessage[]
  now?: () => number
  snapshot: AppData | null
}

export async function requestMessagesWithSkills({
  latestInput,
  loadSkillChunkContent = loadDefaultSkillChunkContent,
  loadSkillService = loadDefaultSkillService,
  messages,
  now = currentNow,
  snapshot,
}: RequestMessagesWithSkillsOptions): Promise<ChatMessage[]> {
  if (!snapshot?.skills.some((skill) => skill.enabled)) {
    return messages
  }

  const skillService = await loadSkillService()
  const content = await skillService.buildSkillSystemMessage(
    snapshot.skills,
    snapshot.skillSettings,
    latestInput,
    loadSkillChunkContent,
  )

  if (!content) {
    return messages
  }

  const createdAt = now()

  return [
    {
      id: `skill-context-${createdAt}`,
      role: 'system',
      content,
      createdAt,
    },
    ...messages,
  ]
}
