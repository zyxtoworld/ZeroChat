import type { ProviderConfig } from '../types'
import {
  messageContextMenuNavigationIndex,
  normalizedMessageContextMenuIndex,
} from './messageContextMenu'

export type ChatModelMenuProvider = Pick<ProviderConfig, 'enabled' | 'id'>

export const CHAT_MODEL_MENU_ITEM_SELECTOR =
  '[role^=menuitem]:not(:disabled)'
export const normalizedChatModelMenuIndex = normalizedMessageContextMenuIndex
export const chatModelMenuNavigationIndex = messageContextMenuNavigationIndex

export function defaultChatModelMenuExpandedProviderId(
  activeProvider: ChatModelMenuProvider | null,
  providers: readonly Pick<ProviderConfig, 'id'>[],
): string {
  if (activeProvider?.enabled) {
    return activeProvider.id
  }

  return providers[0]?.id ?? ''
}

export function nextChatModelMenuExpandedProviderId(
  providerId: string,
  expanded: boolean,
): string {
  return expanded ? '' : providerId
}
