import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cleanupBackupDownloadAnchor,
  downloadJsonFile,
  revokeBackupObjectUrl,
} from '../downloadJsonFile'

function installDownloadDom(options: {
  click?: () => void
  remove?: () => void
  removeFromParent?: () => void
  revoke?: (url: string) => void
  setTimeout?: (callback: () => void, delay: number) => unknown
} = {}) {
  const parent = {
    removeChild: vi.fn(options.removeFromParent ?? (() => undefined)),
  }
  const anchor = {
    click: vi.fn(options.click ?? (() => undefined)),
    remove: vi.fn(options.remove ?? (() => undefined)),
    parentNode: parent,
    download: '',
    href: '',
  } as unknown as HTMLAnchorElement
  const append = vi.fn()
  const createObjectURL = vi.fn(() => 'blob:zerochat-backup')
  const revokeObjectURL = vi.fn(options.revoke ?? (() => undefined))
  const setTimeout = vi.fn(options.setTimeout ?? (() => 1))

  vi.stubGlobal('document', {
    body: { append },
    createElement: vi.fn(() => anchor),
  })
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
  vi.stubGlobal('window', { setTimeout })

  return { anchor, append, createObjectURL, revokeObjectURL, setTimeout, parent }
}

describe('JSON backup download lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('clicks one temporary anchor and revokes the object URL after success', () => {
    const fixture = installDownloadDom()

    expect(downloadJsonFile({ ok: true }, 'backup.json')).toBe(true)
    expect(fixture.anchor.href).toBe('blob:zerochat-backup')
    expect(fixture.anchor.download).toBe('backup.json')
    expect(fixture.append).toHaveBeenCalledWith(fixture.anchor)
    expect(fixture.anchor.click).toHaveBeenCalledTimes(1)
    expect(fixture.anchor.remove).toHaveBeenCalledTimes(1)
    expect(fixture.setTimeout).toHaveBeenCalledWith(expect.any(Function), 1000)

    const cleanup = fixture.setTimeout.mock.calls[0]?.[0] as
      | (() => void)
      | undefined
    cleanup?.()
    expect(fixture.revokeObjectURL).toHaveBeenCalledWith('blob:zerochat-backup')
  })

  it('immediately revokes and removes resources when the click is blocked', () => {
    const fixture = installDownloadDom({
      click: () => {
        throw new Error('download blocked')
      },
    })

    expect(downloadJsonFile({ ok: false }, 'backup.json')).toBe(false)
    expect(fixture.revokeObjectURL).toHaveBeenCalledWith('blob:zerochat-backup')
    expect(fixture.anchor.remove).toHaveBeenCalledTimes(1)
    expect(fixture.setTimeout).not.toHaveBeenCalled()
  })

  it('contains anchor removal failures without changing the download result', () => {
    const fixture = installDownloadDom({
      remove: () => {
        throw new Error('anchor removal blocked')
      },
      removeFromParent: () => {
        throw new Error('parent removal blocked')
      },
    })

    expect(cleanupBackupDownloadAnchor(fixture.anchor)).toBe(false)
    expect(downloadJsonFile({ ok: true }, 'backup.json')).toBe(true)
  })

  it('uses the parent node fallback during backup download cleanup', () => {
    const fixture = installDownloadDom({
      remove: () => {
        throw new Error('anchor removal blocked')
      },
    })

    expect(downloadJsonFile({ ok: true }, 'backup.json')).toBe(true)
    expect(fixture.parent.removeChild).toHaveBeenCalledWith(fixture.anchor)
  })

  it('contains immediate and delayed object URL cleanup failures', () => {
    const fixture = installDownloadDom({
      revoke: () => {
        throw new Error('revoke blocked')
      },
    })

    expect(revokeBackupObjectUrl('blob:zerochat-backup')).toBe(false)
    expect(downloadJsonFile({ ok: true }, 'backup.json')).toBe(true)
    const cleanup = fixture.setTimeout.mock.calls[0]?.[0] as
      | (() => void)
      | undefined
    expect(() => cleanup?.()).not.toThrow()
  })

  it('falls back to immediate cleanup when scheduling is unavailable', () => {
    const fixture = installDownloadDom({
      setTimeout: () => {
        throw new Error('timer unavailable')
      },
    })

    expect(downloadJsonFile({ ok: true }, 'backup.json')).toBe(true)
    expect(fixture.revokeObjectURL).toHaveBeenCalledWith('blob:zerochat-backup')
  })
})
