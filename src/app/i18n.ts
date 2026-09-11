import type { AppData } from '../types'
import { resolveLocale, translate } from '../i18n'
import { displayConversationTitle } from '../services/conversations'
import { en, ja, zh, type AppStringKey } from './strings'

export type AppLocale = 'zh' | 'en' | 'ja'

export function resolveAppLocale(data: AppData | null): AppLocale {
  const pref = data?.preferences.language ?? 'system'
  const tag =
    pref === 'system'
      ? (typeof navigator !== 'undefined' ? navigator.language : 'en')
      : pref
  const normalized = tag.toLowerCase()
  if (normalized.startsWith('zh')) return 'zh'
  if (normalized.startsWith('ja')) return 'ja'
  return 'en'
}

export function createAppTranslator(
  locale: AppLocale,
): (key: AppStringKey) => string {
  const dict = locale === 'zh' ? zh : locale === 'ja' ? ja : en
  return (key) => dict[key] ?? en[key] ?? key
}

export type MarkdownLabelKey =
  | 'copy'
  | 'copied'
  | 'copyCode'
  | 'copyFailed'
  | 'markdownFallback'
  | 'plainText'

export type MarkdownLabels = (key: MarkdownLabelKey) => string

export function createMarkdownLabels(
  t: (key: AppStringKey) => string,
): MarkdownLabels {
  return (key) => t(`message.${key}` as AppStringKey)
}

export function localizedConversationTitle(
  data: AppData | null,
  title: string,
): string {
  const locale = resolveLocale(data?.preferences.language ?? 'system')
  return displayConversationTitle(title, (key, values) =>
    translate(locale, key, values),
  )
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatTime(ts: number, locale: AppLocale): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (locale === 'zh') {
    return `${d.getMonth() + 1}月${d.getDate()}日`
  }
  if (locale === 'ja') {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function formatDateGroup(ts: number, locale: AppLocale): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  if (locale === 'zh' || locale === 'ja') {
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function formatSyncTimestamp(ts: number, locale: AppLocale): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(
    locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US',
  )
}
