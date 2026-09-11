import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LIVE_SYNC_CURRENT_PASS_ROW,
  LIVE_SYNC_OPEN_ROW,
  LIVE_SYNC_COMPLETION_MARKER,
  evaluateLiveSyncReleaseDocumentationState,
  assertLiveSyncReleaseDocumentationState,
} from '../live-sync-release-documentation-state.mjs'

const currentFingerprint = {
  kind: 'zerochat.liveSyncSourceFingerprint.v1',
  fileCount: 61,
  totalBytes: 984376,
  sha256: 'current-source',
}

const staleFingerprint = {
  ...currentFingerprint,
  totalBytes: 983176,
  sha256: 'stale-source',
}

function currentDiagnostic() {
  return {
    status: 'skipped',
    passed: false,
    releaseEvidence: false,
    sourceFingerprint: currentFingerprint,
  }
}

function currentReleasePass() {
  return {
    status: 'passed',
    passed: true,
    releaseEvidence: true,
    safeToPublish: true,
    evidenceType: 'release-pass',
    sourceFingerprint: currentFingerprint,
  }
}

function staleReleasePass() {
  return {
    ...currentReleasePass(),
    sourceFingerprint: staleFingerprint,
  }
}

function openBlocker() {
  return {
    id: 'disposable-live-sync-release-pass',
    status: 'skipped',
    blockerKind: 'missing-live-sync-release-inputs',
    releaseEvidence: false,
    evidence: {
      blockerKind: 'missing-live-sync-release-inputs',
      sourceFingerprint: {
        ...currentFingerprint,
        current: true,
      },
      currentDiagnosticReport: {
        path: '.manual-qa/live-sync-release-drill-current-diagnostic.json',
        status: 'skipped',
        releaseEvidence: false,
        sourceFingerprintCurrent: true,
      },
      releasePassReport: {
        path: '.manual-qa/live-sync-release-drill.json',
        present: true,
        status: 'passed',
        releaseEvidence: true,
        sourceFingerprintCurrent: false,
      },
    },
  }
}

function openSummary() {
  return {
    status: 'blocked',
    releaseEvidence: false,
    blockers: [openBlocker()],
  }
}

test('stale pass plus current missing-input diagnostic is an open blocker', () => {
  assert.deepEqual(
    evaluateLiveSyncReleaseDocumentationState({
      blockerReport: openSummary(),
      diagnosticReport: currentDiagnostic(),
      releasePassReport: staleReleasePass(),
    }),
    { kind: 'open-blocker', blockerKind: 'missing-live-sync-release-inputs' },
  )
})

test('current matching release pass is the only completed state', () => {
  assert.deepEqual(
    evaluateLiveSyncReleaseDocumentationState({
      blockerReport: { status: 'clear', releaseEvidence: true, blockers: [] },
      diagnosticReport: currentDiagnostic(),
      releasePassReport: currentReleasePass(),
    }),
    { kind: 'current-pass' },
  )
})

test('a stale pass with no blocker fails closed instead of becoming green', () => {
  assert.throws(
    () =>
      evaluateLiveSyncReleaseDocumentationState({
        blockerReport: { status: 'clear', releaseEvidence: true, blockers: [] },
        diagnosticReport: currentDiagnostic(),
        releasePassReport: staleReleasePass(),
      }),
    /inconsistent|current source/i,
  )
})

test('missing or malformed blocker evidence fails closed', () => {
  assert.throws(
    () =>
      evaluateLiveSyncReleaseDocumentationState({
        blockerReport: { status: 'blocked', releaseEvidence: false, blockers: [] },
        diagnosticReport: currentDiagnostic(),
        releasePassReport: staleReleasePass(),
      }),
    /inconsistent|blocker/i,
  )
})

test('documentation rows follow the machine state, not historical text elsewhere', () => {
  const currentOpenRow =
    '- [ ] 当前 release blocker `disposable-live-sync-release-pass`：status `skipped`，blockerKind `missing-live-sync-release-inputs`'
  const openDocs = {
    requirements: `${currentOpenRow}\n${LIVE_SYNC_OPEN_ROW}`,
    qaAudit: 'current diagnostic blockerKind `missing-live-sync-release-inputs`',
  }
  const openState = { kind: 'open-blocker', blockerKind: 'missing-live-sync-release-inputs' }
  assert.doesNotThrow(() =>
    assertLiveSyncReleaseDocumentationState(openState, openDocs),
  )

  const conflictingDocs = {
    requirements: `${currentOpenRow.replace('- [ ]', '- [x]')}\n${LIVE_SYNC_CURRENT_PASS_ROW}\n${LIVE_SYNC_OPEN_ROW}`,
    qaAudit: 'current diagnostic blockerKind `missing-live-sync-release-inputs`',
  }
  assert.throws(
    () => assertLiveSyncReleaseDocumentationState(openState, conflictingDocs),
    /open blocker/i,
  )

  const passDocs = {
    requirements: `${LIVE_SYNC_CURRENT_PASS_ROW}\n${LIVE_SYNC_COMPLETION_MARKER}`,
    qaAudit: LIVE_SYNC_COMPLETION_MARKER,
  }
  assert.doesNotThrow(() =>
    assertLiveSyncReleaseDocumentationState({ kind: 'current-pass' }, passDocs),
  )
})
