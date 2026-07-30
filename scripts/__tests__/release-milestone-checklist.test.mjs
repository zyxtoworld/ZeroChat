import { describe, expect, it } from 'vitest'

import { syncLiveProviderUiMilestoneChecklist } from '../release-milestone-checklist.mjs'

const checklistLabel = 'Live-provider Web UI browser-origin pass evidence'

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
    checklistLine,
    '',
    '---',
  ].join('\n')
}

describe('release milestone checklist synchronization', () => {
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
