import type {
  ChangeEvent,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from 'react'

import type { Translator } from '../i18n'
import type { ComposerChromeState } from '../services/composerChrome'
import type { ComposerReadinessState } from '../services/composerReadiness'
import type { RenderFeatureHint } from '../services/featureHintController'
import type {
  ComposerMode,
  ImageTaskMode,
} from '../services/imageComposerChrome'
import type { MaskKeyboardCursor } from '../services/imageComposerController'
import type { MessageContextMenuState } from '../services/messageContextMenu'
import type { MessageVirtualRange } from '../services/messageVirtualization'
import type { SyncChromeState } from '../services/syncChrome'
import type { NoticeTone } from '../services/uiRuntime'
import type {
  ChatMessage,
  Conversation,
  ProviderConfig,
} from '../types'
import type { MessageActionResult } from './MessageBubble'
import type {
  NoticeState,
  NoticeTarget,
} from './Notice'
import type { SettingsTab } from './SettingsNav'

export type OpenSettingsHandler = (
  event?: { currentTarget: EventTarget | null },
  initialTab?: SettingsTab,
) => void

export interface ChatPaneViewProps {
  activeConversation: Conversation
  activeConversationTitle: string
  activeImageModel: string
  activeModel: string
  activeProvider: ProviderConfig
  chatModelMenuOpen: boolean
  chatModelMenuRef: RefObject<HTMLDivElement | null>
  chatModelProviders: ProviderConfig[]
  chatModelTriggerRef: RefObject<HTMLButtonElement | null>
  chatPaneHiddenFromAssistiveTech: boolean
  closeChatModelMenu: () => void
  closeMessageContextMenu: () => void
  composerChrome: ComposerChromeState
  composerMode: ComposerMode
  composerReadiness: ComposerReadinessState
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>
  conversationTitleButtonRef: RefObject<HTMLButtonElement | null>
  conversationTitleDraft: string
  conversationTitleInputRef: RefObject<HTMLInputElement | null>
  currentNotice: NoticeState
  draft: string
  audioSourceDragActive: boolean
  audioSourceDragRejected: boolean
  audioSourceFile: File | null
  editingContent: string
  editingConversationTitle: boolean
  editingMessageId: string
  expandedChatProviderId: string
  generationActive: boolean
  guideVisible: boolean
  imageSourceDragActive: boolean
  imageSourceDragRejected: boolean
  imageSourceFile: File | null
  imageSourceUrl: string
  imageTaskMode: ImageTaskMode
  isOnline: boolean
  maskBrushSize: number
  maskCanvasRef: RefObject<HTMLCanvasElement | null>
  maskKeyboardCursor: MaskKeyboardCursor
  maskTouched: boolean
  maskUndoAvailable: boolean
  messageContextMenu: MessageContextMenuState | null
  messageContextMenuMessage: ChatMessage | null
  messageContextMenuRef: RefObject<HTMLDivElement | null>
  messageListRef: RefObject<HTMLElement | null>
  messageVirtualizationEnabled: boolean
  renderedMessages: ChatMessage[]
  renderFeatureHint: RenderFeatureHint
  resolvedMessageVirtualRange: MessageVirtualRange
  settingsOpen: boolean
  showNewMessagesButton: boolean
  sidebarOpenButtonRef: RefObject<HTMLButtonElement | null>
  sending: boolean
  syncChrome: SyncChromeState
  syncing: boolean
  systemDateLocales: string[]
  t: Translator
  applyWelcomePrompt: (prompt: string) => void
  abandonMaskStrokeIfUncaptured: (
    event: ReactPointerEvent<HTMLCanvasElement>,
  ) => void
  cancelEditingMessage: () => void
  cancelMessageLongPress: () => void
  copyMessage: (message: ChatMessage) => MessageActionResult
  deleteMessage: (messageId: string) => MessageActionResult
  drawMaskStroke: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  finishMessageLongPress: (event: ReactPointerEvent<HTMLElement>) => void
  handleConversationTitleBlur: () => void
  handleConversationTitleKeyDown: (
    event: KeyboardEvent<HTMLInputElement>,
  ) => void
  handleDraftKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  handleAudioSourceChange: (event: ChangeEvent<HTMLInputElement>) => void
  handleAudioSourceDragEnter: (event: DragEvent<HTMLDivElement>) => void
  handleAudioSourceDragLeave: (event: DragEvent<HTMLDivElement>) => void
  handleAudioSourceDragOver: (event: DragEvent<HTMLDivElement>) => void
  handleAudioSourceDrop: (event: DragEvent<HTMLDivElement>) => void
  handleImageSourceChange: (event: ChangeEvent<HTMLInputElement>) => void
  handleImageSourceDragEnter: (event: DragEvent<HTMLDivElement>) => void
  handleImageSourceDragLeave: (event: DragEvent<HTMLDivElement>) => void
  handleImageSourceDragOver: (event: DragEvent<HTMLDivElement>) => void
  handleImageSourceDrop: (event: DragEvent<HTMLDivElement>) => void
  handleImageSourcePaste: (
    event: ReactClipboardEvent<HTMLDivElement>,
  ) => void
  handleMaskCanvasKeyDown: (event: KeyboardEvent<HTMLCanvasElement>) => void
  handleMessageContextMenuKeyDown: (
    event: KeyboardEvent<HTMLDivElement>,
  ) => void
  handleMessageListScroll: () => void
  jumpToLatestMessages: () => void
  moveMessageLongPress: (event: ReactPointerEvent<HTMLElement>) => void
  openMessageContextMenu: (
    event: ReactMouseEvent<HTMLElement>,
    message: ChatMessage,
  ) => void
  openSettings: OpenSettingsHandler
  openSidebar: (openedByPointer?: boolean) => void
  regenerateAssistantMessage: (messageId: string) => MessageActionResult
  selectConversationAudioTranscriptionModel: (
    providerId: string,
    model: string,
  ) => void
  selectConversationImageModel: (providerId: string, model: string) => void
  selectConversationProviderModel: (providerId: string, model: string) => void
  setComposerMode: (mode: ComposerMode) => void
  setConversationTitleDraft: (value: string) => void
  setAudioSource: (file: File | null) => void
  setDraft: (value: string) => void
  setEditingContent: (value: string) => void
  setImageSource: (file: File | null) => void
  reportImageSourcePreviewFailed: () => void
  setImageTaskMode: (mode: ImageTaskMode) => void
  setMaskBrushSize: (value: number) => void
  speakMessage: (message: ChatMessage) => MessageActionResult
  speakingMessageId: string
  setNotice: (
    message: string,
    tone?: NoticeTone,
    target?: NoticeTarget,
    anchorId?: string,
  ) => void
  startConversationTitleEdit: () => void
  startEditingMessage: (message: ChatMessage) => void
  startMessageLongPress: (
    event: ReactPointerEvent<HTMLElement>,
    message: ChatMessage,
  ) => void
  startMaskStroke: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  stopGeneration: () => void
  stopSpeakingMessage: () => void
  stopMaskStroke: (event: ReactPointerEvent<HTMLCanvasElement>) => void
  submitEditedUserMessage: () => MessageActionResult
  syncMaskCanvasSize: (image: HTMLImageElement) => void
  toggleChatModelMenu: (
    activeProvider: ProviderConfig,
    providers: ProviderConfig[],
  ) => void
  toggleChatModelProviderExpanded: (
    providerId: string,
    expanded: boolean,
  ) => void
  undoMaskCanvas: () => void
  clearMaskCanvas: () => void
  sendMessage: (event: FormEvent<HTMLFormElement>) => void
}
