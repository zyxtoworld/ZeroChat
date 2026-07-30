import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const failures = []

function extractSupportedLocales(source) {
  const match = source.match(/const supportedLocales:\s*Locale\[\]\s*=\s*\[([\s\S]*?)\]/)

  if (!match) {
    failures.push('Unable to find supportedLocales in src/i18n.ts.')
    return []
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

function localeName(locale) {
  return locale.split('-')[0]
}

const i18nSourceText = await readFile('src/i18n.ts', 'utf8').catch((error) => {
  failures.push(`Missing src/i18n.ts: ${error.message}`)
  return ''
})
const supportedLocales = extractSupportedLocales(i18nSourceText)
const localeNames = supportedLocales.map(localeName)
const duplicateLocaleNames = localeNames.filter(
  (name, index) => localeNames.indexOf(name) !== index,
)

if (duplicateLocaleNames.length) {
  failures.push(
    `Short locale names must be unique for i18n dictionaries: ${duplicateLocaleNames.join(', ')}`,
  )
}

const localeTags = Object.fromEntries(
  supportedLocales.map((locale) => [localeName(locale), locale]),
)
const localeSources = Object.fromEntries(
  supportedLocales.map((locale) => [
    localeName(locale),
    `src/locales/${locale}.ts`,
  ]),
)
const lazyLocaleNames = localeNames
const brokenPattern = /[�]|A帽|铆|莽|锚|啶|賱|袪|鏃|頃|鞏|淡|Ð|Ñ|Ã|Â|XQZ|ZXQ/
const suspiciousSplitPattern =
  /^:|(?:Avantages de|Limites de|La synchronisation)$|API de discussion AI API|API de génération d'images API/
const knownBadTranslationPattern =
  /のクリア|の削除 これ|チャット レコード|無効です JSON|無効です base64|\[最初にデータ\]|フラグメント数|スイッチ プロトコル|の制限:|확인 복사|숨기기 이미지|표시 생성|데이터 먼저|와 일치하지 않습니다\.|잘못되었습니다\. JSON|입력한 후 생성됨|보내기 및 재생성 메시지|^स्थानीय मोड में$|साफ़ करने के लिए कोई क्लाउड डेटा नहीं है यह|से मेल नहीं खाता|खुली सेटिंग|पीढ़ी बंद करो|संगीतकार विधा|सेटिंग्स में मॉडल जोड़ें > पहले मॉडल|पेशेवर:/
const allowedEmptyValues = new Set()
const compactPlaceholderBudgets = new Map([
  ['placeholder.baseUrl', { exact: 'https://api.example.com/v1', max: 26 }],
  ['placeholder.workerEndpoint', { exact: 'https://worker.example', max: 22 }],
  ['placeholder.syncPassphrase', { max: 44 }],
  ['placeholder.skillContent', { max: 42 }],
  ['message.imageInpaintPlaceholder', { max: 28 }],
  ['placeholder.cloudflareAccessKey', { max: 18 }],
])
const expectedLanguageLabels = new Map([
  ['language.en-US', 'English'],
  ['language.es-ES', 'Español'],
  ['language.hi-IN', 'हिन्दी'],
  ['language.ar-SA', 'العربية'],
  ['language.pt-BR', 'Português'],
  ['language.ru-RU', 'Русский'],
  ['language.ja-JP', '日本語'],
  ['language.ko-KR', '한국어'],
  ['language.fr-FR', 'Français'],
  ['language.zh-CN', '中文'],
])
const missingLanguageLabelLocales = Object.values(localeTags).filter(
  (locale) => !expectedLanguageLabels.has(`language.${locale}`),
)

if (missingLanguageLabelLocales.length) {
  failures.push(
    `Expected language autonym labels are missing for: ${missingLanguageLabelLocales.join(', ')}`,
  )
}

const sourceCache = new Map()

async function readSource(sourcePath) {
  const cached = sourceCache.get(sourcePath)

  if (cached) {
    return cached
  }

  const source = await readFile(sourcePath, 'utf8')
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  )
  const parsed = { source, sourceFile }

  sourceCache.set(sourcePath, parsed)
  return parsed
}

function unwrap(node) {
  while (
    node &&
    (ts.isAsExpression(node) ||
      ts.isSatisfiesExpression?.(node) ||
      ts.isParenthesizedExpression(node))
  ) {
    node = node.expression
  }

  return node
}

function propertyName(node) {
  const name = node.name

  if (
    name &&
    (ts.isStringLiteral(name) ||
      ts.isNumericLiteral(name) ||
      ts.isIdentifier(name))
  ) {
    return name.text
  }

  return null
}

function stringValue(node) {
  const value = unwrap(node)

  return ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)
    ? value.text
    : null
}

