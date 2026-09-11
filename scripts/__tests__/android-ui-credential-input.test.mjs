import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(
  new URL('../android-ui-smoke.mjs', import.meta.url),
  'utf8',
)

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf('\nfunction ', start + 1)

  return source.slice(start, end < 0 ? source.length : end)
}

describe('Android UI credential input', () => {
  it('clears the focused field with a value-based bound before typing', () => {
    const clearFocusedText = functionSource('clearFocusedText')
    const inputSecret = functionSource('inputSecretIntoLabeledEditText')

    expect(inputSecret).toContain(
      'clearFocusedText(Math.max(focusedBefore.text.length + 8, value.length + 8, 48))',
    )
    expect(clearFocusedText).toContain('throw new Error')
  })

  it('types credentials in chunks and verifies the complete masked length', () => {
    const inputSecret = functionSource('inputSecretIntoLabeledEditText')

    expect(inputSecret).toContain('inputTextInChunks(value)')
    expect(inputSecret).toMatch(
      /focusedAfter\?\.password\s*&&\s*focusedAfter\.text\.length === value\.length/u,
    )
  })
})
