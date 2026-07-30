import { describe, expect, it, vi } from 'vitest'

import { reportLegacyMigrationNotice } from '../legacyMigrationNoticeController'

describe('legacy migration notice controller helpers', () => {
  it('reports legacy migration failures to the requested notice target', () => {
    const setNotice = vi.fn()

    expect(
      reportLegacyMigrationNotice({
        getMessage: () => 'legacy migration failed',
        setNotice,
        target: 'data-backup',
      }),
    ).toBe('legacy migration failed')

    expect(setNotice).toHaveBeenCalledWith(
      'legacy migration failed',
      'error',
      'data-backup',
    )
  })

  it('contains legacy migration notice reporter failures', () => {
    const setNotice = vi.fn(() => {
      throw new Error('notice channel unavailable')
    })

    expect(
      reportLegacyMigrationNotice({
        getMessage: () => 'legacy migration failed',
        setNotice,
        target: 'skills',
      }),
    ).toBeNull()

    expect(setNotice).toHaveBeenCalledWith(
      'legacy migration failed',
      'error',
      'skills',
    )
  })

  it('contains legacy migration message formatter failures', () => {
    const setNotice = vi.fn()

    expect(
      reportLegacyMigrationNotice({
        getMessage: () => {
          throw new Error('formatter unavailable')
        },
        setNotice,
        target: 'data-backup',
      }),
    ).toBeNull()

    expect(setNotice).not.toHaveBeenCalled()
  })
})
