import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import { assertWebProductionExecutionModel } from '../web-production-reachability.mjs'
import { findUiAccessibilityContractFailures } from '../ui-accessibility-contracts.mjs'
import {
  renderedActionTargetMeetsMinimum,
  renderedButtonContentIsCentered,
  renderedControlOverlap,
  renderedElementClipsContent,
  renderedPlaceholderFits,
  renderedTouchTargetMeetsMinimum,
  renderedVisibleRect,
} from '../visual-geometry-contract.mjs'

async function readFixture() {
  const model = assertWebProductionExecutionModel()
  const sourceEntries = await Promise.all(
    model.files
      .filter((file) => /\.tsx?$/u.test(file))
      .map(async (file) => [file, await readFile(file, 'utf8')]),
  )
  const sourceByFile = new Map(sourceEntries)
  return {
    sourceEntries,
    css: await readFile('src/app/app.css', 'utf8'),
    strings: await readFile('src/app/strings.ts', 'utf8'),
    indexHtml: await readFile('index.html', 'utf8'),
    markdownSource: await readFile('src/services/markdown.ts', 'utf8'),
    markdownComponent: sourceByFile.get('src/app/components/Markdown.tsx') ?? '',
    markdownRenderStateTestSource: await readFile(
      'src/app/__tests__/markdown-render-state.test.tsx',
      'utf8',
    ),
    storeTestSource: await readFile('src/app/__tests__/store.test.ts', 'utf8'),
    runtimeSource: sourceByFile.get('src/app/components/RuntimeBoundary.tsx') ?? '',
    appTooltipTestSource: await readFile(
      'src/app/__tests__/app-tooltip.test.ts',
      'utf8',
    ),
    browserSmokeSource: await readFile('scripts/browser-skill-smoke.mjs', 'utf8'),
  }
}

function cloneFixture(fixture) {
  return {
    ...fixture,
    sourceEntries: fixture.sourceEntries.map(([file, source]) => [file, source]),
  }
}

function replaceSource(fixture, file, mutate) {
  fixture.sourceEntries = fixture.sourceEntries.map(([candidate, source]) =>
    candidate === file ? [candidate, mutate(source)] : [candidate, source],
  )
  if (file === 'src/app/components/Markdown.tsx') {
    fixture.markdownComponent = mutate(fixture.markdownComponent)
  }
  if (file === 'src/app/components/RuntimeBoundary.tsx') {
    fixture.runtimeSource = mutate(fixture.runtimeSource)
  }
}

test('current UI accessibility fixture is green before mutation', async () => {
  const fixture = await readFixture()
  assert.deepEqual(findUiAccessibilityContractFailures(fixture), [])
})

test('visual geometry rejects only rendered content clipped by its own overflow boundary', () => {
  const element = {
    clientHeight: 24,
    clientWidth: 80,
    scrollHeight: 24,
    scrollWidth: 96,
  }

  assert.equal(
    renderedElementClipsContent(element, () => ({
      overflowX: 'hidden',
      overflowY: 'visible',
    })),
    true,
  )
  assert.equal(
    renderedElementClipsContent(element, () => ({
      overflowX: 'visible',
      overflowY: 'visible',
    })),
    false,
  )
  assert.equal(
    renderedElementClipsContent(
      { ...element, scrollHeight: 40, scrollWidth: 80 },
      () => ({ overflowX: 'visible', overflowY: 'clip' }),
    ),
    true,
  )
  assert.equal(
    renderedElementClipsContent(
      { ...element, scrollWidth: element.clientWidth + 1 },
      () => ({ overflowX: 'hidden', overflowY: 'visible' }),
    ),
    false,
  )
})

