import { Marked, Renderer, type Tokens } from 'marked'

export interface RenderMarkdownLabels {
  copy: string
  copied: string
  copyCode: string
  copyFailed: string
  plainText: string
}

const languageAliases: Record<string, string> = {
  'c++': 'cpp',
  cs: 'csharp',
  cxx: 'cpp',
  docker: 'dockerfile',
  htm: 'xml',
  html: 'xml',
  js: 'javascript',
  jsx: 'javascript',
  kt: 'kotlin',
  md: 'markdown',
  pl: 'perl',
  ps: 'powershell',
  ps1: 'powershell',
  psm1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  yml: 'yaml',
}

const keywordGroups: Record<string, string> = {
  bash: 'case do done elif else esac fi for function if in then while',
  cpp: 'auto class const constexpr else enum for if include namespace return struct template using',
  csharp: 'async await class const else enum for if namespace new public return static using',
  css: 'align-items background border color display font-size gap grid margin padding position',
  dart: 'async await class const else enum extends final for if import return var void',
  diff: 'diff index',
  dockerfile: 'add arg cmd copy entrypoint env expose from label run user volume workdir',
  go: 'chan const defer else for func go if import interface package range return struct type',
  hcl: 'data default description locals module output provider resource terraform type variable',
  ini: 'false no off on true yes',
  java: 'class else enum final for if import interface new package private public return static',
  javascript: 'async await class const else export for from function if import let return type',
  json: 'false null true',
  kotlin: 'class data else for fun if import interface object return val var when',
  lua: 'and do else elseif end false for function if local nil return then true',
  markdown: 'TODO NOTE WARNING',
  perl: 'else elsif foreach if my our package return sub unless use while',
  php: 'class echo else foreach function if namespace new private public return use',
  powershell: 'begin catch class else foreach function if param process return switch throw try while',
  python: 'async await class def elif else for from if import in return with',
  r: 'else for function if in library next repeat return while',
  ruby: 'class def do else elsif end if module require return',
  rust: 'async await crate else enum fn for if impl let match mod pub struct use',
  scala: 'case class def else extends for if import match object return trait val var',
  sql: 'and as by create delete from group insert join limit order select update where',
  swift: 'class else enum for func guard if import let return struct var',
  toml: 'false true',
  typescript: 'async await class const else export for from function if import interface let return type',
  vue: 'defineProps defineEmits script setup template',
  xml: 'DOCTYPE',
  yaml: 'false null true',
}

const safeMarkdownLinkProtocols = new Set(['http:', 'https:'])
const safeDataImagePattern =
  /^data:image\/(?:gif|png|jpeg|webp);base64,(?:[a-z\d+/]{4})*(?:[a-z\d+/]{4}|[a-z\d+/]{2}==|[a-z\d+/]{3}=)$/i
const leadingZeroWidthPattern = /^[\u200b-\u200f\ufeff]+/

