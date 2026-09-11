import type { NoticeTone } from './uiRuntime'

export type NoticeTarget =
  | 'chat'
  | 'sidebar'
  | 'message'
  | 'providers'
  | 'provider-capabilities'
  | 'providers-list'
  | 'providers-danger'
  | 'models'
  | 'skills'
  | 'model-audio'
  | 'model-audio-speech'
  | 'model-chat'
  | 'model-embedding'
  | 'model-image'
  | 'model-moderation'
  | 'model-realtime'
  | 'sync'
  | 'appearance'
  | 'data'
  | 'data-backup'
  | 'data-danger'
  | 'data-cloud'
  | 'guide'
  | 'guide-models'

export interface NoticeState {
  text: string
  tone: NoticeTone
  target: NoticeTarget
  anchorId: string
}
