import { describe, expect, it } from 'vitest'

import type { Translator } from '../../i18n'
import {
  IMAGE_TASK_MODES,
  deriveImageComposerChrome,
  imageModeLabel,
  imageModeShortLabel,
} from '../imageComposerChrome'

const translations: Record<string, string> = {
  'button.editImage': '编辑图片',
  'button.generateImage': '生成图片',
  'message.imageEditPlaceholder': '描述要怎样改这张图...',
  'message.imageInpaintPlaceholder': '描述要怎样重绘选区...',
  'message.imagePlaceholder': '描述你想生成的图片...',
  'mode.imageEdit': '编辑图片',
  'mode.imageEditShort': '编辑',
  'mode.imageGenerate': '生成图片',
  'mode.imageGenerateShort': '生成',
  'mode.imageInpaint': '局部重绘',
  'mode.imageInpaintShort': '重绘',
  'welcome.imageEditTitle': '编辑图片',
  'welcome.imageInpaintTitle': '局部重绘',
  'welcome.imageTitle': '生成图片',
}

const t: Translator = (key) => translations[key] ?? key

describe('image composer chrome', () => {
  it('keeps the image task modes in the expected toolbar order', () => {
    expect(IMAGE_TASK_MODES).toEqual(['generate', 'edit', 'inpaint'])
  })

  it.each([
    ['generate', '生成图片', '生成'],
    ['edit', '编辑图片', '编辑'],
    ['inpaint', '局部重绘', '重绘'],
  ] as const)('derives full and compact labels for %s', (mode, label, shortLabel) => {
    expect(imageModeLabel(t, mode)).toBe(label)
    expect(imageModeShortLabel(t, mode)).toBe(shortLabel)
  })

  it('derives generate-mode welcome, placeholder, and submit copy', () => {
    expect(
      deriveImageComposerChrome({
        imageTaskMode: 'generate',
        t,
      }),
    ).toEqual({
      inputPlaceholder: '描述你想生成的图片...',
      submitLabel: '生成图片',
      welcomeTitle: '生成图片',
    })
  })

  it('derives edit-mode welcome, placeholder, and submit copy', () => {
    expect(
      deriveImageComposerChrome({
        imageTaskMode: 'edit',
        t,
      }),
    ).toEqual({
      inputPlaceholder: '描述要怎样改这张图...',
      submitLabel: '编辑图片',
      welcomeTitle: '编辑图片',
    })
  })

  it('derives inpaint-mode welcome, placeholder, and submit copy', () => {
    expect(
      deriveImageComposerChrome({
        imageTaskMode: 'inpaint',
        t,
      }),
    ).toEqual({
      inputPlaceholder: '描述要怎样重绘选区...',
      submitLabel: '局部重绘',
      welcomeTitle: '局部重绘',
    })
  })
})
