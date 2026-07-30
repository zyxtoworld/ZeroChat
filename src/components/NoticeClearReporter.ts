import type { NoticeTarget } from './Notice'
import type { NoticeTone } from '../services/uiRuntime'

export type NoticeClearSetNotice = (
  message: string,
  tone?: NoticeTone,
  target?: NoticeTarget,
  anchorId?: string,
) => void

export function clearNoticeSafely(setNotice: NoticeClearSetNotice): boolean {
  try {
    setNotice('')
    return true
  } catch {
    return false
  }
}
