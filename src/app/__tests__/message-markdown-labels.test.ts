import { describe, expect, it } from 'vitest'

import { createAppTranslator, createMarkdownLabels } from '../i18n'

describe('message Markdown labels', () => {
  it('passes a localized plain-text code label to the renderer', () => {
    const zh = createMarkdownLabels(createAppTranslator('zh'))
    const en = createMarkdownLabels(createAppTranslator('en'))
    const ja = createMarkdownLabels(createAppTranslator('ja'))

    expect(zh('plainText')).toBe('纯文本')
    expect(en('plainText')).toBe('Plain text')
    expect(ja('plainText')).toBe('プレーンテキスト')
    expect(zh('copyCode')).toBe('复制代码')
    expect(en('copyCode')).toBe('Copy code')
    expect(ja('copyCode')).toBe('コードをコピー')
  })

  it('passes localized code-copy failure labels to the renderer', () => {
    expect(createMarkdownLabels(createAppTranslator('zh'))('copyFailed')).toBe(
      '复制失败',
    )
    expect(createMarkdownLabels(createAppTranslator('en'))('copyFailed')).toBe(
      'Copy failed',
    )
    expect(createMarkdownLabels(createAppTranslator('ja'))('copyFailed')).toBe(
      'コピーに失敗しました',
    )
  })
})