test('visual geometry measures only visible empty placeholders inside field padding', () => {
  const field = {
    clientWidth: 120,
    getAttribute: (name) => (name === 'placeholder' ? 'A localized hint' : null),
    value: '',
  }
  const style = {
    fontFamily: 'sans-serif',
    fontSize: '14px',
    fontStyle: 'normal',
    fontVariant: 'normal',
    fontWeight: '400',
    paddingLeft: '12px',
    paddingRight: '12px',
  }

  assert.equal(
    renderedPlaceholderFits(field, () => 98, () => style),
    false,
  )
  assert.equal(
    renderedPlaceholderFits(field, () => 97, () => style),
    true,
  )
  assert.equal(
    renderedPlaceholderFits({ ...field, value: 'draft' }, () => 999, () => style),
    true,
  )
  assert.equal(
    renderedPlaceholderFits(
      { ...field, getAttribute: () => '' },
      () => 999,
      () => style,
    ),
    true,
  )
})

test('visual geometry rejects visibly off-center button content with a two-pixel tolerance', () => {
  const button = {
    getBoundingClientRect: () => ({
      bottom: 40,
      height: 40,
      left: 0,
      right: 100,
      top: 0,
      width: 100,
    }),
  }

  assert.equal(
    renderedButtonContentIsCentered(button, () => [
      { bottom: 30, height: 20, left: 30, right: 70, top: 10, width: 40 },
    ]),
    true,
  )
  assert.equal(
    renderedButtonContentIsCentered(button, () => [
      { bottom: 30, height: 20, left: 32, right: 72, top: 10, width: 40 },
    ]),
    true,
  )
  assert.equal(
    renderedButtonContentIsCentered(button, () => [
      { bottom: 30, height: 20, left: 33, right: 73, top: 10, width: 40 },
    ]),
    false,
  )
  assert.equal(
    renderedButtonContentIsCentered(button, () => [
      { bottom: 27, height: 20, left: 30, right: 70, top: 7, width: 40 },
    ]),
    false,
  )
  assert.equal(renderedButtonContentIsCentered(button, () => []), true)
})

test('visual geometry requires every action target axis to reach 28 pixels', () => {
  const target = (width, height) => ({
    getBoundingClientRect: () => ({ height, width }),
  })

  assert.equal(renderedActionTargetMeetsMinimum(target(28, 28)), true)
  assert.equal(renderedActionTargetMeetsMinimum(target(27.9, 40)), false)
  assert.equal(renderedActionTargetMeetsMinimum(target(40, 27.9)), false)
  assert.equal(renderedActionTargetMeetsMinimum(target(24, 24), 24), true)
})

test('visual geometry keeps the 44px touch-target boundary strict', () => {
  const target = (width, height = width) => ({
    getBoundingClientRect: () => ({ height, width }),
  })

  for (const size of [43, 43.5, 43.9]) {
    assert.equal(
      renderedTouchTargetMeetsMinimum(target(size), 44, 0.05),
      false,
      `${size}px must fail the 44px touch-target contract`,
    )
  }
  for (const size of [43.98, 44]) {
    assert.equal(
      renderedTouchTargetMeetsMinimum(target(size), 44, 0.05),
      true,
      `${size}px must satisfy the browser quantization allowance`,
    )
  }
  assert.equal(
    renderedTouchTargetMeetsMinimum(target(44, 43.9), 44, 0.05),
    false,
    'each touch-target axis must satisfy the boundary',
  )
})

test('Composer image removal controls keep the action and mobile touch minimums', async () => {
  const { css } = await readFixture()
  const baseRule = css.match(/\.zc-thumb button\s*\{([^}]*)\}/u)?.[1] ?? ''
  const mobileRule = css.match(
    /@media\s*\(max-width:\s*480px\)\s*\{[\s\S]*?\.zc-thumb button[\s\S]*?\{([^}]*)\}/u,
  )?.[1] ?? ''

  assert.match(baseRule, /\bwidth:\s*28px;/u)
  assert.match(baseRule, /\bheight:\s*28px;/u)
  assert.match(baseRule, /\bmin-width:\s*28px;/u)
  assert.match(baseRule, /\bmin-height:\s*28px;/u)
  assert.match(mobileRule, /\bwidth:\s*44px;/u)
  assert.match(mobileRule, /\bheight:\s*44px;/u)
  assert.match(mobileRule, /\bmin-width:\s*44px;/u)
  assert.match(mobileRule, /\bmin-height:\s*44px;/u)
})

