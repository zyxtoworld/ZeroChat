import { describe, expect, it } from 'vitest'

import { setDataTransferDropEffect } from '../dragDropEffects'

describe('setDataTransferDropEffect', () => {
  it('sets drag dropEffect hints when the browser accepts them', () => {
    const dataTransfer = {
      dropEffect: 'none',
    } as Pick<DataTransfer, 'dropEffect'>

    expect(setDataTransferDropEffect(dataTransfer, 'copy')).toBe(true)
    expect(dataTransfer.dropEffect).toBe('copy')
  })

  it('contains drag dropEffect setter failures', () => {
    const dataTransfer = {} as Pick<DataTransfer, 'dropEffect'>

    Object.defineProperty(dataTransfer, 'dropEffect', {
      configurable: true,
      get: () => 'none',
      set: () => {
        throw new Error('dropEffect blocked')
      },
    })

    expect(setDataTransferDropEffect(dataTransfer, 'copy')).toBe(false)
    expect(setDataTransferDropEffect(null, 'copy')).toBe(false)
  })
})
