import { describe, expect, it } from 'vitest'

import { markdownHighlightLanguageCount, renderMarkdown } from '../markdown'

const labels = {
  copy: 'Copy',
  copied: 'Copied',
  copyCode: 'Copy code',
  copyFailed: 'Copy failed',
  plainText: 'Plain text',
}

describe('Markdown rendering', () => {
  it('keeps code highlighting coverage above the PRD minimum', () => {
    expect(markdownHighlightLanguageCount()).toBeGreaterThanOrEqual(20)
  })

  it('highlights common modern code fences without exposing raw markup', () => {
    const html = renderMarkdown(
      [
        '```tsx',
        'const value: number = 42',
        'return <Button>{value}</Button>',
        '```',
        '```dockerfile',
        'FROM node:22',
        'RUN pnpm install',
        '```',
      ].join('\n'),
      labels,
    )

    expect(html).toContain('data-language="typescript"')
    expect(html).toContain('data-language="dockerfile"')
    expect(html).toContain('language-typescript')
    expect(html).toContain('language-dockerfile')
    expect(html).toContain('data-copy-failed-label="Copy failed"')
    expect(html).toContain('<span class="hljs-keyword">const</span>')
    expect(html).toContain('<span class="hljs-keyword">FROM</span>')
    expect(html).toContain('&lt;Button&gt;')
    expect(html).not.toContain('<Button>')
  })

  it('preserves the rich Markdown contract while keeping raw HTML inert', () => {
    const html = renderMarkdown(
      [
        '# Heading',
        '',
        '> Quote',
        '',
        '1. First',
        '2. Second',
        '',
        '- **Bold** and *emphasis* with ~~strike~~ and `inline code`',
        '  - Nested',
        '',
        '| Left | Right |',
        '| --- | ---: |',
        '| A | B |',
        '',
        '[Explicit](https://example.com/path?q=1&x=2)',
        'https://example.org/bare',
        '',
        '<script>alert("unsafe")</script>',
      ].join('\n'),
      labels,
    )

    expect(html).toContain('<h1>Heading</h1>')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<strong>Bold</strong>')
    expect(html).toContain('<em>emphasis</em>')
    expect(html).toContain('<del>strike</del>')
    expect(html).toContain('<code>inline code</code>')
    expect(html).toContain('<div class="markdown-table-scroll"><table>')
    expect(html).toContain('href="https://example.com/path?q=1&amp;x=2"')
    expect(html).toContain('href="https://example.org/bare"')
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2)
    expect(html).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('allows only safe HTTP(S)/mailto links and inline raster data images', () => {
    const html = renderMarkdown(
      [
        '[script](javascript:alert(1))',
        '[encoded](java&#x73;cript:alert(1))',
        '[oversized](java&#999999999999;script:alert(1))',
        '[custom](intent://scan/#Intent;scheme=zxing;end)',
        '[settings](ms-settings:privacy)',
        '[relative](/settings)',
        '[credentials](https://user:secret@example.com/private)',
        '[safe](https://例子.example/Guide?x=1#top)',
        '[mail](mailto:alice@example.com?subject=hello)',
        '![script](data:text/html;base64,PHNjcmlwdD4=)',
        '![remote](https://tracker.example/pixel.png)',
        '![relative](/pixel.png)',
        '![malformed](data:image/png;base64,not-base64!)',
        '![empty](data:image/png;base64,)',
        '![safe](data:image/png;base64,AA==)',
      ].join('\n\n'),
      labels,
    )

    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="java')
    expect(html).not.toContain('href="intent:')
    expect(html).not.toContain('href="ms-settings:')
    expect(html).not.toContain('href="/settings')
    expect(html).not.toContain('href="https://user:secret')
    expect(html).not.toContain('src="data:text/html')
    expect(html).not.toContain('src="https://tracker.example')
    expect(html).not.toContain('src="/pixel.png')
    expect(html).not.toContain('src="data:image/png;base64,not-base64!')
    expect(html).not.toContain('src="data:image/png;base64,"')
    expect(html).toContain('[script](javascript:alert(1))')
    expect(html).toContain('[encoded](java&amp;#x73;cript:alert(1))')
    expect(html).toContain('[oversized](java&amp;#999999999999;script:alert(1))')
    expect(html).toContain('[custom](intent://scan/#Intent;scheme=zxing;end)')
    expect(html).toContain('[settings](ms-settings:privacy)')
    expect(html).toContain('[relative](/settings)')
    expect(html).toContain('[credentials](https://user:secret@example.com/private)')
    expect(html).toContain(
      '<a href="https://xn--fsqu00a.example/Guide?x=1#top" target="_blank" rel="noopener noreferrer">safe</a>',
    )
    expect(html).toContain(
      '<a href="mailto:alice@example.com?subject=hello" target="_blank" rel="noopener noreferrer">mail</a>',
    )
    expect(html).toContain('![script](data:text/html;base64,PHNjcmlwdD4=)')
    expect(html).toContain('![remote](https://tracker.example/pixel.png)')
    expect(html).toContain('![relative](/pixel.png)')
    expect(html).toContain('![malformed](data:image/png;base64,not-base64!)')
    expect(html).toContain('![empty](data:image/png;base64,)')
    expect(html).toContain('<img src="data:image/png;base64,AA==" alt="safe">')
  })

  it('reuses parser configuration without leaking localized code labels', () => {
    const first = renderMarkdown('```\nvalue\n```', labels)
    const second = renderMarkdown('```\nvalue\n```', {
      ...labels,
      copy: 'Copier',
      copyCode: 'Copier le code',
      plainText: 'Texte brut',
    })

    expect(first).toContain('data-language="Plain text"')
    expect(first).toContain('data-copy-label="Copy"')
    expect(second).toContain('data-language="Texte brut"')
    expect(second).toContain('data-copy-label="Copier"')
    expect(second).not.toContain('data-copy-label="Copy"')
  })

  it('keeps hostile provider and sync Markdown inert across rich syntax boundaries', () => {
    const html = renderMarkdown(
      [
        '<svg onload="alert(1)"><script>alert(2)</script></svg>',
        '<math><mi xlink:href="javascript:alert(3)">x</mi></math>',
        '<iframe srcdoc="<script>alert(4)</script>"></iframe>',
        '<div style="background:url(javascript:alert(5))" onerror="alert(6)">text</div>',
        '[mixed](JaVaScRiPt:alert(7))',
        '[encoded](java%73cript:alert(8))',
        '[data](data:text/html,<script>alert(9)</script>)',
        '[vb](vbscript:msgbox(10))',
        '[safe](HTTPS://example.com/path)',
        '[mail](MAILTO:alice@example.com?subject=hello)',
        '[mail-control](mailto:alice@example.com?subject=hi%0aBcc:evil@example.com)',
        '![bad](data:text/html;base64,PHNjcmlwdD5hbGVydCgxMSk8L3NjcmlwdD4=)',
        '![safe](data:image/png;base64,AA==)',
        '```html',
        '<script onerror="alert(12)">text</script>',
        '```',
      ].join('\n\n'),
      labels,
    )
    const controlHtml = renderMarkdown(
      '[control](\u0000https://example.com/control)',
      labels,
    )

    expect(html).not.toContain('<svg')
    expect(html).not.toContain('<math')
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<img src="data:text/html')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="data:text/html')
    expect(html).not.toContain('href="vbscript:')
    expect(html).not.toMatch(/<(?:svg|math|iframe|script)\b/iu)
    expect(html).not.toMatch(/<[a-z][^>]*\bon(?:error|load)=/iu)
    expect(html).not.toMatch(/<[a-z][^>]*\bsrcdoc=/iu)
    expect(html).not.toMatch(/<[a-z][^>]*\bstyle=/iu)
    expect(html).toContain(
      '<a href="https://example.com/path" target="_blank" rel="noopener noreferrer">safe</a>',
    )
    expect(html).toContain(
      '<a href="mailto:alice@example.com?subject=hello" target="_blank" rel="noopener noreferrer">mail</a>',
    )
    expect(html).not.toContain('href="mailto:alice@example.com?subject=hi%0a')
    expect(html).toContain('<img src="data:image/png;base64,AA==" alt="safe">')
    expect(html).toContain('&lt;script onerror=')
    expect(html).toContain('&gt;text&lt;/script&gt;')
    expect(controlHtml).not.toContain('href="https://example.com/control"')
    expect(controlHtml).toContain('�https://example.com/control')
  })

  it('handles oversized plain input without creating executable markup', () => {
    const html = renderMarkdown(`# title\n\n${'safe text '.repeat(20_000)}`, labels)

    expect(html).toContain('<h1>title</h1>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('href="')
    expect(html).not.toContain('src="')
  })

  it('keeps typographic prose and leading zero-width input behavior stable', () => {
    const html = renderMarkdown('\ufeff(c) ... "quoted" and don\'t -- stop', labels)

    expect(html).toContain('<p>© … “quoted” and don’t – stop</p>')
  })
})
