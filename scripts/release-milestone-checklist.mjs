const releaseBlockersHeading = '### Release 阻塞残项'
const liveProviderUiChecklistLabel =
  'Live-provider Web UI browser-origin pass evidence'
const liveProviderUiQaChecklistLabel =
  'Live-provider Web UI browser-origin release evidence'
const liveSyncChecklistLabel = 'Disposable live sync release-pass'
const liveSyncPassedLine =
  '- [x] Disposable live sync release-pass：当前 source-current Gist drill 已通过 upload、second-device pull、edit/pull、delete/pull 与 remote clear 七阶段，`cleanup.remoteCleared: true`、`cleanup.createdDisposableGistDeleted: true`，并通过 `pnpm run check:live-sync-release-pass` 的 72 小时 freshness 与源码指纹校验。'
const liveSyncOpenLine =
  '- [ ] Disposable live sync release-pass：当前 canonical Gist pass 的 source fingerprint 已过期；使用一次性 Cloudflare/Gist 凭据、throwaway sync passphrase 与 destructive confirmation 重跑 `pnpm run drill:live-sync`，并通过 `pnpm run check:live-sync-release-pass`。'

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function syncUniqueChecklistLine(
  source,
  pattern,
  replacement,
  sectionLabel,
  itemLabel = liveSyncChecklistLabel,
) {
  const matches = [...source.matchAll(pattern)]
  if (matches.length !== 1) {
    throw new Error(`${sectionLabel} must contain exactly one ${itemLabel} item; found ${matches.length}.`)
  }
  return source.replace(pattern, replacement)
}

function hasCurrentReleaseResidualChecklist(source) {
  return /## 当前发布残余清单\r?\n[\s\S]*?(?=\r?\n## Open Gaps\r?\n)/u.test(
    source,
  )
}

function milestoneReleaseBlockersRange(requirements) {
  const phase4Section = requirements.match(
    /### Phase 4[^\r\n]*\r?\n[\s\S]*?(?=\r?\n### Release 阻塞残项)/u,
  )

  if (!phase4Section || typeof phase4Section.index !== 'number') {
    throw new Error('Unable to locate the REQUIREMENTS Phase 4 milestone section.')
  }

  const start = requirements.indexOf(
    releaseBlockersHeading,
    phase4Section.index + phase4Section[0].length,
  )
  const end = requirements.indexOf('\n---', start)

  if (start < 0 || end < 0) {
    throw new Error('Unable to locate the REQUIREMENTS milestone release blocker section.')
  }

  return { start, end }
}

export function syncLiveProviderUiMilestoneChecklist(requirements, passed) {
  const { start, end } = milestoneReleaseBlockersRange(requirements)
  const section = requirements.slice(start, end)
  const checklistPattern = new RegExp(
    `^- \\[([ x])\\] ${liveProviderUiChecklistLabel.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}`,
    'gmu',
  )
  const matches = [...section.matchAll(checklistPattern)]

  if (matches.length !== 1) {
    throw new Error(
      `REQUIREMENTS milestone release blocker section must contain exactly one ${liveProviderUiChecklistLabel} item; found ${matches.length}.`,
    )
  }

  const desiredState = passed ? 'x' : ' '
  const nextSection = section.replace(
    checklistPattern,
    `- [${desiredState}] ${liveProviderUiChecklistLabel}`,
  )

  return `${requirements.slice(0, start)}${nextSection}${requirements.slice(end)}`
}

export function syncLiveSyncRequirementsMilestoneChecklist(requirements, passed) {
  const { start, end } = milestoneReleaseBlockersRange(requirements)
  const section = requirements.slice(start, end)
  const pattern = new RegExp(
    `^- \\[([ x])\\] ${escapeRegExp(liveSyncChecklistLabel)}[^\\r\\n]*$`,
    'gmu',
  )
  const nextSection = syncUniqueChecklistLine(
    section,
    pattern,
    passed ? liveSyncPassedLine : liveSyncOpenLine,
    'REQUIREMENTS milestone release blocker section',
  )
  return `${requirements.slice(0, start)}${nextSection}${requirements.slice(end)}`
}

export function syncLiveSyncQaResidualChecklist(qaAudit, passed) {
  if (hasCurrentReleaseResidualChecklist(qaAudit)) {
    return qaAudit
  }
  const pattern = new RegExp(
    `^- \\[([ x])\\] ${escapeRegExp(liveSyncChecklistLabel)}[^\\r\\n]*$`,
    'gmu',
  )
  return syncUniqueChecklistLine(
    qaAudit,
    pattern,
    passed ? `- [x] ${liveSyncChecklistLabel}` : `- [ ] ${liveSyncChecklistLabel}`,
    'QA Audit release residual checklist',
  )
}

export function syncLiveProviderUiQaResidualChecklist(qaAudit, passed) {
  if (hasCurrentReleaseResidualChecklist(qaAudit)) {
    return qaAudit
  }
  const pattern = new RegExp(
    `^- \\[([ x])\\] ${escapeRegExp(liveProviderUiQaChecklistLabel)}[^\\r\\n]*$`,
    'gmu',
  )
  return syncUniqueChecklistLine(
    qaAudit,
    pattern,
    `- [${passed ? 'x' : ' '}] ${liveProviderUiQaChecklistLabel}`,
    'QA Audit release residual checklist',
    liveProviderUiQaChecklistLabel,
  )
}
