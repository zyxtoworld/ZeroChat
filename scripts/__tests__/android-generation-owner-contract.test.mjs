import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(import.meta.dirname, '../..')
const chatScreen = readFileSync(
  path.join(repoRoot, 'apps/android/app/src/main/java/app/zerochat/ui/ChatScreen.kt'),
  'utf8',
)
const zeroChatApp = readFileSync(
  path.join(repoRoot, 'apps/android/app/src/main/java/app/zerochat/ui/ZeroChatApp.kt'),
  'utf8',
)
const generationOwner = readFileSync(
  path.join(
    repoRoot,
    'apps/android/app/src/main/java/app/zerochat/ui/chat/GenerationTaskOwner.kt',
  ),
  'utf8',
)
const chatSettingsSheet = readFileSync(
  path.join(
    repoRoot,
    'apps/android/app/src/main/java/app/zerochat/ui/settings/ChatSettingsSheet.kt',
  ),
  'utf8',
)
const skillSettings = readFileSync(
  path.join(
    repoRoot,
    'apps/android/app/src/main/java/app/zerochat/ui/settings/SkillSettings.kt',
  ),
  'utf8',
)
const skillImportController = readFileSync(
  path.join(
    repoRoot,
    'apps/android/app/src/main/java/app/zerochat/ui/settings/SkillImportController.kt',
  ),
  'utf8',
)

function between(source, start, end) {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex + start.length)
  expect(startIndex, `missing ${start}`).toBeGreaterThanOrEqual(0)
  expect(endIndex, `missing ${end}`).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe('Android generation owner production wiring', () => {
  it('keeps the owner check and commit in one lock critical section', () => {
    const gate = between(
      generationOwner,
      'internal inline fun runIfCurrent(',
      'internal fun release(',
    )

    expect(gate).toMatch(/stateLock\.withLock\s*\{/u)
    expect(gate).toMatch(/isCurrentLocked\(lease\)/u)
    expect(gate).toMatch(/commit\(\)/u)
    expect(gate.indexOf('stateLock.withLock')).toBeLessThan(gate.indexOf('commit()'))
  })

  it('guards every text generation outcome and the initial pending commit', () => {
    const text = between(chatScreen, 'fun sendChatMessage(', 'fun generateImageMessage(')

    expect(text).toContain('val lease = generationTasks.tryAcquire() ?: return')
    expect(text).toContain('if (!lease.runIfCurrent {')
    expect(text).toContain('commitWithSync(pendingSnapshot, autoSync = false)')
    expect(text).toContain('generationTasks.prepare(scope, lease)')
    expect(text).toContain('onVisibleText = { visibleText ->')
    expect(text).toContain('stoppedAssistantMessage(')
    expect(text).toContain('message.generationFailed')
    expect(text).toContain('networkRetryingNotice(attempt, total)')
    expect(text.match(/lease\.runIfCurrent\s*\{/gu)?.length).toBeGreaterThanOrEqual(6)
  })

  it('guards image pending state and success, failure, and cancellation outcomes', () => {
    const image = between(chatScreen, 'fun generateImageMessage(', 'CompositionLocalProvider(')

    expect(image).toContain('val lease = generationTasks.tryAcquire() ?: return')
    expect(image).toContain('if (!lease.runIfCurrent {')
    expect(image).toContain('ownedStreamingImageMessageIds =')
    expect(image).toContain('commit(pendingSnapshot)')
    expect(image).toContain('generationTasks.prepare(scope, lease)')
    expect(image).toContain('completeImageMessage(')
    expect(image).toContain('failImageMessage(')
    expect(image).toContain('stoppedImageMessage(')
    expect(image.match(/lease\.runIfCurrent\s*\{/gu)?.length).toBeGreaterThanOrEqual(3)
  })

  it('drains generation tasks before both data replacement entry points', () => {
    const importSnapshot = between(zeroChatApp, 'suspend fun importSnapshot(', 'LaunchedEffect(backupTaskViewModel)')
    const resetLocalData = between(zeroChatApp, 'suspend fun resetLocalData(', 'suspend fun saveProviderKey(')

    expect(importSnapshot).toContain('generationTasks.withDrain {')
    expect(importSnapshot).toContain('autoSync.runExclusiveSnapshotReplacement {')
    expect(resetLocalData).toContain('generationTasks.withDrain {')
    expect(resetLocalData).toContain('autoSync.runExclusiveLocalReset {')
    expect(zeroChatApp).toContain('generationTasks = generationTasks')
  })

  it('keeps owner-typed settings entry points internal', () => {
    for (const [source, name] of [
      [chatSettingsSheet, 'ChatSettingsSheet'],
      [skillSettings, 'SkillsSettings'],
      [skillImportController, 'rememberSkillImportController'],
    ]) {
      expect(source).toMatch(
        new RegExp(`@Composable\\s+internal fun ${name}\\s*\\(`, 'u'),
      )
      expect(source).not.toMatch(
        new RegExp(`@Composable\\s+fun ${name}\\s*\\(`, 'u'),
      )
      expect(source).toContain('generationTasks: GenerationTaskOwner')
    }
  })
})