function stringArrayValues(arrayLiteral) {
  const values = []

  for (const element of arrayLiteral.elements) {
    const value = stringValue(element)

    if (value == null) {
      return null
    }

    values.push(value)
  }

  return values
}

function findExportedStringArray(sourceFile, name) {
  let values = null

  function visit(node) {
    if (values) {
      return
    }

    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) {
          continue
        }

        const initializer = declaration.initializer && unwrap(declaration.initializer)

        if (initializer && ts.isArrayLiteralExpression(initializer)) {
          values = stringArrayValues(initializer)
          return
        }
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return values
}

function dictionaryEntries(objectLiteral) {
  const entries = new Map()

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue
    }

    const key = propertyName(property)

    if (key) {
      entries.set(key, stringValue(property.initializer))
    }
  }

  return entries
}

function dictionaryEntriesFromValues(values, sourceName) {
  const entries = new Map()

  if (values.length !== translationKeys.length) {
    failures.push(
      `${sourceName} has ${values.length} locale values for ${translationKeys.length} translation keys.`,
    )
  }

  for (let index = 0; index < Math.min(values.length, translationKeys.length); index += 1) {
    entries.set(translationKeys[index], values[index])
  }

  return entries
}

function dictionariesFromSource(sourceFile, localeNamesInFile, sourceName) {
  const dictionaries = new Map()

  function entriesFromInitializer(initializer) {
    const unwrapped = unwrap(initializer)
    let objectLiteral = null
    let values = null

    if (ts.isObjectLiteralExpression(unwrapped)) {
      objectLiteral = unwrapped
    }

    if (ts.isCallExpression(unwrapped)) {
      const argument = unwrapped.arguments[0] && unwrap(unwrapped.arguments[0])

      if (argument && ts.isObjectLiteralExpression(argument)) {
        objectLiteral = argument
      }

      if (argument && ts.isArrayLiteralExpression(argument)) {
        values = stringArrayValues(argument)
      }
    }

    if (objectLiteral) {
      return dictionaryEntries(objectLiteral)
    }

    if (values) {
      return dictionaryEntriesFromValues(values, sourceName)
    }

    return null
  }

  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          (localeNamesInFile.length > 0 &&
            !localeNamesInFile.includes(declaration.name.text)) ||
          !declaration.initializer
        ) {
          continue
        }

        const name = declaration.name.text
        const entries = entriesFromInitializer(declaration.initializer)

        if (entries) {
          dictionaries.set(name, entries)
        }
      }
    }

    if (ts.isExportAssignment(node) && !node.isExportEquals) {
      const entries = entriesFromInitializer(node.expression)

      if (entries) {
        dictionaries.set('default', entries)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return dictionaries
}

function placeholders(value) {
  return Array.from(String(value ?? '').matchAll(/\{[A-Za-z0-9_]+\}/g))
    .map((match) => match[0])
    .sort()
    .join('|')
}

function textLength(value) {
  return Array.from(String(value ?? '')).length
}

const dictionaries = new Map()
const { sourceFile: localeKeysSourceFile } = await readSource('src/locales/keys.ts')
const translationKeys = findExportedStringArray(
  localeKeysSourceFile,
  'translationKeys',
) ?? []

if (translationKeys.length === 0) {
  failures.push('src/locales/keys.ts must export a non-empty translationKeys array.')
}

for (const locale of localeNames) {
  const sourcePath = localeSources[locale]
  const { sourceFile } = await readSource(sourcePath)
  const namesInFile = sourcePath.endsWith('i18n.ts') ? [locale] : []
  const parsed = dictionariesFromSource(sourceFile, namesInFile, sourcePath)
  const dictionary = parsed.get(locale) ?? Array.from(parsed.values())[0]

  if (dictionary) {
    dictionaries.set(locale, dictionary)
  }
}
const base = dictionaries.get('zh')
const english = dictionaries.get('en')
const { source: i18nSource } = await readSource('src/i18n.ts')
const { source: appShellSource } = await readSource('src/App.tsx')
const { source: appRootSource } = await readSource('src/ZeroChatAppRoot.tsx')
const { source: appBootstrapControllerSource } = await readSource(
  'src/services/appBootstrapController.ts',
)
const { source: appChromeControllerSource } = await readSource(
  'src/services/appChromeController.ts',
)
const { source: appRuntimeControllerSource } = await readSource(
  'src/services/appRuntimeController.ts',
)
const { source: appStateScreensSource } = await readSource('src/components/AppStateScreens.tsx')
const { source: conversationLifecycleControllerSource } = await readSource(
  'src/services/conversationLifecycleController.ts',
)
const { source: conversationServiceSource } = await readSource('src/services/conversations.ts')
const indexHtml = await readFile('index.html', 'utf8')
const startupScript = await readFile('public/zerochat-startup.js', 'utf8')
const appSource = `${appShellSource}\n${appRootSource}\n${appBootstrapControllerSource}\n${appChromeControllerSource}\n${appRuntimeControllerSource}\n${conversationLifecycleControllerSource}`

const requiredSystemLocaleMarkers = [
  "let runtimeLocale: Locale = resolveLocale('system')",
  "const languageModes: LanguageMode[] = ['system', ...supportedLocales]",
  "navigator.languages?.length ? [...navigator.languages] : [navigator.language]",
  'function localeFromLanguage(language: string): Locale | null',
  'for (const language of languages)',
  "export async function loadLocale(locale: Locale): Promise<void>",
  'const localeLoadPromises = new Map<Locale, Promise<void>>()',
  'localeLoadPromises.delete(locale)',
]
const requiredAppLocaleMarkers = [
  "const [locale, setLocale] = useState<Locale>(() => resolveLocale('system'))",
  'const locale = appServices.resolveInitialLocale(initial)',
  'return resolveLocale(data.preferences.language, getLanguages())',
  'await appServices.loadLocale(locale)',
  'context.setLocale(bootstrapped.locale)',
  'loadLocale(targetLocale)',
  'if (!data) {',
]
const requiredAppStateScreensLocaleMarkers = [
  "<p>{t('ui.loading')}</p>",
]
const requiredStartupLocaleMarkers = [
  'src="%BASE_URL%zerochat-startup.js" defer vite-ignore',
  '[navigator.language,...navigator.languages]',
  ".map(l=>a.find(v=>l.toLowerCase().startsWith(v[0]+v[1]))).find(Boolean)||'en-US'",
  'd=document.documentElement',
  "d.dir=l==='ar-SA'?'rtl':'ltr'",
  "document.querySelector('[data-initial-loading]')",
]
const forbiddenBlockingLocaleMarkers = [
  'const localeSettled = localeReady && locale === targetLocale',
  'if (!localeSettled || !data || !activeConversation || !activeProvider)',
]
const missingSystemLocaleMarkers = requiredSystemLocaleMarkers.filter(
  (marker) => !i18nSource.includes(marker),
)
const missingLazyLocaleLoaders = lazyLocaleNames
  .map((locale) => localeTags[locale])
  .filter((locale) => !i18nSource.includes(`'${locale}': () => import('./locales/${locale}')`))
const eagerLocaleImports = lazyLocaleNames
  .map((locale) => localeTags[locale])
  .filter((locale) => new RegExp(`^import .*['"]\\.\\/locales\\/${locale}['"]`, 'm').test(i18nSource))

if (missingSystemLocaleMarkers.length) {
  failures.push(
    `system-language lazy i18n markers are missing: ${missingSystemLocaleMarkers.join(' | ')}`,
  )
}

const missingAppLocaleMarkers = requiredAppLocaleMarkers.filter(
  (marker) => !appSource.includes(marker),
)

if (missingAppLocaleMarkers.length) {
  failures.push(
    `app language-readiness markers are missing: ${missingAppLocaleMarkers.join(' | ')}`,
  )
}

const missingAppStateScreensLocaleMarkers = requiredAppStateScreensLocaleMarkers.filter(
  (marker) => !appStateScreensSource.includes(marker),
)

if (missingAppStateScreensLocaleMarkers.length) {
  failures.push(
    `app state screen language-readiness markers are missing: ${missingAppStateScreensLocaleMarkers.join(' | ')}`,
  )
}

const missingStartupLocaleMarkers = requiredStartupLocaleMarkers.filter(
  (marker) => !`${indexHtml}\n${startupScript}`.includes(marker),
)

if (missingStartupLocaleMarkers.length) {
  failures.push(
    `startup shell system-language markers are missing: ${missingStartupLocaleMarkers.join(' | ')}`,
  )
}

const missingStartupLoadingLocales = Object.values(localeTags).filter(
  (locale) => !startupScript.includes(`'${locale}'`),
)

if (missingStartupLoadingLocales.length) {
  failures.push(
    `startup shell loading copy is missing for: ${missingStartupLoadingLocales.join(', ')}`,
  )
}

const blockingLocaleMarkers = forbiddenBlockingLocaleMarkers.filter((marker) =>
  appSource.includes(marker),
)

if (blockingLocaleMarkers.length) {
  failures.push(
    `app should not full-screen block while switching lazy-loaded languages: ${blockingLocaleMarkers.join(' | ')}`,
  )
}

if (missingLazyLocaleLoaders.length) {
  failures.push(
    `lazy locale loaders are missing for: ${missingLazyLocaleLoaders.join(', ')}`,
  )
}

if (eagerLocaleImports.length) {
  failures.push(
    `lazy locales should not be eagerly imported in src/i18n.ts: ${eagerLocaleImports.join(', ')}`,
  )
}

if (!base || !english) {
  failures.push('Missing zh or en dictionary.')
} else {
  const defaultConversationTitles = localeNames
    .map((locale) => dictionaries.get(locale)?.get('conversation.newTitle'))
    .filter((value) => typeof value === 'string' && value.length > 0)
  const missingDefaultTitleAliases = defaultConversationTitles.filter(
    (title) => !conversationServiceSource.includes(title),
  )
  const unsafeDefaultTitleAliases = ["'新对'", "'नई चै'", "'대'"].filter((title) =>
    conversationServiceSource.includes(title),
  )

  if (missingDefaultTitleAliases.length) {
    failures.push(
      `Conversation service default title aliases are missing: ${missingDefaultTitleAliases.join(', ')}`,
    )
  }

  if (unsafeDefaultTitleAliases.length) {
    failures.push(
      `Conversation service default title aliases are too broad or truncated: ${unsafeDefaultTitleAliases.join(', ')}`,
    )
  }

  if (!conversationLifecycleControllerSource.includes("context.t('conversation.newTitle'),")) {
    failures.push('New local conversations must be created with the current localized title.')
  }

  const baseKeys = Array.from(base.keys()).sort()

  for (const locale of localeNames) {
    const dictionary = dictionaries.get(locale)

    if (!dictionary) {
      failures.push(`${locale}: dictionary is missing.`)
      continue
    }

    const missing = baseKeys.filter((key) => !dictionary.has(key))
    const extra = Array.from(dictionary.keys()).filter((key) => !base.has(key))
    const broken = Array.from(dictionary.entries())
      .filter(([, value]) => typeof value === 'string' && brokenPattern.test(value))
      .map(([key]) => key)
    const empty = Array.from(dictionary.entries())
      .filter(
        ([key, value]) =>
          String(value ?? '') === '' && !allowedEmptyValues.has(`${locale}:${key}`),
      )
      .map(([key]) => key)
    const suspiciousSplit = Array.from(dictionary.entries())
      .filter(([, value]) => typeof value === 'string' && suspiciousSplitPattern.test(value))
      .map(([key]) => key)
    const knownBadTranslations = Array.from(dictionary.entries())
      .filter(([, value]) => typeof value === 'string' && knownBadTranslationPattern.test(value))
      .map(([key]) => key)
    const placeholderMismatch = baseKeys.filter(
      (key) =>
        dictionary.has(key) &&
        english.has(key) &&
        placeholders(dictionary.get(key)) !== placeholders(english.get(key)),
    )
    const compactPlaceholderFailures = Array.from(compactPlaceholderBudgets.entries())
      .filter(([key, budget]) => {
        const value = dictionary.get(key)

        return (
          typeof value !== 'string' ||
          (budget.exact && value !== budget.exact) ||
          (budget.max && textLength(value) > budget.max)
        )
      })
      .map(([key, budget]) => {
        const value = String(dictionary.get(key) ?? '')
        const exactMessage = budget.exact ? `, expected ${budget.exact}` : ''

        return `${key} (${textLength(value)}/${budget.max}${exactMessage})`
      })
    const languageLabelMismatch = Array.from(expectedLanguageLabels.entries())
      .filter(([key, value]) => dictionary.get(key) !== value)
      .map(([key]) => key)

    if (missing.length) {
      failures.push(`${locale}: missing ${missing.length} keys: ${missing.slice(0, 8).join(', ')}`)
    }

    if (extra.length) {
      failures.push(`${locale}: has ${extra.length} extra keys: ${extra.slice(0, 8).join(', ')}`)
    }

    if (broken.length) {
      failures.push(`${locale}: has suspicious text in ${broken.length} keys: ${broken.slice(0, 8).join(', ')}`)
    }

    if (empty.length) {
      failures.push(`${locale}: has empty translations in ${empty.length} keys: ${empty.slice(0, 8).join(', ')}`)
    }

    if (suspiciousSplit.length) {
      failures.push(
        `${locale}: has likely split translation fragments in ${suspiciousSplit.length} keys: ${suspiciousSplit
          .slice(0, 8)
          .join(', ')}`,
      )
    }

    if (knownBadTranslations.length) {
      failures.push(
        `${locale}: has known low-quality translation fragments in ${knownBadTranslations.length} keys: ${knownBadTranslations
          .slice(0, 8)
          .join(', ')}`,
      )
    }

    if (placeholderMismatch.length) {
      failures.push(
        `${locale}: placeholder mismatch in ${placeholderMismatch.length} keys: ${placeholderMismatch
          .slice(0, 8)
          .join(', ')}`,
      )
    }

    if (compactPlaceholderFailures.length) {
      failures.push(
        `${locale}: compact placeholders exceed mobile-safe copy budgets: ${compactPlaceholderFailures.join(', ')}`,
      )
    }

    if (languageLabelMismatch.length) {
      failures.push(
        `${locale}: language labels should use stable autonyms in ${languageLabelMismatch.length} keys: ${languageLabelMismatch
          .slice(0, 8)
          .join(', ')}`,
      )
    }
  }
}

if (failures.length) {
  throw new Error(`i18n completeness checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('i18n completeness checks passed')
