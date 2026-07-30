import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AppOverlaysViewProps } from '../AppOverlaysView'
import { SettingsOverlayHost } from '../SettingsOverlayHost'

const { loadSettingsDataActionService } = vi.hoisted(() => ({
  loadSettingsDataActionService: vi.fn(() => Promise.resolve(vi.fn())),
}))

vi.mock('../../services/settingsDataControllerLoader', () => ({
  loadSettingsDataActionService,
}))

interface SettingsOverlayHostChildProps {
  onResetSyncPassphrase: () => void | Promise<void>
  onSelectTab: (tab: 'appearance' | 'data') => void
}

type SettingsOverlayHostProps = Parameters<typeof SettingsOverlayHost>[0]

function hostProps(
  resetSyncPassphrase: AppOverlaysViewProps['resetSyncPassphrase'],
): SettingsOverlayHostProps {
  return {
    changeCompactMode: vi.fn(),
    resetSyncPassphrase,
    selectSettingsTab: vi.fn(),
    settingsOpen: true,
  } as unknown as SettingsOverlayHostProps
}

function renderHost(
  resetSyncPassphrase: AppOverlaysViewProps['resetSyncPassphrase'],
): ReactElement<SettingsOverlayHostChildProps> {
  const tree = SettingsOverlayHost(hostProps(resetSyncPassphrase))

  expect(tree).not.toBeNull()

  return tree as ReactElement<SettingsOverlayHostChildProps>
}

describe('SettingsOverlayHost', () => {
  beforeEach(() => {
    loadSettingsDataActionService.mockClear()
  })

  it('contains synchronous reset sync passphrase failures at the host boundary', async () => {
    const resetSyncPassphrase = vi.fn(() => {
      throw new Error('reset failed')
    })
    const tree = renderHost(resetSyncPassphrase)

    await expect(tree.props.onResetSyncPassphrase()).resolves.toBeUndefined()

    expect(resetSyncPassphrase).toHaveBeenCalledTimes(1)
  })

  it('contains rejected reset sync passphrase promises at the host boundary', async () => {
    const resetSyncPassphrase = vi.fn(async () => {
      throw new Error('reset failed')
    })
    const tree = renderHost(resetSyncPassphrase)

    await expect(tree.props.onResetSyncPassphrase()).resolves.toBeUndefined()

    expect(resetSyncPassphrase).toHaveBeenCalledTimes(1)
  })

  it('prewarms Data actions only when selecting the Data tab', () => {
    const selectSettingsTab = vi.fn()
    const tree = SettingsOverlayHost({
      ...hostProps(vi.fn()),
      selectSettingsTab,
    }) as ReactElement<SettingsOverlayHostChildProps>

    tree.props.onSelectTab('appearance')

    expect(loadSettingsDataActionService).not.toHaveBeenCalled()
    expect(selectSettingsTab).toHaveBeenLastCalledWith('appearance')

    tree.props.onSelectTab('data')

    expect(loadSettingsDataActionService).toHaveBeenCalledTimes(1)
    expect(selectSettingsTab).toHaveBeenLastCalledWith('data')
  })
})
