import type { ReactElement } from 'react'
import type { NoticeTone } from '../services/uiRuntime'

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

type NoticeVariant = 'plain' | 'modal' | 'field' | 'message'

interface NoticeProps {
  text: string
  tone: NoticeTone
  variant?: NoticeVariant
}

interface TargetNoticeProps {
  notice: NoticeState
  targets: readonly NoticeTarget[]
  variant?: NoticeVariant
  hidden?: boolean
}

interface MessageNoticeProps {
  notice: NoticeState
  messageId: string
  hidden?: boolean
}

function noticeA11yProps(tone: NoticeTone): {
  role: 'alert' | 'status'
  'aria-live': 'assertive' | 'polite'
  'aria-atomic': true
} {
  return {
    role: tone === 'error' ? 'alert' : 'status',
    'aria-live': tone === 'error' ? 'assertive' : 'polite',
    'aria-atomic': true,
  }
}

export function Notice({
  text,
  tone,
  variant = 'modal',
}: NoticeProps): ReactElement {
  const variantClass =
    variant === 'plain'
      ? ''
      : variant === 'message'
        ? 'modal-notice message-notice'
        : `${variant}-notice`
  const className = ['notice', variantClass, tone].filter(Boolean).join(' ')

  return (
    <div className={className} {...noticeA11yProps(tone)}>
      {text}
    </div>
  )
}

export function TargetNotice({
  notice,
  targets,
  variant = 'modal',
  hidden = false,
}: TargetNoticeProps): ReactElement | null {
  if (hidden || !notice.text || !targets.includes(notice.target)) {
    return null
  }

  return <Notice text={notice.text} tone={notice.tone} variant={variant} />
}

export function MessageNotice({
  notice,
  messageId,
  hidden = false,
}: MessageNoticeProps): ReactElement | null {
  if (
    hidden ||
    !notice.text ||
    notice.target !== 'message' ||
    notice.anchorId !== messageId
  ) {
    return null
  }

  return <Notice text={notice.text} tone={notice.tone} variant="message" />
}
