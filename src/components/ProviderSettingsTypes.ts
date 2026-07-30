import type { ReactNode } from 'react'

import type { SettingsNoticeTarget } from './SettingsPageTypes'

export type ProviderNoticeTarget = Extract<
  SettingsNoticeTarget,
  'provider-capabilities' | 'providers-list' | 'providers' | 'providers-danger'
>

export type ProviderNoticeRenderer = (
  target: ProviderNoticeTarget,
) => ReactNode
