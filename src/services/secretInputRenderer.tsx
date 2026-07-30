import { useCallback, type ReactNode } from 'react'

import {
  SecretInput,
  type SecretInputOptions,
} from '../components/SecretInput'
import type { Translator } from '../i18n'

interface SecretInputRendererOptions {
  onDefaultBlur: () => void
  t: Translator
}

export type RenderSecretInput = (options: SecretInputOptions) => ReactNode

export function useSecretInputRenderer({
  onDefaultBlur,
  t,
}: SecretInputRendererOptions): RenderSecretInput {
  return useCallback(
    (options: SecretInputOptions) => (
      <SecretInput
        {...options}
        onBlur={options.onBlur ?? onDefaultBlur}
        hideLabel={t('button.hideSecret')}
        showLabel={t('button.showSecret')}
      />
    ),
    [onDefaultBlur, t],
  )
}
