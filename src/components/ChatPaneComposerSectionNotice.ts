import {
  clearNoticeSafely,
  type NoticeClearSetNotice,
} from './NoticeClearReporter'

export function clearComposerSectionNotice(
  setNotice: NoticeClearSetNotice,
): boolean {
  return clearNoticeSafely(setNotice)
}