test('Provider switches keep a rendered action-size margin above the strict minimum', async () => {
  const { css } = await readFixture()
  const baseRule =
    css.match(/(?:^|[\r\n])\s*\.zc-switch\s*\{([^}]*)\}/u)?.[1] ?? ''
  const mobileRule =
    [...css.matchAll(/@media\s*\(max-width:\s*480px\)\s*\{([\s\S]*?)(?=\r?\n\s*@media|\s*$)/gu)]
      .map((match) =>
        match[1].match(/(?:^|[\r\n])\s*\.zc-switch\s*\{([^}]*)\}/u)?.[1],
      )
      .find((rule) => rule?.includes('height: 44px;')) ?? ''

  assert.match(baseRule, /\bwidth:\s*44px;/u)
  assert.match(baseRule, /\bmin-width:\s*44px;/u)
  assert.match(baseRule, /\bheight:\s*30px;/u)
  assert.match(baseRule, /\bmin-height:\s*30px;/u)
  assert.match(mobileRule, /\bheight:\s*44px;/u)
})

test('visual geometry reports only non-nested control overlap beyond two pixels', () => {
  const control = (rect) => ({
    contains: () => false,
    getBoundingClientRect: () => rect,
  })
  const left = control({ bottom: 30, left: 0, right: 30, top: 0 })

  assert.deepEqual(
    renderedControlOverlap(
      left,
      control({ bottom: 40, left: 27, right: 57, top: 20 }),
    ),
    { height: 10, width: 3 },
  )
  assert.equal(
    renderedControlOverlap(
      left,
      control({ bottom: 40, left: 28, right: 58, top: 20 }),
    ),
    null,
  )
  assert.equal(
    renderedControlOverlap(
      { ...left, contains: () => true },
      control({ bottom: 20, left: 10, right: 20, top: 10 }),
    ),
    null,
  )
})

test('visual geometry clips rendered rectangles to each overflow axis', () => {
  const parent = {
    getBoundingClientRect: () => ({ bottom: 100, left: 0, right: 80, top: 30 }),
    parentElement: null,
  }
  const element = {
    getBoundingClientRect: () => ({ bottom: 40, left: -10, right: 90, top: 10 }),
    parentElement: parent,
  }
  const rect = renderedVisibleRect(
    element,
    (target) =>
      target === parent
        ? { overflowX: 'visible', overflowY: 'auto' }
        : { overflowX: 'visible', overflowY: 'visible' },
    { bottom: 120, left: 0, right: 120, top: 0 },
  )

  assert.deepEqual(rect, {
    bottom: 40,
    height: 10,
    left: 0,
    right: 90,
    top: 30,
    width: 90,
  })
})

