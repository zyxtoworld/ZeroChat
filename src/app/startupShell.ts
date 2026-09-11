const startupLoadingMessages = {
  'zh-CN': '正在载入...',
  'en-US': 'Loading...',
  'es-ES': 'Cargando...',
  'hi-IN': 'लोड हो रहा है...',
  'ar-SA': 'جار التحميل...',
  'pt-BR': 'Carregando...',
  'ru-RU': 'Загрузка...',
  'ja-JP': '読み込み中...',
  'ko-KR': '불러오는 중...',
  'fr-FR': 'Chargement...',
} as const

export type StartupLocale = keyof typeof startupLoadingMessages

interface StartupShellOptions {
  document?: Document | null
  languages?: readonly string[]
  prefersDark?: boolean
}

const startupLocales = Object.keys(startupLoadingMessages) as StartupLocale[]

export function resolveStartupLocale(languages: readonly string[]): StartupLocale {
  for (const language of languages) {
    const normalized = language.trim().toLowerCase()
    const locale = startupLocales.find((candidate) =>
      normalized.startsWith(candidate.slice(0, 2).toLowerCase()),
    )
    if (locale) return locale
  }
  return 'en-US'
}

function browserLanguages(): string[] {
  if (typeof navigator === 'undefined') return []
  return [navigator.language, ...(navigator.languages ?? [])].filter(Boolean)
}

function browserPrefersDark(): boolean {
  try {
    return (
      typeof matchMedia === 'function' &&
      matchMedia('(prefers-color-scheme: dark)').matches
    )
  } catch {
    return false
  }
}

export function applyStartupShell(options: StartupShellOptions = {}): StartupLocale | null {
  const doc = options.document ?? (typeof document === 'undefined' ? null : document)
  if (!doc) return null

  const locale = resolveStartupLocale(options.languages ?? browserLanguages())
  doc.documentElement.lang = locale
  doc.documentElement.dir = locale === 'ar-SA' ? 'rtl' : 'ltr'

  const loading = doc.querySelector<HTMLElement>('[data-initial-loading]')
  if (loading) loading.textContent = startupLoadingMessages[locale]

  if (options.prefersDark ?? browserPrefersDark()) {
    doc
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', '#0f1117')
  }

  return locale
}
