import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INITIAL_MASK_KEYBOARD_CURSOR,
  MASK_KEYBOARD_LARGE_STEP,
  MASK_KEYBOARD_STEP,
  acceptedImageSourceFromPicker,
  clampMaskKeyboardRatio,
  imageDataHasMaskPaint,
  imagePreviewBelongsToSource,
  imagePreviewBelongsToCurrentSource,
  imageSourceDragStateForGeneration,
  imageSourcePickerSelection,
  imageSourcePreviewUrl,
  abandonUncapturedMaskPointerStroke,
  maskPointerCanStartStroke,
  maskPointerOwnsStroke,
  releaseOwnedImageSourcePreviewUrl,
  replaceOwnedImageSourcePreviewUrl,
  revokeImageSourcePreviewUrl,
  stopOwnedMaskPointerStroke,
} from '../imageComposerController'

function fileList(files: File[]): FileList {
  return files as unknown as FileList
}

describe('image composer controller helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps keyboard mask cursor away from unusable canvas edges', () => {
    expect(clampMaskKeyboardRatio(-1)).toBe(0.02)
    expect(clampMaskKeyboardRatio(0.5)).toBe(0.5)
    expect(clampMaskKeyboardRatio(2)).toBe(0.98)
  })

  it('keeps stable keyboard mask defaults and movement steps', () => {
    expect(INITIAL_MASK_KEYBOARD_CURSOR).toEqual({ x: 0.5, y: 0.5 })
    expect(MASK_KEYBOARD_STEP).toBe(0.035)
    expect(MASK_KEYBOARD_LARGE_STEP).toBe(0.1)
  })

  it('lets only a primary left-button pointer own a mask stroke', () => {
    const primary = { button: 0, isPrimary: true, pointerId: 31 }

    expect(maskPointerCanStartStroke(primary, null)).toBe(true)
    expect(maskPointerCanStartStroke({ ...primary, button: 2 }, null)).toBe(false)
    expect(maskPointerCanStartStroke({ ...primary, isPrimary: false }, null)).toBe(
      false,
    )
    expect(maskPointerCanStartStroke(primary, 19)).toBe(false)
  })

  it('keeps mask move and stop events bound to the owning pointer', () => {
    expect(maskPointerOwnsStroke(31, 31)).toBe(true)
    expect(maskPointerOwnsStroke(31, 32)).toBe(false)
    expect(maskPointerOwnsStroke(null, 31)).toBe(false)
  })

  it('releases pointer capture only when the owning mask stroke stops', () => {
    const releasePointerCapture = vi.fn()
    const target = {
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture,
    }

    expect(
      stopOwnedMaskPointerStroke(31, { currentTarget: target, pointerId: 32 }),
    ).toBe(31)
    expect(target.hasPointerCapture).not.toHaveBeenCalled()

    target.hasPointerCapture.mockReturnValueOnce(false)
    expect(
      stopOwnedMaskPointerStroke(31, { currentTarget: target, pointerId: 31 }),
    ).toBeNull()
    expect(releasePointerCapture).not.toHaveBeenCalled()

    expect(
      stopOwnedMaskPointerStroke(31, { currentTarget: target, pointerId: 31 }),
    ).toBeNull()
    expect(releasePointerCapture).toHaveBeenCalledWith(31)

    target.hasPointerCapture.mockImplementationOnce(() => {
      throw new Error('capture unavailable')
    })
    expect(
      stopOwnedMaskPointerStroke(31, { currentTarget: target, pointerId: 31 }),
    ).toBeNull()
  })

  it('abandons an owned mask stroke only after pointer capture is unavailable', () => {
    const target = {
      hasPointerCapture: vi.fn(() => true),
    }

    expect(
      abandonUncapturedMaskPointerStroke(31, {
        currentTarget: target,
        pointerId: 32,
      }),
    ).toBe(31)
    expect(target.hasPointerCapture).not.toHaveBeenCalled()

    expect(
      abandonUncapturedMaskPointerStroke(31, {
        currentTarget: target,
        pointerId: 31,
      }),
    ).toBe(31)

    target.hasPointerCapture.mockReturnValueOnce(false)
    expect(
      abandonUncapturedMaskPointerStroke(31, {
        currentTarget: target,
        pointerId: 31,
      }),
    ).toBeNull()

    target.hasPointerCapture.mockImplementationOnce(() => {
      throw new Error('capture state unavailable')
    })
    expect(
      abandonUncapturedMaskPointerStroke(31, {
        currentTarget: target,
        pointerId: 31,
      }),
    ).toBeNull()
  })

  it('detects painted mask pixels by alpha channel', () => {
    const empty = {
      data: new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 0]),
    } as ImageData
    const painted = {
      data: new Uint8ClampedArray([0, 0, 0, 0, 255, 255, 255, 1]),
    } as ImageData

    expect(imageDataHasMaskPaint(empty)).toBe(false)
    expect(imageDataHasMaskPaint(painted)).toBe(true)
  })

  it('accepts only supported image files from picker selections', () => {
    const unsupported = new File(['text'], 'note.txt', { type: 'text/plain' })
    const png = new File(['image'], 'source.png', { type: 'image/png' })

    expect(acceptedImageSourceFromPicker(fileList([unsupported, png]))).toBe(png)
    expect(acceptedImageSourceFromPicker(fileList([unsupported]))).toBeNull()
    expect(acceptedImageSourceFromPicker(null)).toBeNull()
  })

  it('ignores delayed picker selections while generation is active', () => {
    const png = new File(['image'], 'source.png', { type: 'image/png' })

    expect(imageSourcePickerSelection(fileList([png]), true)).toEqual({
      blocked: true,
      file: null,
      unsupported: false,
    })
  })

  it('clears stale drag affordance when generation starts', () => {
    expect(
      imageSourceDragStateForGeneration({ active: true, rejected: false }, true),
    ).toEqual({
      active: false,
      rejected: false,
    })
    expect(
      imageSourceDragStateForGeneration({ active: false, rejected: true }, true),
    ).toEqual({
      active: false,
      rejected: false,
    })
    expect(
      imageSourceDragStateForGeneration({ active: true, rejected: false }, false),
    ).toEqual({
      active: true,
      rejected: false,
    })
  })

  it('accepts preview events only from the current image source', () => {
    expect(
      imagePreviewBelongsToSource(
        { currentSrc: 'blob:current-image', src: 'blob:current-image' },
        'blob:current-image',
      ),
    ).toBe(true)
    expect(
      imagePreviewBelongsToSource(
        { currentSrc: 'blob:old-image', src: 'blob:old-image' },
        'blob:current-image',
      ),
    ).toBe(false)
    expect(
      imagePreviewBelongsToSource(
        { currentSrc: '', src: 'blob:current-image' },
        'blob:current-image',
      ),
    ).toBe(true)
    expect(
      imagePreviewBelongsToSource(
        { currentSrc: 'blob:current-image', src: 'blob:current-image' },
        '',
      ),
    ).toBe(false)
  })

  it('rejects a late preview event after the source owner changes', () => {
    const oldImage = {
      currentSrc: 'blob:old-image',
      src: 'blob:old-image',
    }

    expect(
      imagePreviewBelongsToCurrentSource(
        oldImage,
        'blob:old-image',
        'blob:new-image',
      ),
    ).toBe(false)
  })

  it('reports unsupported picker selections only when generation is idle', () => {
    const unsupported = new File(['text'], 'note.txt', { type: 'text/plain' })
    const png = new File(['image'], 'source.png', { type: 'image/png' })

    expect(imageSourcePickerSelection(fileList([unsupported]), false)).toEqual({
      blocked: false,
      file: null,
      unsupported: true,
    })
    expect(imageSourcePickerSelection(fileList([unsupported, png]), false)).toEqual({
      blocked: false,
      file: png,
      unsupported: false,
    })
  })

  it('creates preview URLs only after a valid source file is available', () => {
    const png = new File(['image'], 'source.png', { type: 'image/png' })
    const createObjectURL = vi.fn(() => 'blob:source-image')

    vi.stubGlobal('URL', { createObjectURL })

    expect(imageSourcePreviewUrl(null)).toBe('')
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(imageSourcePreviewUrl(png)).toBe('blob:source-image')
    expect(createObjectURL).toHaveBeenCalledWith(png)
  })

  it('lets callers preserve the current image when preview URL creation fails', () => {
    const png = new File(['image'], 'source.png', { type: 'image/png' })

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => {
        throw new Error('preview blocked')
      }),
    })

    expect(() => imageSourcePreviewUrl(png)).toThrow('preview blocked')
  })

  it('keeps immediate ownership of rapidly replaced preview URLs', () => {
    const first = new File(['first'], 'first.png', { type: 'image/png' })
    const second = new File(['second'], 'second.png', { type: 'image/png' })
    const owner = { current: '' }
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:first-image')
      .mockReturnValueOnce('blob:second-image')
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    expect(replaceOwnedImageSourcePreviewUrl(owner, first)).toBe(
      'blob:first-image',
    )
    expect(owner.current).toBe('blob:first-image')
    expect(replaceOwnedImageSourcePreviewUrl(owner, second)).toBe(
      'blob:second-image',
    )
    expect(owner.current).toBe('blob:second-image')
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:first-image')

    expect(releaseOwnedImageSourcePreviewUrl(owner)).toBe(true)
    expect(owner.current).toBe('')
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenLastCalledWith('blob:second-image')
    expect(releaseOwnedImageSourcePreviewUrl(owner)).toBe(true)
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('preserves the owned preview URL when replacement creation fails', () => {
    const next = new File(['next'], 'next.png', { type: 'image/png' })
    const owner = { current: 'blob:current-image' }
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => {
        throw new Error('preview blocked')
      }),
      revokeObjectURL,
    })

    expect(() => replaceOwnedImageSourcePreviewUrl(owner, next)).toThrow(
      'preview blocked',
    )
    expect(owner.current).toBe('blob:current-image')
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('contains image source preview URL cleanup failures', () => {
    const revokeObjectURL = vi.fn(() => {
      throw new Error('revoke blocked')
    })

    vi.stubGlobal('URL', {
      revokeObjectURL,
    })

    expect(revokeImageSourcePreviewUrl('blob:source-image')).toBe(false)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:source-image')
  })

  it('skips empty image source preview URL cleanup', () => {
    const revokeObjectURL = vi.fn()

    vi.stubGlobal('URL', {
      revokeObjectURL,
    })

    expect(revokeImageSourcePreviewUrl('')).toBe(true)
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })
})