test('each current UI accessibility contract rejects a temporary negative mutation', async () => {
  const fixture = await readFixture()
  const mutations = [
    {
      id: 'button type',
      mutate: (value) => value.replace('type="button"', ''),
      expected: 'Reachable buttons must declare type:',
      file: 'src/app/App.tsx',
    },
    {
      id: 'icon name',
      mutate: (value) =>
        value.replace(/<button\b[\s\S]*?className="zc-icon-btn"[\s\S]*?>/u, (tag) =>
          tag
            .replace(/\s+aria-label=\{[^}]+\}/u, '')
            .replace(/\s+data-tooltip=\{[^}]+\}/u, ''),
        ),
      expected: 'Reachable icon buttons need an accessible name or tooltip:',
      file: 'src/app/components/ChatView.tsx',
    },
    {
      id: 'dialog semantics',
      mutate: (value) => value.replace('role="dialog"', ''),
      expected: 'Settings must expose modal, labelled-title, and described-body dialog semantics.',
      file: 'src/app/components/SettingsView.tsx',
    },
    {
      id: 'dialog title relationship',
      mutate: (value) => value.replace('aria-labelledby="settings-dialog-title"', ''),
      expected: 'Settings must expose modal, labelled-title, and described-body dialog semantics.',
      file: 'src/app/components/SettingsView.tsx',
    },
    {
      id: 'dialog description relationship',
      mutate: (value) => value.replace('aria-describedby="settings-dialog-description"', ''),
      expected: 'Settings must expose modal, labelled-title, and described-body dialog semantics.',
      file: 'src/app/components/SettingsView.tsx',
    },
    {
      id: 'log semantics',
      mutate: (value) => value.replace('role="log"', ''),
      expected: 'The message transcript must expose log and live-region semantics.',
      file: 'src/app/components/MessageList.tsx',
    },
    {
      id: 'status semantics',
      mutate: (value) => value.replace('role="status"', ''),
      expected: 'User notifications must expose status and polite live-region semantics.',
      file: 'src/app/components/Toast.tsx',
    },
    {
      id: 'markdown sanitizer boundary',
      mutate: (value) => value.replace('safeMarkdownLinkProtocols', 'removedMarkdownLinkProtocols'),
      expected: 'Markdown must keep its HTTP(S)/data-image allowlist and escaped raw HTML boundary.',
      markdown: true,
    },
    {
      id: 'markdown render fallback semantics',
      mutate: (value) =>
        value.replace(
          'className="message-markdown-fallback" role="status" aria-live="polite"',
          'className="message-markdown-fallback" aria-live="polite"',
        ),
      expected:
        'Markdown render failures must stay content-owned, localized, polite, and free of raw diagnostics.',
      file: 'src/app/components/Markdown.tsx',
    },
    {
      id: 'locale key set',
      mutate: (value) => value.replace("  'common.reload': 'Reload',\n", ''),
      expected: 'Current app locale dictionaries must expose the same key set.',
      strings: true,
    },
    {
      id: 'focus visible',
      mutate: (value) => value.replaceAll(':focus-visible', ':focus-removed'),
      expected: 'Current UI must define a visible keyboard focus treatment.',
      css: true,
    },
    {
      id: 'reduced motion',
      mutate: (value) => value.replace('@media (prefers-reduced-motion: reduce)', '@media (motion-removed)'),
      expected: 'Current UI must honor reduced-motion preferences.',
      css: true,
    },
    {
      id: 'responsive layout',
      mutate: (value) => value.replaceAll('@media', '@media-removed'),
      expected: 'Current UI must retain responsive layout rules.',
      css: true,
    },
    {
      id: 'mobile touch targets',
      mutate: (value) => value.replaceAll('min-height: 44px;', 'min-height: 43px;'),
      expected: 'Mobile interactive controls must retain 44px touch-target styling.',
      css: true,
    },
    {
      id: 'boot shell coverage',
      mutate: (value) =>
        value.replace(
          /(\.zc-boot\s*\{[\s\S]*?background:\s*)var\(--bg\);/u,
          '$1transparent;',
        ),
      expected: 'Loading and runtime recovery shells must cover underlying page content.',
      css: true,
    },
    {
      id: 'toast compact geometry',
      mutate: (value) =>
        value
          .replace(
            /\s*min-width:\s*min\(280px,\s*calc\(100vw\s*-\s*32px\)\);/u,
            '',
          )
          .replace('overflow-wrap: anywhere;', 'overflow-wrap: normal;'),
      expected: 'Toast messages must keep a readable compact width and wrap without overflowing.',
      css: true,
    },
    {
      id: 'toast micro queue',
      mutate: (value) =>
        value.replace(
          /\.zc-toast:not\(:last-child\)\s*\{[\s\S]*?display:\s*none;/u,
          '.zc-toast:not(:last-child) { display: flex;',
        ),
      expected: 'Micro viewports must show only the latest toast so notifications do not cover the page.',
      css: true,
    },
    {
      id: 'message virtualization',
      mutate: (value) =>
        value.replace('visibleMessages.map((message) =>', 'messages.map((message) =>'),
      expected: 'Long message transcripts must render only the virtualized window.',
      file: 'src/app/components/MessageList.tsx',
    },
    {
      id: 'message row ownership',
      mutate: (value) =>
        value.replace(
          'const MessageRow = memo(function MessageRow(',
          'const RemovedMessageRow = memo(function RemovedMessageRow(',
        ),
      expected: 'Long message transcripts must render only the virtualized window.',
      file: 'src/app/components/MessageList.tsx',
    },
    {
      id: 'message scroll position',
      mutate: (value) =>
        value.replace('setShowNewMessagesButton(true)', 'setShowNewMessagesButton(false)'),
      expected: 'Incoming messages must preserve reader position and expose a jump action.',
      file: 'src/app/components/MessageList.tsx',
    },
    {
      id: 'message scroll runtime',
      mutate: (value) =>
        value.replace(
          'newMessagesReaderState.buttonVisible',
          'newMessagesReaderState.removedButtonEvidence',
        ),
      expected: 'Incoming messages must preserve reader position and expose a jump action.',
      browserSmoke: true,
    },
    {
      id: 'rich Markdown runtime',
      mutate: (value) =>
        value.replace(
          'richMarkdownState.scriptElementCount',
          'richMarkdownState.removedScriptBoundary',
        ),
      expected:
        'Rich Markdown must keep its real-worker DOM, raw-HTML, safe-link, and TSX-code runtime contract.',
      browserSmoke: true,
    },
    {
      id: 'chat context window',
      mutate: (value) =>
        value.replace('data-chat-context-setting="true"', ''),
      expected: 'Chat context window must be configurable from current Settings.',
      file: 'src/app/components/SettingsView.tsx',
    },
    {
      id: 'light neutral palette',
      mutate: (value) => value.replace('--bg: #f7f8fa;', '--bg: #f5efe6;'),
      expected: 'Light theme surfaces must retain the neutral cool-gray palette.',
      css: true,
    },
    {
      id: 'onboarding CJK copy',
      mutate: (value) =>
        value.replace(
          '密钥和数据只保存在本机。先添加一个提供商并填入 API Key，就可以开始聊天。',
          '密钥和数据只保存在本机。请先添加一个提供商并填写服务地址、访问密钥、模型名称以及其他所有连接配置，确认全部字段正确后就可以开始聊天。',
        ),
      expected: 'Chinese onboarding copy must stay compact for ultra-narrow viewports.',
      strings: true,
    },
    {
      id: 'app tooltip layer',
      mutate: (value) => value.replace('<AppTooltip />', ''),
      expected: 'Current app tooltips must render an accessible delegated layer for hover and focus.',
      file: 'src/app/App.tsx',
    },
    {
      id: 'app tooltip delegated registration',
      mutate: (value) =>
        value.replace(
          "register(documentTarget, 'pointerover', onPointerOver)",
          "register(documentTarget, 'pointerout', onPointerOver)",
        ),
      expected: 'Current app tooltips must render an accessible delegated layer for hover and focus.',
      file: 'src/app/appTooltipSubscriptions.ts',
    },
    {
      id: 'message read aloud',
      mutate: (value) => value.replace('data-zc-message-context-speak="true"', ''),
      expected: 'Completed assistant messages must expose owned read-aloud controls.',
      file: 'src/app/components/MessageContextMenu.tsx',
    },
    {
      id: 'audio composer',
      mutate: (value) => value.replace('data-zc-audio-composer="true"', ''),
      expected: 'Current Composer must expose accessible audio upload and transcription controls.',
      file: 'src/app/components/Composer.tsx',
    },
    {
      id: 'audio transcription conversation ownership',
      mutate: (value) =>
        value.replace(
          'invalidates pending audio transcription when the active conversation changes',
          'allows pending audio transcription to cross active conversations',
        ),
      expected: 'Current Composer must expose accessible audio upload and transcription controls.',
      storeTest: true,
    },
    {
      id: 'composer mode lock',
      mutate: (value) => value.replaceAll('disabled={modeSwitchingDisabled}', ''),
      expected: 'Composer mode controls must expose native disabled semantics during generation.',
      file: 'src/app/components/Composer.tsx',
    },
    {
      id: 'provider empty layout class',
      mutate: (value) => value.replace(' provider-empty-state', ''),
      expected: 'Providerless recovery must keep its primary action near the top on compact screens.',
      file: 'src/app/components/Onboarding.tsx',
    },
    {
      id: 'provider empty compact layout',
      mutate: (value) => value.replace('align-content: start;', 'align-content: center;'),
      expected: 'Providerless recovery must keep its primary action near the top on compact screens.',
      css: true,
    },
    {
      id: 'image short viewport scroll range',
      mutate: (value) => value.replace('max-height: min(38svh, 210px);', 'max-height: none;'),
      expected: 'Short-height image composer must keep its controls in an internal scroll range.',
      css: true,
    },
    {
      id: 'inpaint pointer runtime',
      mutate: (value) =>
        value.replace(
          'assert.equal(secondaryButtonState.pixels, 0',
          'assert.equal(secondaryButtonState.pixels, 1',
        ),
      expected:
        'Current inpaint pointer ownership and undo must remain bound to browser pixel assertions.',
      browserSmoke: true,
    },
    {
      id: 'inpaint disabled tooltip hit target',
      mutate: (value) =>
        value.replace(
          '.mask-action-tooltip-target .ghost-button:disabled',
          '.mask-action-tooltip-target .ghost-button:enabled',
        ),
      expected:
        'Disabled current inpaint actions must expose localized tooltips through a real wrapper hit target.',
      css: true,
    },
    {
      id: 'composer mode disabled tooltip hit target',
      mutate: (value) =>
        value.replace(
          '.composer-mode-tooltip-target button:disabled',
          '.composer-mode-tooltip-target button:enabled',
        ),
      expected:
        'Disabled current composer modes must expose their busy reason through a keyboard and pointer owned wrapper.',
      css: true,
    },
    {
      id: 'compact composer action geometry',
      mutate: (value) =>
        value.replace(
          'compactComposerActionState.sendConsumesRow',
          'compactComposerActionState.removedSendGeometry',
        ),
      expected: 'Compact current Composer must keep Send bounded beside a usable text field.',
      browserSmoke: true,
    },
    {
      id: 'conversation starters named group',
      mutate: (value) => value.replace('role="group"', ''),
      expected:
        'Empty conversations must expose a named starter group that fills and focuses without sending.',
      file: 'src/app/components/ConversationStarters.tsx',
    },
  ]

  for (const mutation of mutations) {
    const mutated = cloneFixture(fixture)
    if (mutation.css) mutated.css = mutation.mutate(mutated.css)
    else if (mutation.strings) mutated.strings = mutation.mutate(mutated.strings)
    else if (mutation.markdown) mutated.markdownSource = mutation.mutate(mutated.markdownSource)
    else if (mutation.browserSmoke) {
      mutated.browserSmokeSource = mutation.mutate(mutated.browserSmokeSource)
    }
    else if (mutation.storeTest) {
      mutated.storeTestSource = mutation.mutate(mutated.storeTestSource)
    }
    else replaceSource(mutated, mutation.file, mutation.mutate)

    const failures = findUiAccessibilityContractFailures(mutated)
    assert.ok(
      failures.some((failure) => failure.includes(mutation.expected)),
      `${mutation.id} mutation must fail closed: ${failures.join(' | ')}`,
    )
    assert.deepEqual(
      findUiAccessibilityContractFailures(fixture),
      [],
      `${mutation.id} must not mutate the original fixture`,
    )
  }
})