let cachedMarkdown:
  | {
      key: string
      parser: Marked<string, string>
    }
  | undefined

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeLanguage(value: string): string {
  const language = value
    .trim()
    .split(/\s+/)[0]
    .replace(/[^\w+#.-]/g, '')
    .toLowerCase()

  return languageAliases[language] ?? language
}

function highlightedCode(code: string, language: string): string {
  const keywords = keywordGroups[language]?.split(' ')

  if (!language || !keywords) {
    return escapeHtml(code)
  }

  const keywordPattern = keywords
    .map((keyword) => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  const tokenPattern = new RegExp(
    "(\\/\\/.*|#.*|--.*|\\/\\*[\\s\\S]*?\\*\\/|\"(?:\\\\.|[^\"])*\"|'(?:\\\\.|[^'])*'|`(?:\\\\.|[^`])*`" +
      `|\\b(?:${keywordPattern})\\b|\\b\\d+(?:\\.\\d+)?\\b)`,
    'gi',
  )

  return code
    .split(tokenPattern)
    .filter((part) => part !== '')
    .map((part) => {
      const escaped = escapeHtml(part)

      if (/^(\/\/|#|--|\/\*)/.test(part)) {
        return `<span class="hljs-comment">${escaped}</span>`
      }

      if (/^["'`]/.test(part)) {
        return `<span class="hljs-string">${escaped}</span>`
      }

      if (/^\d/.test(part)) {
        return `<span class="hljs-number">${escaped}</span>`
      }

      if (new RegExp(`^(?:${keywordPattern})$`, 'i').test(part)) {
        return `<span class="hljs-keyword">${escaped}</span>`
      }

      return escaped
    })
    .join('')
}

function typographicText(value: string): string {
  return value
    .replace(/\((c|r|tm)\)/gi, (_match, name: string) =>
      name.length === 2 ? '™' : name.toLowerCase() === 'c' ? '©' : '®',
    )
    .replace(/\+-/g, '±')
    .replace(/\.{2,}/g, '…')
    .replace(/([?!])…/g, '$1..')
    .replace(/([?!]){4,}/g, '$1$1$1')
    .replace(/,{2,}/g, ',')
    .replace(/(^|[^-])---(?=[^-]|$)/gm, '$1—')
    .replace(/(^|\s)--(?=\s|$)/gm, '$1–')
    .replace(/(^|[^-\s])--(?=[^-\s]|$)/gm, '$1–')
    .replace(/([\p{L}\p{N}])'(?=[\p{L}\p{N}])/gu, '$1’')
    .replace(/(^|[\s([{])"(?=\S)/g, '$1“')
    .replace(/(\S)"(?=$|[\s.,!?;:)\]}])/g, '$1”')
    .replace(/(^|[\s([{])'(?=\S)/g, '$1‘')
    .replace(/(\S)'(?=$|[\s.,!?;:)\]}])/g, '$1’')
}

function hasUrlWhitespaceOrControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return /\s/u.test(character) || codePoint <= 0x1f || codePoint === 0x7f
  })
}

function safeMarkdownLinkUrl(value: string): string | undefined {
  const trimmed = value.trim()

  if (!trimmed || hasUrlWhitespaceOrControl(trimmed)) {
    return undefined
  }

  try {
    const url = new URL(trimmed)

    if (
      !safeMarkdownLinkProtocols.has(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return undefined
    }

    return escapeHtml(url.href)
  } catch {
    return undefined
  }
}

function safeMarkdownImageUrl(value: string): string | undefined {
  const trimmed = value.trim()

  return safeDataImagePattern.test(trimmed) ? escapeHtml(trimmed) : undefined
}

function rendererKey(labels: RenderMarkdownLabels): string {
  return JSON.stringify([
    labels.copy,
    labels.copied,
    labels.copyCode,
    labels.copyFailed,
    labels.plainText,
  ])
}

function createMarkdownParser(labels: RenderMarkdownLabels): Marked<string, string> {
  const renderer = new Renderer<string, string>()
  const defaultTable = renderer.table

  renderer.code = ({ text, lang }: Tokens.Code) => {
    const rawLanguage = normalizeLanguage(lang ?? '')
    const language = rawLanguage || labels.plainText
    const code = text.endsWith('\n') ? text : `${text}\n`
    const codeHtml = highlightedCode(code, rawLanguage)
    const languageClass = rawLanguage ? ` language-${escapeHtml(rawLanguage)}` : ''

    return [
      `<div class="markdown-code-block" data-language="${escapeHtml(language)}">`,
      '<div class="markdown-code-header">',
      `<span>${escapeHtml(language)}</span>`,
      `<button type="button" class="code-copy-button" aria-label="${escapeHtml(labels.copyCode)}" title="${escapeHtml(labels.copyCode)}" data-tooltip="${escapeHtml(labels.copyCode)}" data-copy-label="${escapeHtml(labels.copy)}" data-copy-code-label="${escapeHtml(labels.copyCode)}" data-copied-label="${escapeHtml(labels.copied)}" data-copy-failed-label="${escapeHtml(labels.copyFailed)}" aria-live="polite">${escapeHtml(labels.copy)}</button>`,
      '</div>',
      `<pre><code class="hljs${languageClass}">${codeHtml}</code></pre>`,
      '</div>',
    ].join('')
  }

  renderer.html = ({ block, text }: Tokens.HTML | Tokens.Tag) => {
    const escaped = escapeHtml(text)
    return block ? `<p>${escaped}</p>\n` : escaped
  }

  renderer.link = function ({ href, raw, text, title, tokens }: Tokens.Link) {
    const safeUrl = safeMarkdownLinkUrl(href)

    if (!safeUrl) {
      return escapeHtml(raw)
    }

    const automatic = raw === text || raw === href || raw === `<${text}>`
    const content = automatic ? escapeHtml(text) : this.parser.parseInline(tokens)
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''

    return `<a href="${safeUrl}"${titleAttribute} target="_blank" rel="noopener noreferrer">${content}</a>`
  }

  renderer.image = function ({ href, raw, text, title, tokens }: Tokens.Image) {
    const safeUrl = safeMarkdownImageUrl(href)

    if (!safeUrl) {
      return escapeHtml(raw)
    }

    const alt = tokens
      ? this.parser.parseInline(tokens, this.parser.textRenderer)
      : text
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : ''

    return `<img src="${safeUrl}" alt="${escapeHtml(alt)}"${titleAttribute}>`
  }

  renderer.table = function (token: Tokens.Table) {
    return `<div class="markdown-table-scroll">${defaultTable.call(this, token)}</div>`
  }

  renderer.text = function (token: Tokens.Text | Tokens.Escape) {
    if ('tokens' in token && token.tokens) {
      return this.parser.parseInline(token.tokens)
    }

    if ('escaped' in token && token.escaped) {
      return token.text
    }

    return escapeHtml(typographicText(token.text))
  }

  return new Marked<string, string>({
    async: false,
    breaks: true,
    gfm: true,
    renderer,
  })
}

function markdownParser(labels: RenderMarkdownLabels): Marked<string, string> {
  const key = rendererKey(labels)

  if (cachedMarkdown?.key !== key) {
    cachedMarkdown = {
      key,
      parser: createMarkdownParser(labels),
    }
  }

  return cachedMarkdown.parser
}

export function renderMarkdown(
  content: string,
  labels: RenderMarkdownLabels,
): string {
  return markdownParser(labels).parse(content.replace(leadingZeroWidthPattern, ''), {
    async: false,
  })
}

export function markdownHighlightLanguageCount(): number {
  return Object.keys(keywordGroups).length
}
