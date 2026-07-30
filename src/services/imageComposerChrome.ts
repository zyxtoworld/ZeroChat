import type { Translator } from '../i18n'

export type ComposerMode = 'audio' | 'chat' | 'image'
export type ImageTaskMode = 'generate' | 'edit' | 'inpaint'

export const IMAGE_TASK_MODES: readonly ImageTaskMode[] = [
  'generate',
  'edit',
  'inpaint',
]

export interface ImageComposerChrome {
  inputPlaceholder: string
  submitLabel: string
  welcomeTitle: string
}

export function imageModeLabel(t: Translator, mode: ImageTaskMode): string {
  if (mode === 'edit') {
    return t('mode.imageEdit')
  }

  if (mode === 'inpaint') {
    return t('mode.imageInpaint')
  }

  return t('mode.imageGenerate')
}

export function imageModeShortLabel(
  t: Translator,
  mode: ImageTaskMode,
): string {
  if (mode === 'edit') {
    return t('mode.imageEditShort')
  }

  if (mode === 'inpaint') {
    return t('mode.imageInpaintShort')
  }

  return t('mode.imageGenerateShort')
}

export function deriveImageComposerChrome({
  imageTaskMode,
  t,
}: {
  imageTaskMode: ImageTaskMode
  t: Translator
}): ImageComposerChrome {
  if (imageTaskMode === 'edit') {
    return {
      inputPlaceholder: t('message.imageEditPlaceholder'),
      submitLabel: t('button.editImage'),
      welcomeTitle: t('welcome.imageEditTitle'),
    }
  }

  if (imageTaskMode === 'inpaint') {
    return {
      inputPlaceholder: t('message.imageInpaintPlaceholder'),
      submitLabel: t('mode.imageInpaint'),
      welcomeTitle: t('welcome.imageInpaintTitle'),
    }
  }

  return {
    inputPlaceholder: t('message.imagePlaceholder'),
    submitLabel: t('button.generateImage'),
    welcomeTitle: t('welcome.imageTitle'),
  }
}
