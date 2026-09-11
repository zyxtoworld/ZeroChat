const uiAccessibilityContractIds = Object.freeze([
  'ui.button-type',
  'ui.icon-name',
  'ui.dialog-semantics',
  'ui.log-semantics',
  'ui.status-semantics',
  'ui.markdown-sanitizer-boundary',
  'ui.markdown-rich-runtime',
  'ui.locale-key-set',
  'ui.focus-visible',
  'ui.reduced-motion',
  'ui.responsive-layout',
  'ui.message-virtualization',
  'ui.message-scroll-position',
  'ui.chat-context-window',
  'ui.light-neutral-palette',
  'ui.onboarding-cjk-copy',
  'ui.app-tooltip-layer',
  'ui.message-read-aloud',
  'ui.audio-composer',
  'ui.composer-mode-lock',
  'ui.provider-empty-layout',
  'ui.image-short-viewport',
  'ui.inpaint-pointer-runtime',
  'ui.inpaint-disabled-tooltip',
  'ui.composer-mode-disabled-tooltip',
  'ui.markdown-render-fallback',
  'ui.compact-composer-action-geometry',
  'ui.conversation-starters',
])

export { uiAccessibilityContractIds }

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/u).length
}

function stringKeys(source, locale) {
  const block = localeStringBlock(source, locale)

  return new Set(
    [...block.matchAll(/^\s*(['"])([^'"]+)\1\s*:/gmu)].map((match) => match[2]),
  )
}

function localeStringBlock(source, locale) {
  return source.match(
    new RegExp(
      `export const ${locale}(?:\\s*:\\s*[^=]+)?\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`,
      'u',
    ),
  )?.[1] ?? ''
}

function localeStringValue(source, locale, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return localeStringBlock(source, locale).match(
    new RegExp(`^\\s*['"]${escapedKey}['"]\\s*:\\s*['"]([^'"\\r\\n]*)['"]`, 'mu'),
  )?.[1] ?? ''
}

function allLocaleKeysEqual(source, locales) {
  const keySets = locales.map((locale) => stringKeys(source, locale))
  if (keySets.some((keys) => keys.size === 0)) return false
  return keySets.every(
    (keys) =>
      keys.size === keySets[0].size &&
      [...keySets[0]].every((key) => keys.has(key)),
  )
}

function addMissing(failures, condition, message) {
  if (!condition) failures.push(message)
}

function buttonTypeViolations(entries) {
  const violations = []
  for (const [file, source] of entries) {
    for (const match of source.matchAll(/<button\b[\s\S]*?>/gu)) {
      if (/\btype\s*=/u.test(match[0])) continue
      violations.push(`${file}:${lineNumber(source, match.index)}`)
    }
  }
  return violations
}

function iconButtonViolations(entries) {
  const violations = []
  for (const [file, source] of entries) {
    for (const match of source.matchAll(/<button\b[\s\S]*?>/gu)) {
      if (!/zc-icon-btn/u.test(match[0])) continue
      if (/\baria-label\s*=|\bdata-tooltip\s*=/u.test(match[0])) continue
      violations.push(`${file}:${lineNumber(source, match.index)}`)
    }
  }
  return violations
}

export function findUiAccessibilityContractFailures({
  sourceEntries,
  css,
  strings,
  indexHtml,
  markdownSource,
  markdownComponent,
  markdownRenderStateTestSource,
  storeTestSource,
  runtimeSource,
  appTooltipTestSource,
  browserSmokeSource,
}) {
  const failures = []
  const sourceByFile = new Map(sourceEntries)
  const app = (file) => sourceByFile.get(file) ?? ''
  const appSource = sourceEntries.map(([, source]) => source).join('\n')

  const missingButtonTypes = buttonTypeViolations(sourceEntries)
  addMissing(
    failures,
    missingButtonTypes.length === 0,
    `Reachable buttons must declare type: ${missingButtonTypes.join(', ')}`,
  )

  const unnamedIcons = iconButtonViolations(sourceEntries)
  addMissing(
    failures,
    unnamedIcons.length === 0,
    `Reachable icon buttons need an accessible name or tooltip: ${unnamedIcons.join(', ')}`,
  )

  addMissing(
    failures,
    app('src/app/components/SettingsView.tsx').includes('role="dialog"') &&
      app('src/app/components/SettingsView.tsx').includes('aria-modal="true"') &&
      app('src/app/components/SettingsView.tsx').includes(
        'aria-labelledby="settings-dialog-title"',
      ) &&
      app('src/app/components/SettingsView.tsx').includes(
        'aria-describedby="settings-dialog-description"',
      ) &&
      app('src/app/components/SettingsView.tsx').includes(
        '<h2 id="settings-dialog-title">',
      ) &&
      app('src/app/components/SettingsView.tsx').includes(
        '<h3 id="settings-dialog-description">',
      ),
    'Settings must expose modal, labelled-title, and described-body dialog semantics.',
  )
  addMissing(
    failures,
    app('src/app/components/MessageList.tsx').includes('role="log"') &&
      app('src/app/components/MessageList.tsx').includes('aria-live='),
    'The message transcript must expose log and live-region semantics.',
  )
  const messageListSource = app('src/app/components/MessageList.tsx')
  const markdownRenderStateSource = app('src/app/markdownRenderState.ts')
  addMissing(
    failures,
    messageListSource.includes('MESSAGE_VIRTUALIZATION_THRESHOLD') &&
      messageListSource.includes('const MessageRow = memo(function MessageRow(') &&
      messageListSource.includes('visibleMessages.map((message) =>') &&
      messageListSource.includes('<MessageRow') &&
      messageListSource.includes('data-message-virtual-spacer="top"') &&
      messageListSource.includes('data-message-virtual-spacer="bottom"') &&
      messageListSource.includes('virtualizedAnnouncement'),
    'Long message transcripts must render only the virtualized window.',
  )
  addMissing(
    failures,
    messageListSource.includes('if (!shouldAutoScroll)') &&
      messageListSource.includes('setShowNewMessagesButton(true)') &&
      messageListSource.includes('className="new-messages-button"') &&
      messageListSource.includes('onClick={jumpToLatestMessages}') &&
      css.includes('.new-messages-button') &&
      browserSmokeSource.includes('const newMessagesReaderBefore') &&
      browserSmokeSource.includes('newMessagesReaderState.buttonVisible') &&
      browserSmokeSource.includes(
        'An incoming turn must preserve the scrolled-up reader position',
      ) &&
      browserSmokeSource.includes(
        'An incoming turn must not force the reader to the bottom',
      ),
    'Incoming messages must preserve reader position and expose a jump action.',
  )
  const messageContextMenuSource = app('src/app/components/MessageContextMenu.tsx')
  const currentStoreSource = app('src/app/store.ts')
  addMissing(
    failures,
    messageContextMenuSource.includes('messageCanSpeak(message)') &&
      messageContextMenuSource.includes('data-zc-message-context-speak="true"') &&
      messageContextMenuSource.includes("'message.stopReading'") &&
      messageListSource.includes('speakingMessageId={speakingMessageId}') &&
      messageListSource.includes('onSpeakMessage={speakMessage}') &&
      currentStoreSource.includes('speakMessage: async (message) =>') &&
      currentStoreSource.includes('speechRequestIsCurrent') &&
      currentStoreSource.includes('stopSpeechPlayback(false)'),
    'Completed assistant messages must expose owned read-aloud controls.',
  )
  const composerSource = app('src/app/components/Composer.tsx')
  const conversationStartersSource = app(
    'src/app/components/ConversationStarters.tsx',
  )
  const interactionFocusSource = app('src/services/interactionFocus.ts')
  const composerModeMapCurrent =
    composerSource.includes("(['chat', 'image', 'audio'] as ComposerMode[]).map") &&
    composerSource.includes('data-zc-composer-mode={mode}')
  addMissing(
    failures,
    composerSource.includes("from '../../services/audioComposerController'") &&
      composerModeMapCurrent &&
      composerSource.includes('data-zc-audio-composer="true"') &&
      composerSource.includes('accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/webm"') &&
      composerSource.includes('data-zc-audio-transcribe="true"') &&
      currentStoreSource.includes('transcribeAudio: async (file) =>') &&
      currentStoreSource.includes('let audioTranscriptionOwner: AudioTranscriptionOwner | null = null') &&
      currentStoreSource.includes('audioTranscriptionOwner = owner') &&
      currentStoreSource.includes('audioTranscriptionOwner !== owner') &&
      currentStoreSource.includes('providerMediaOwnerMatchesSnapshot(') &&
      storeTestSource.includes(
        'invalidates pending audio transcription when the active conversation changes',
      ) &&
      css.includes('.zc-audio-composer') &&
      css.includes('@media (max-height: 560px)'),
    'Current Composer must expose accessible audio upload and transcription controls.',
  )
  addMissing(
    failures,
    composerSource.includes(
      'const modeSwitchingDisabled = generationActive || transcribingAudio',
    ) &&
      composerSource.includes('if (modeSwitchingDisabled) return') &&
      composerModeMapCurrent &&
      (composerSource.match(/disabled=\{modeSwitchingDisabled\}/gu) ?? []).length === 1,
    'Composer mode controls must expose native disabled semantics during generation.',
  )
  addMissing(
    failures,
    composerSource.includes('const modeSwitchingTooltip = transcribingAudio') &&
      composerSource.includes('className="composer-mode-tooltip-target"') &&
      composerSource.includes('tabIndex={modeSwitchingDisabled ? 0 : undefined}') &&
      css.includes('.composer-mode-tooltip-target button:disabled') &&
      /wrapperOwnsHit:\s*true/gu.test(browserSmokeSource) &&
      browserSmokeSource.includes("'locked current composer mode tooltip'"),
    'Disabled current composer modes must expose their busy reason through a keyboard and pointer owned wrapper.',
  )
  addMissing(
    failures,
    browserSmokeSource.includes('const compactComposerActionState = await evaluate') &&
      browserSmokeSource.includes('compactComposerActionState.sendConsumesRow') &&
      browserSmokeSource.includes(
        'compactComposerActionState.textareaWidth > compactComposerActionState.sendWidth',
      ) &&
      browserSmokeSource.includes('compactComposerActionState.controlsInsideRow'),
    'Compact current Composer must keep Send bounded beside a usable text field.',
  )
  addMissing(
    failures,
    conversationStartersSource.includes('data-conversation-starters="true"') &&
      conversationStartersSource.includes('role="group"') &&
      conversationStartersSource.includes(
        "aria-label={t('welcome.quickPromptGroup')}",
      ) &&
      conversationStartersSource.includes('data-conversation-starter={starter.id}') &&
      conversationStartersSource.includes('type="button"') &&
      composerSource.includes(
        "composerMode === 'chat' && activeConversationOf(data)?.messages.length === 0",
      ) &&
      composerSource.includes("from '../../services/interactionFocus'") &&
      composerSource.includes('scheduleInteractionFocus(() => textareaRef.current)') &&
      interactionFocusSource.includes('focusInteractionElement') &&
      interactionFocusSource.includes('requestFrame') &&
      css.includes('.zc-conversation-starters') &&
      browserSmokeSource.includes('const conversationStarterState = await evaluate') &&
      browserSmokeSource.includes(
        'Conversation starter must fill and focus the Composer without sending',
      ) &&
      browserSmokeSource.includes(
        'Conversation starter must not issue a network request before explicit submission',
      ),
    'Empty conversations must expose a named starter group that fills and focuses without sending.',
  )
  addMissing(
    failures,
    composerModeMapCurrent &&
      app('src/app/components/ImageComposerPanel.tsx').includes('className="image-compose-panel"') &&
      css.includes('max-height: min(38svh, 210px);') &&
      css.includes('.image-preview-stack,\n  .image-source-preview') &&
      css.includes('max-height: 150px;'),
    'Short-height image composer must keep its controls in an internal scroll range.',
  )
  addMissing(
    failures,
    /assert\.equal\(\s*secondaryButtonState\.pixels,\s*0/gu.test(browserSmokeSource) &&
      /assert\.equal\(\s*nonPrimaryPointerState\.pixels,\s*0/gu.test(browserSmokeSource) &&
      /assert\.equal\(\s*maskUndoState\.afterUndoPixels,\s*0/gu.test(browserSmokeSource) &&
      /assert\.equal\(\s*maskUndoState\.afterClearUndoPixels,\s*maskUndoState\.afterSecondPaintPixels/gu.test(
        browserSmokeSource,
      ) &&
      /assert\.equal\(\s*maskUndoState\.captureFailureRecoveryUndoPixels,\s*maskUndoState\.captureFailureBoundaryPixels/gu.test(
        browserSmokeSource,
      ),
    'Current inpaint pointer ownership and undo must remain bound to browser pixel assertions.',
  )
  addMissing(
    failures,
    app('src/app/components/ImageComposerPanel.tsx').includes(
      'className="mask-action-tooltip-target"',
    ) &&
      css.includes('.mask-action-tooltip-target .ghost-button:disabled') &&
      css.includes('pointer-events: none;') &&
      /assert\.equal\(\s*inpaintDisabledTooltipState\?\.wrapperOwnsHit,\s*true/gu.test(
        browserSmokeSource,
      ) &&
      browserSmokeSource.includes("'disabled current inpaint wrapper tooltip'"),
    'Disabled current inpaint actions must expose localized tooltips through a real wrapper hit target.',
  )
  const settingsSource = app('src/app/components/SettingsView.tsx')
  addMissing(
    failures,
    settingsSource.includes('data-chat-context-setting="true"') &&
      settingsSource.includes('MIN_CHAT_CONTEXT_MESSAGE_LIMIT') &&
      settingsSource.includes('MAX_CHAT_CONTEXT_MESSAGE_LIMIT') &&
      settingsSource.includes('aria-describedby={chatContextHelpId}') &&
      settingsSource.includes('setChatContextMessageLimit') &&
      appSource.includes('updateChatContextMessageLimitPreference'),
    'Chat context window must be configurable from current Settings.',
  )
  addMissing(
    failures,
    app('src/app/components/Toast.tsx').includes('role="status"') &&
      app('src/app/components/Toast.tsx').includes('aria-live="polite"'),
    'User notifications must expose status and polite live-region semantics.',
  )
  const appRootSource = app('src/app/App.tsx')
  const appTooltipSource = app('src/app/components/AppTooltip.tsx')
  const appTooltipPositionSource = app('src/app/tooltipPosition.ts')
  const appTooltipSubscriptionsSource = app(
    'src/app/appTooltipSubscriptions.ts',
  )
  addMissing(
    failures,
    appRootSource.includes("from './components/AppTooltip'") &&
      appRootSource.includes('<AppTooltip />') &&
      appTooltipSource.includes("closest<HTMLElement>('[data-tooltip]')") &&
      appTooltipSource.includes('role="tooltip"') &&
      appTooltipSource.includes('if (!nextPosition) {') &&
      appTooltipPositionSource.includes('export function tooltipPositionFromDom(') &&
      appTooltipPositionSource.includes(
        'if (values.some((value) => !Number.isFinite(value))) return null',
      ) &&
      appTooltipTestSource.includes(
        'skips the decorative tooltip when DOM measurement fails',
      ) &&
      appTooltipSubscriptionsSource.includes(
        "register(documentTarget, 'pointerover', onPointerOver)",
      ) &&
      appTooltipSubscriptionsSource.includes(
        "register(documentTarget, 'focus', onFocusIn, true)",
      ) &&
      settingsSource.includes('data-tooltip={provider.name}') &&
      settingsSource.includes('aria-label={provider.name}') &&
      settingsSource.includes('tabIndex={0}') &&
      css.includes('.zc-app-tooltip'),
    'Current app tooltips must render an accessible delegated layer for hover and focus.',
  )

  addMissing(
    failures,
    markdownComponent.includes('loadMarkdownService') &&
      markdownComponent.includes('dangerouslySetInnerHTML') &&
      markdownComponent.includes('sanitizer contract'),
    'The reachable Markdown component must consume the shared sanitized renderer.',
  )
  addMissing(
    failures,
    markdownComponent.includes('resolveMarkdownRenderState(content, async (value) =>') &&
      markdownComponent.includes('const renderKey = JSON.stringify([') &&
      markdownComponent.includes('}, renderKey).then((nextState) =>') &&
      markdownComponent.includes("from '../markdownRenderState'") &&
      markdownRenderStateSource.includes(
        'export async function resolveMarkdownRenderState(',
      ) &&
      markdownRenderStateSource.includes('catch {') &&
      markdownRenderStateSource.includes(
        "return { content, renderKey, html: null, status: 'failed' }",
      ) &&
      markdownRenderStateSource.includes(
        'export function markdownRenderStateForContent(',
      ) &&
      markdownComponent.includes(
        'markdownRenderStateForContent(',
      ) &&
      markdownComponent.includes('data-message-content="true"') &&
      markdownComponent.includes("visibleRenderState?.status === 'failed'") &&
      markdownComponent.includes(
        '<MarkdownFallbackStatus label={markdownFallback} />',
      ) &&
      markdownComponent.includes(
        'className="message-markdown-fallback" role="status" aria-live="polite"',
      ) &&
      messageListSource.includes(
        '<Markdown content={message.content} labels={createMarkdownLabels(t)} />',
      ) &&
      app('src/app/i18n.ts').includes(
        'return (key) => t(`message.${key}` as AppStringKey)',
      ) &&
      markdownComponent.includes(
        "const markdownFallback = labels('markdownFallback')",
      ) &&
      css.includes('.message-markdown-fallback') &&
      strings.includes("'message.markdownFallback':") &&
      markdownRenderStateTestSource.includes(
        'contains render failures without retaining the original exception',
      ) &&
      markdownRenderStateTestSource.includes(
        'invalidates stale render state when content or rendering mode changes',
      ) &&
      markdownRenderStateTestSource.includes(
        "expect(markdownRenderStateForContent(ready, '# old', true, 'zh')).toBeNull()",
      ) &&
      markdownRenderStateTestSource.includes(
        'renders localized fallback metadata as a polite status',
      ) &&
      markdownRenderStateTestSource.includes('secret-shaped-sentinel'),
    'Markdown render failures must stay content-owned, localized, polite, and free of raw diagnostics.',
  )
  addMissing(
    failures,
    markdownSource.includes(
      "safeMarkdownLinkProtocols = new Set(['http:', 'https:', 'mailto:'])",
    ) &&
      markdownSource.includes('safeDataImagePattern') &&
      markdownSource.includes('function safeMarkdownLinkUrl') &&
      markdownSource.includes('function safeMarkdownImageUrl') &&
      markdownSource.includes('renderer.html') &&
      markdownSource.includes('escapeHtml(text)'),
    'Markdown must keep its HTTP(S)/data-image allowlist and escaped raw HTML boundary.',
  )
  addMissing(
    failures,
    browserSmokeSource.includes('const richMarkdownState = await evaluate') &&
      browserSmokeSource.includes('richMarkdownState.scriptElementCount') &&
      browserSmokeSource.includes('richMarkdownState.rawHtmlExecuted') &&
      browserSmokeSource.includes("richMarkdownState.linkRel.includes('noopener')") &&
      browserSmokeSource.includes(
        "richMarkdownState.codeText.includes('<Button>{value}</Button>')",
      ) &&
      browserSmokeSource.includes(
        'Current rich Markdown DOM contract must render through the real worker',
      ),
    'Rich Markdown must keep its real-worker DOM, raw-HTML, safe-link, and TSX-code runtime contract.',
  )

  addMissing(
    failures,
    allLocaleKeysEqual(strings, ['zh', 'en', 'ja']),
    'Current app locale dictionaries must expose the same key set.',
  )
  const zhOnboardingBody = localeStringValue(strings, 'zh', 'onboarding.body')
  addMissing(
    failures,
    app('src/app/components/Onboarding.tsx').includes("'onboarding.body'") &&
      zhOnboardingBody.length > 0 &&
      [...zhOnboardingBody].length <= 48,
    'Chinese onboarding copy must stay compact for ultra-narrow viewports.',
  )
  addMissing(
    failures,
    app('src/app/components/Onboarding.tsx').includes('provider-empty-state') &&
      css.includes('.zc-empty.provider-empty-state') &&
      css.includes('align-content: start;') &&
      css.includes('padding-block: 48px 24px;'),
    'Providerless recovery must keep its primary action near the top on compact screens.',
  )

  addMissing(
    failures,
    css.includes(':focus-visible'),
    'Current UI must define a visible keyboard focus treatment.',
  )
  addMissing(
    failures,
    css.includes('@media (prefers-reduced-motion: reduce)'),
    'Current UI must honor reduced-motion preferences.',
  )
  addMissing(
    failures,
    /@media\s*\(/u.test(css),
    'Current UI must retain responsive layout rules.',
  )
  addMissing(
    failures,
    css.includes('@media (max-width: 480px)') &&
      css.includes('.zc-conv-item') &&
      css.includes('.zc-chat-title') &&
      css.includes('.zc-toast button') &&
      css.includes('min-height: 44px;'),
    'Mobile interactive controls must retain 44px touch-target styling.',
  )
  const bootShellBlock = css.match(/\.zc-boot\s*\{([\s\S]*?)\}/u)?.[1] ?? ''
  addMissing(
    failures,
    bootShellBlock.includes('background: var(--bg);'),
    'Loading and runtime recovery shells must cover underlying page content.',
  )
  const toastBlock = css.match(/\.zc-toast\s*\{([\s\S]*?)\}/u)?.[1] ?? ''
  addMissing(
    failures,
    toastBlock.includes('min-width: min(280px, calc(100vw - 32px));') &&
      css.includes('.zc-toast span') &&
      css.includes('overflow-wrap: anywhere;'),
    'Toast messages must keep a readable compact width and wrap without overflowing.',
  )
  const compactToastRule = [...css.matchAll(
    /@media\s*\(max-width:\s*480px\)\s*\{([\s\S]*?)\}/gu,
  )].some((match) =>
    match[1].includes('.zc-toast:not(:last-child)') &&
    match[1].includes('display: none;'),
  )
  addMissing(
    failures,
    compactToastRule,
    'Micro viewports must show only the latest toast so notifications do not cover the page.',
  )
  addMissing(
    failures,
    css.includes('--bg: #f7f8fa;') &&
      css.includes('--bg-elevated: #ffffff;') &&
      css.includes('--bg-sunken: #eef0f3;'),
    'Light theme surfaces must retain the neutral cool-gray palette.',
  )
  addMissing(
    failures,
    indexHtml.includes('/src/app/bootstrap.tsx') &&
      !indexHtml.includes('zerochat-startup.js'),
    'Production HTML must use the current bootstrap without a deleted startup bundle.',
  )
  addMissing(
    failures,
    runtimeSource.includes('console.error') &&
      !runtimeSource.includes('{error.message}'),
    'Runtime recovery may log diagnostics but must not expose raw error details in the UI.',
  )

  addMissing(
    failures,
    appSource.includes('message-scroll-region') &&
      css.includes('.message-scroll-region') &&
      css.includes('.zc-settings-overlay') &&
      css.includes('.zc-composer'),
    'Current UI layout surfaces must retain transcript, settings, and composer styles.',
  )

  return failures
}

export function assertUiAccessibilityContracts(input) {
  const failures = findUiAccessibilityContractFailures(input)
  if (failures.length > 0) {
    throw new Error(`UI accessibility contracts failed:\n- ${failures.join('\n- ')}`)
  }
  return { contractIds: uiAccessibilityContractIds, failures: [] }
}
