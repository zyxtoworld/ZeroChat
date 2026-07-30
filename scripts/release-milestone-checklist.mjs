const releaseBlockersHeading = '### Release 阻塞残项'
const liveProviderUiChecklistLabel =
  'Live-provider Web UI browser-origin pass evidence'

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

