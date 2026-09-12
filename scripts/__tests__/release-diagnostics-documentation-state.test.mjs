import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const releaseBlockersReportFixture = {
  blockers: [
    { id: 'disposable-live-sync-release-pass' },
    { id: 'live-provider-web-ui-browser-origin-release-evidence' },
  ],
}

const windowsHostPreflightReportFixture = { status: 'blocked' }

function normalizeMarkdownText(source) {
  return source.replace(/\s+/gu, ' ').trim()
}

function sectionBetween(source, startPattern, endPattern) {
  const start = source.search(startPattern)
  expect(start, `Missing section start ${startPattern}`).toBeGreaterThanOrEqual(0)
  const tail = source.slice(start)
  const end = tail.search(endPattern)
  return end >= 0 ? tail.slice(0, end) : tail
}

describe('release diagnostics documentation state', () => {
  it('keeps stable guidance report-driven and active QA aligned with fixture blockers', async () => {
    const [
      readme,
      releaseChecklist,
      requirements,
      windowsReadme,
      nativeQaChecklist,
      qaAudit,
      completionAudit,
      repositoryHealth,
    ] = await Promise.all([
      readFile(new URL('../../README.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/RELEASE_CHECKLIST.md', import.meta.url), 'utf8'),
      readFile(new URL('../../docs/REQUIREMENTS.md', import.meta.url), 'utf8'),
      readFile(new URL('../../apps/windows/README.md', import.meta.url), 'utf8'),
      readFile(
        new URL('../../docs/NATIVE_QA_CHECKLIST.md', import.meta.url),
        'utf8',
      ),
      readFile(new URL('../../docs/QA_AUDIT.md', import.meta.url), 'utf8'),
      readFile(new URL('../completion-audit-check.mjs', import.meta.url), 'utf8'),
      readFile(new URL('../repository-health-check.mjs', import.meta.url), 'utf8'),
    ])
    const normalizedReadme = normalizeMarkdownText(readme)
    const normalizedReleaseChecklist = normalizeMarkdownText(releaseChecklist)
    const normalizedNativeQaChecklist = normalizeMarkdownText(nativeQaChecklist)
    const activeQaAudit = sectionBetween(
      qaAudit,
      /^## Open Gaps$/mu,
      /^### 2026-06-08/mu,
    )
    const releaseBlockersCurrent = releaseBlockersReportFixture
    const windowsHostPreflight = windowsHostPreflightReportFixture
    const liveSyncBlocked = releaseBlockersCurrent.blockers.some(
      (blocker) => blocker.id === 'disposable-live-sync-release-pass',
    )
    const liveProviderUiBlocked = releaseBlockersCurrent.blockers.some(
      (blocker) =>
        blocker.id === 'live-provider-web-ui-browser-origin-release-evidence',
    )

    expect(readme).toContain(
      'exact audited blocker set derived\nfrom current reports',
    )
    expect(releaseChecklist).toContain(
      'exact audited\nblocker set derived from current reports',
    )
    expect(readme).toContain('Current host status is report-derived, never')
    expect(readme).not.toContain(
      'The current host preflight is clear, but this\nPowerShell is not elevated',
    )
    expect(normalizedReadme).toContain(
      'Read the active host state from `.manual-qa\\windows-msix-host-preflight.json`',
    )
    expect(releaseChecklist).toContain(
      'Current host status is report-derived, never hard-coded in',
    )
    expect(requirements).not.toContain(
      'Windows trusted MSIX install/update/uninstall 当前 runtime QA：当前 host preflight 已 clear',
    )
    expect(requirements).toContain(
      'Windows trusted MSIX install/update/uninstall 当前 runtime QA：当前 host 状态以 `.manual-qa/windows-msix-host-preflight.json` 为准',
    )
    expect(qaAudit).not.toContain(
      'The current host preflight is clear but the current shell is not elevated, so release-pass evidence still needs an elevated disposable Windows rerun.',
    )
    expect(qaAudit).toContain(
      'The active host path is report-derived from `.manual-qa/windows-msix-host-preflight.json`',
    )
    expect(requirements).toContain(
      'Windows trusted MSIX current blocker semantics:',
    )
    expect(normalizedReadme).toContain('sanitized blocker summary')
    expect(readme).not.toContain('six-blocker summary')
    expect(readme).not.toMatch(
      /still fails only on the expected Windows trusted\s+MSIX host AppX cleanup blocker/u,
    )
    expect(releaseChecklist).not.toMatch(
      /remaining broad runtime-artifact failure is the current trusted\s+MSIX host AppX cleanup blocker/u,
    )
    expect(normalizedReleaseChecklist).toContain(
      'cannot close native runtime, trusted MSIX, hosted CI, live-provider full-capability, or browser-origin UI release blockers',
    )
    expect(releaseChecklist).toContain(
      'validated live-sync release-pass report',
    )
    expect(normalizedReleaseChecklist).not.toContain(
      'close native runtime, trusted MSIX, disposable live-sync, hosted CI, or live-provider full-capability release blockers',
    )
    expect(normalizedReleaseChecklist).not.toContain(
      'native runtime, live sync release-pass, hosted native CI, and live-provider full-capability evidence checks that remain before final release',
    )
    expect(normalizedNativeQaChecklist).toContain(
      "current blocker map derives disposable live sync from the canonical report's source fingerprint",
    )
    expect(normalizedNativeQaChecklist).not.toContain(
      'disposable live sync, hosted native CI, and live-provider full-capability evidence checks that must still pass before final release',
    )
    if (liveSyncBlocked) {
      expect(activeQaAudit).toContain(
        'Disposable Cloudflare/Gist live-sync release-pass and hosted native CI remain open.',
      )
      expect(activeQaAudit).not.toContain(
        'is passed current-source release evidence',
      )
    } else {
      expect(activeQaAudit).toContain('Live sync canonical release pass')
      expect(activeQaAudit).not.toContain(
        'Disposable Cloudflare/Gist live-sync release-pass and hosted native CI remain open.',
      )
    }
    if (liveProviderUiBlocked) {
      expect(activeQaAudit).toContain(
        'Live-provider Web UI browser-origin release evidence remains open',
      )
      expect(activeQaAudit).not.toContain(
        'Live-provider Web UI browser-origin release evidence is passed and is no longer a blocker',
      )
    } else {
      expect(activeQaAudit).toContain(
        'Live-provider Web UI browser-origin release evidence is passed and is no longer a blocker',
      )
      expect(activeQaAudit).toContain(
        'Live provider UI required remediation: none; current-source browser-origin release evidence is already passed.',
      )
      expect(activeQaAudit).not.toContain(
        'Live-provider Web UI browser-origin release evidence remains open',
      )
    }
    expect(activeQaAudit).toContain(
      'The historical trusted-MSIX AppX failure is stale-dist diagnostic context',
    )
    expect(activeQaAudit).not.toContain(
      'Disposable live sync and browser-origin Provider UI evidence are already passed in the current handoff',
    )
    expect(activeQaAudit).not.toContain(
      'remains the current host AppXDeploymentServer',
    )
    for (const activeDoc of [windowsReadme, nativeQaChecklist]) {
      expect(activeDoc).toContain('historical diagnostic')
      expect(activeDoc).toContain(
        'Current host status is report-derived, never hard-coded',
      )
      expect(activeDoc).not.toContain('The current known host blocker is')
      expect(activeDoc).not.toContain('The current known blocker is')
      expect(activeDoc).not.toContain(
        'current trusted MSIX install/update/uninstall release-pass remains blocked by the host AppX cleanup diagnostic',
      )
    }
    expect(activeQaAudit).toContain('historical diagnostic')
    if (windowsHostPreflight.status === 'blocked') {
      expect(activeQaAudit).toContain(
        'blocked by Windows AppXDeploymentServer cleanup access-denied state',
      )
    } else {
      expect(activeQaAudit).toContain(
        'The current host preflight is clear but the current shell is not elevated',
      )
    }
    expect(completionAudit).toContain(
      'historical trusted MSIX diagnostic evidence',
    )
    expect(completionAudit).toContain(
      'Windows README must keep current host status report-derived.',
    )
    expect(completionAudit).not.toContain(
      'Windows README must name the current known host AppX cleanup blocker.',
    )
    expect(completionAudit).not.toContain(
      'Native QA checklist must name the current trusted MSIX host AppX cleanup blocker.',
    )
    expect(completionAudit).not.toContain(
      'while the host AppX blocker is current',
    )
    for (const document of [requirements, qaAudit]) {
      expect(document).toContain(
        'QA marker: Current verify-release metadata is validated from the checkpoint report, never a hard-coded digest.',
      )
    }
    expect(completionAudit).not.toMatch(
      /requirementsDoc,\s*'[A-F0-9]{64}',\s*'Requirements must preserve the current 53-step expected-failure checkpoint hash\.'/u,
    )
    expect(repositoryHealth).toContain(
      'const verifyReleaseCheckpointReport = await (async () => {',
    )
    expect(repositoryHealth).toContain(
      'await assertVerifyReleaseCheckpointInputBinding({',
    )
    expect(repositoryHealth).toContain(
      'binding: report.inputBinding,',
    )
    expect(repositoryHealth).toContain(
      "currentVerifyReleaseCheckpointLabel",
    )
    expect(repositoryHealth).not.toMatch(
      /requirementsDoc,\s*'[A-F0-9]{64}',\s*'Requirements must preserve the current checkpoint hash\.'/u,
    )
  })
})
