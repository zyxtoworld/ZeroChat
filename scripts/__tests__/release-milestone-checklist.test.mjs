import { describe, expect, it } from 'vitest'

import {
  syncLiveProviderUiQaResidualChecklist,
  syncLiveProviderUiMilestoneChecklist,
  syncLiveSyncQaResidualChecklist,
  syncLiveSyncRequirementsMilestoneChecklist,
} from '../release-milestone-checklist.mjs'

const checklistLabel = 'Live-provider Web UI browser-origin pass evidence'
const liveSyncChecklistLabel = 'Disposable live sync release-pass'

function requirementsFixture(checklistLine = `- [ ] ${checklistLabel}: run the drill.`) {
  return [
    '# Requirements',
    '',
    '### Release 阻塞残项',
    '- [ ] generated overlay item',
    '',
    '---',
    '',
    '### Phase 4 - Ship',
    '- [x] implementation complete',
    '',
    '### Release 阻塞残项',
    '- [ ] Apple target runtime QA',
    `- [x] ${liveSyncChecklistLabel}：当前 source-current Gist drill 已通过。`,
    checklistLine,
    '',
    '---',
  ].join('\n')
}

describe('release milestone checklist synchronization', () => {
  it('reopens stale live-sync evidence in Requirements and QA residual checklists', () => {
    const requirements = syncLiveSyncRequirementsMilestoneChecklist(
      requirementsFixture(),
      false,
    )
    const qaAudit = syncLiveSyncQaResidualChecklist(
      `### Release 阻塞残项\n\n- [x] ${liveSyncChecklistLabel}\n`,
      false,
    )

    expect(requirements).toContain(`- [ ] ${liveSyncChecklistLabel}：`)
    expect(requirements).toContain('canonical Gist pass 的 source fingerprint 已过期')
    expect(qaAudit).toContain(`- [ ] ${liveSyncChecklistLabel}`)
  })

  it('marks current live-sync release evidence complete idempotently', () => {
    const requirements = syncLiveSyncRequirementsMilestoneChecklist(
      requirementsFixture().replace(
        `- [x] ${liveSyncChecklistLabel}：当前 source-current Gist drill 已通过。`,
        `- [ ] ${liveSyncChecklistLabel}：旧证据。`,
      ),
      true,
    )
    const qaAudit = syncLiveSyncQaResidualChecklist(
      `### Release 阻塞残项\n\n- [ ] ${liveSyncChecklistLabel}\n`,
      true,
    )

    expect(requirements).toContain(`- [x] ${liveSyncChecklistLabel}：`)
    expect(requirements).toContain('当前 source-current Gist drill 已通过')
    expect(syncLiveSyncRequirementsMilestoneChecklist(requirements, true)).toBe(requirements)
    expect(qaAudit).toContain(`- [x] ${liveSyncChecklistLabel}`)
    expect(syncLiveSyncQaResidualChecklist(qaAudit, true)).toBe(qaAudit)
  })

  it('marks current-source browser-origin evidence complete only in the milestone section', () => {
    const result = syncLiveProviderUiMilestoneChecklist(requirementsFixture(), true)

    expect(result).toContain(`- [x] ${checklistLabel}: run the drill.`)
    expect(result).toContain('- [ ] generated overlay item')
    expect(syncLiveProviderUiMilestoneChecklist(result, true)).toBe(result)
  })

  it('reopens the milestone item when current-source evidence is not passed', () => {
    const result = syncLiveProviderUiMilestoneChecklist(
      requirementsFixture(`- [x] ${checklistLabel}: previously passed.`),
      false,
    )

    expect(result).toContain(`- [ ] ${checklistLabel}: previously passed.`)
  })

  it('synchronizes the QA residual item for current-source browser-origin evidence', () => {
    const qaAudit = syncLiveProviderUiQaResidualChecklist(
      `### Release 阻塞残项\n\n- [ ] ${
        'Live-provider Web UI browser-origin release evidence'
      }\n`,
      true,
    )

    expect(qaAudit).toContain(
      '- [x] Live-provider Web UI browser-origin release evidence',
    )
    expect(syncLiveProviderUiQaResidualChecklist(qaAudit, true)).toBe(qaAudit)
  })

  it('fails closed when the milestone section is missing or ambiguous', () => {
    expect(() => syncLiveProviderUiMilestoneChecklist('# Requirements', true)).toThrow(
      'Unable to locate the REQUIREMENTS Phase 4 milestone section.',
    )
    expect(() =>
      syncLiveProviderUiMilestoneChecklist(
        requirementsFixture(
          `- [ ] ${checklistLabel}\n- [ ] ${checklistLabel}: duplicate.`,
        ),
        true,
      ),
    ).toThrow('must contain exactly one')
  })
})
