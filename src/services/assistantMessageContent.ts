const assistantHtmlTagPattern = /<\s*\/?\s*(?!(?:svg|math|iframe)\b)[a-z][^>]*>/gi
const assistantHtmlPresentPattern = /<\s*\/?\s*[a-z]/i
const assistantHiddenHtmlPattern = /<\s*(analysis|function[-_]call|noscript|reasoning|script|style|scratchpad|template|think|tool(?:[-_]call)?)\b[^>]*>[\s\S]*?(?:<\s*\/\s*\1\s*>|$)/gi
const assistantHtmlEntityPattern = /&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi
const namedAssistantHtmlEntities: Record<string, string> = {
  amp: '&',
  apos: "'",
  bull: '•',
  copy: '©',
  gt: '>',
  hellip: '…',
  lt: '<',
  nbsp: ' ',
  quot: '"',
}

/** Converts common model-generated HTML/XML wrappers into the UI's Markdown subset. */
export function normalizeAssistantMessageContent(content: string): string {
  if (!assistantHtmlPresentPattern.test(content)) return content

  const output: string[] = []
  const outside: string[] = []
  let inFence = false
  const flushOutside = (): void => {
    const value = normalizeAssistantHtml(outside.join('\n'))
    if (value) output.push(value)
    outside.length = 0
  }

  for (const line of content.split('\n')) {
    if (/^\s*```/.test(line)) {
      if (!inFence) flushOutside()
      inFence = !inFence
      output.push(line)
    } else if (inFence) output.push(line)
    else outside.push(line)
  }
  if (inFence) output.push(...outside)
  else flushOutside()
  return output.join('\n')
}

function normalizeAssistantHtml(content: string): string {
  if (!assistantHtmlPresentPattern.test(content)) return content

  const preBlocks: string[] = []
  let value = content.replace(assistantHiddenHtmlPattern, '').replace(
    /<\s*pre\b[^>]*>[\s\S]*?<\s*\/\s*pre\s*>/gi,
    (block) => {
      const inner = block
        .replace(/^<\s*pre\b[^>]*>/i, '')
        .replace(/<\s*\/\s*pre\s*>$/i, '')
        .replace(/<\s*\/?\s*code\b[^>]*>/gi, '')
      return `__ZEROCHAT_PRE_${preBlocks.push(inner) - 1}__`
    },
  )

  value = value
    .replace(/<\s*h([1-6])\b[^>]*>/gi, (_, level: string) => `\n\n${'#'.repeat(+level)} `)
    .replace(/<\s*\/\s*h[1-6]\s*>/gi, '\n\n')
    .replace(/<\s*a\b([^>]*)>([\s\S]*?)<\s*\/\s*a\s*>/gi, (_, attrs: string, label: string) => {
      const rawUrl = htmlAttribute(attrs, 'href')
      const url = safeAssistantLinkUrl(rawUrl ? decodeAssistantHtmlEntities(rawUrl) : undefined)
      return url ? `[${label}](${url})` : label
    })
    .replace(/<\s*img\b([^>]*)>/gi, (_, attrs: string) => {
      const alt = htmlAttribute(attrs, 'alt')
      return alt ? decodeAssistantHtmlEntities(alt) : ''
    })
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*ol\b[^>]*>([\s\S]*?)<\s*\/\s*ol\s*>/gi, (_, body: string) => {
      let number = 0
      return body.replace(/<\s*li\b[^>]*>/gi, () => `\n${++number}. `)
    })
    .replace(/<\s*\/?\s*(?:ul|ol)\b[^>]*>/gi, '\n\n')
    .replace(/<\s*(\/?)\s*li\b[^>]*>/gi, (_, closing: string) => (closing ? '' : '\n- '))
    .replace(/<\s*blockquote\b[^>]*>/gi, '\n\n> ')
    .replace(/<\s*\/\s*blockquote\s*>/gi, '\n\n')
    .replace(/<\s*tr\b[^>]*>([\s\S]*?)<\s*\/\s*tr\s*>/gi, (_, row: string) => {
      let firstCell = true
      const cells = row
        .replace(/<\s*t[dh]\b[^>]*>/gi, () => {
          if (firstCell) {
            firstCell = false
            return '| '
          }
          return ' '
        })
        .replace(/<\s*\/\s*t[dh]\s*>/gi, ' |')
      return `\n${cells}\n`
    })
    .replace(/<\s*\/?\s*(?:table|thead|tbody|tfoot)\b[^>]*>/gi, '\n\n')
    .replace(/<\s*\/?\s*tr\b[^>]*>/gi, '\n')
    .replace(/<\s*t[dh]\b[^>]*>/gi, '| ')
    .replace(/<\s*\/\s*t[dh]\s*>/gi, ' |')
    .replace(/<\s*\/?\s*(?:strong|b)\b[^>]*>/gi, '**')
    .replace(/<\s*\/?\s*(?:em|i)\b[^>]*>/gi, '*')
    .replace(/<\s*\/?\s*(?:s|del)\b[^>]*>/gi, '~~')
    .replace(/<\s*\/?\s*code\b[^>]*>/gi, '`')
    .replace(/<\s*hr\s*\/?>/gi, '\n\n---\n\n')
    .replace(/<\s*\/?\s*(?:p|div|section|article|header|footer|main|aside|figure|figcaption|form|nav|title|details|summary)\b[^>]*>/gi, '\n\n')
    .replace(assistantHtmlTagPattern, '')

  preBlocks.forEach((inner, index) => {
    value = value.replace(
      `__ZEROCHAT_PRE_${index}__`,
      '\n\n```\n' + inner + '\n```\n\n',
    )
  })
  return decodeAssistantHtmlEntities(value)
    .replace(/[\t\r ]+/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function htmlAttribute(attributes: string, name: string): string | undefined {
  const match = attributes.match(
    new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  )
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

function decodeAssistantHtmlEntities(value: string): string {
  return value.replace(assistantHtmlEntityPattern, (match, entity: string) => {
    const normalized = entity.toLowerCase()
    if (namedAssistantHtmlEntities[normalized]) return namedAssistantHtmlEntities[normalized]
    const number = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10)
    return Number.isInteger(number) && number >= 0 && number <= 0x10ffff
      ? String.fromCodePoint(number)
      : match
  })
}

function safeAssistantLinkUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim() ?? ''
  if (!trimmed || /\s/u.test(trimmed)) return undefined
  try {
    const url = new URL(trimmed)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return undefined
    if (url.protocol === 'mailto:') {
      return url.pathname && !url.hostname && !url.username && !url.password ? url.href : undefined
    }
    return url.hostname && !url.username && !url.password ? url.href : undefined
  } catch {
    return undefined
  }
}
