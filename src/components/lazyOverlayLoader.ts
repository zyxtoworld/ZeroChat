import type { ComponentType } from 'react'

type LazyOverlayModule<Props> = {
  default: ComponentType<Props>
}

type LazyOverlayLogger = Pick<Console, 'error'>

export async function recoverLazyOverlay<Props>(
  loadOverlay: () => Promise<LazyOverlayModule<Props>>,
  fallback: ComponentType<Props>,
  logger: LazyOverlayLogger = console,
): Promise<LazyOverlayModule<Props>> {
  try {
    return await loadOverlay()
  } catch (error: unknown) {
    logger.error('ZeroChat overlay failed to load.', error)
    return { default: fallback }
  }
}
