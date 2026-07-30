import { describe, expect, it } from 'vitest'

import {
  assertLocalProxyDiagnosticSafe,
  localProxyDiagnosticValidationFailures,
  normalizeLocalProxyDiagnosticBaseUrl,
  parseLocalProxyDiagnosticCliArgs,
  runLocalProxyDiagnostic,
  safeLocalProxyDiagnosticReportPath,
  selectLocalProxyDiagnosticModel,
} from '../live-provider-ui-local-proxy-diagnostic.mjs'

const fakeApiKey = ['sk', 'local-proxy-diagnostic-test-key-abcdefghijklmnopqrstuvwxyz'].join('-')
const sourceFingerprint = async () => ({
  kind: 'zerochat.testSourceFingerprint.v1',
  fileCount: 1,
  totalBytes: 1,
  sha256: 'A'.repeat(64),
})

function validPassedReport() {
  return {
    kind: 'zerochat.liveProviderUiLocalProxyDiagnostic.v1',
    version: 1,
    generatedAt: '2026-07-24T00:00:00.000Z',
    status: 'passed',
    passed: true,
    releaseEvidence: false,
    evidenceType: 'loopback-worker-contract-diagnostic',
    safeToPublish: true,
    browserUiExecuted: false,
    browserOriginProven: false,
    workerHostedProviderKeyConfigured: true,
    providerKeyBrowserExposed: false,
    requestCredentialsAbsent: true,
    modelList: { status: 200, modelCount: 1 },
    chat: { status: 200, selectedModel: 'gpt-5-5', markerCaptured: true },
    harnessCleanup: {
      harnessStarted: true,
      harnessCloseAttempted: true,
      harnessClosed: true,
      harnessCloseFailed: false,
    },
    requestLog: [
      { method: 'GET', path: '/proxy', action: 'models', status: 200 },
      { method: 'POST', path: '/proxy', action: 'chat', status: 200 },
    ],
    sourceFingerprint: {
      kind: 'zerochat.testSourceFingerprint.v1',
      fileCount: 1,
      totalBytes: 1,
      sha256: 'A'.repeat(64),
    },
    nextSteps: {
      releaseEvidence: ['Run pnpm run drill:live-provider-ui after deployment.'],
    },
  }
}

describe('live-provider local proxy diagnostic', () => {
  it('parses only one explicit no-I/O command mode', () => {
    expect(parseLocalProxyDiagnosticCliArgs(['--help'])).toEqual({ kind: 'help' })
    expect(parseLocalProxyDiagnosticCliArgs(['--validate-inputs-only'])).toEqual({
      kind: 'run',
      validateInputsOnly: true,
    })
    expect(parseLocalProxyDiagnosticCliArgs(['--help', '--validate-inputs-only'])).toMatchObject({
      kind: 'error',
    })
    expect(parseLocalProxyDiagnosticCliArgs(['--unknown=secret'])).toMatchObject({
      kind: 'error',
    })
  })

  it('normalizes safe provider roots while rejecting local or unsafe endpoints', () => {
    expect(
      normalizeLocalProxyDiagnosticBaseUrl('https://provider.example/v1/chat/completions///'),
    ).toBe('https://provider.example/v1')
    expect(() => normalizeLocalProxyDiagnosticBaseUrl('http://provider.example/v1')).toThrow(
      'must use HTTPS',
    )
    expect(() => normalizeLocalProxyDiagnosticBaseUrl('https://127.0.0.1/v1')).toThrow(
      'not a local network host',
    )
    expect(() => normalizeLocalProxyDiagnosticBaseUrl('https://provider.example/v1?token=x')).toThrow(
      'must not include credentials, query, or hash',
    )
  })

  it('keeps diagnostic reports inside .manual-qa with a dedicated name', () => {
    expect(
      safeLocalProxyDiagnosticReportPath(
        '.manual-qa/live-provider-ui-local-proxy-diagnostic-test.json',
      ),
    ).toMatch(/live-provider-ui-local-proxy-diagnostic-test\.json$/u)
    expect(() => safeLocalProxyDiagnosticReportPath('../report.json')).toThrow(
      'must stay under .manual-qa',
    )
    expect(() => safeLocalProxyDiagnosticReportPath('.manual-qa/provider.json')).toThrow(
      'must be named live-provider-ui-local-proxy-diagnostic',
    )
  })

  it('rejects stale or release-promoted local diagnostics before blocker handoff', () => {
    const report = validPassedReport()

    expect(
      localProxyDiagnosticValidationFailures(report, {
        expectedSourceFingerprint: report.sourceFingerprint,
      }),
    ).toEqual([])
    expect(
      localProxyDiagnosticValidationFailures(
        { ...report, releaseEvidence: true },
        { expectedSourceFingerprint: report.sourceFingerprint },
      ),
    ).toContain('report must remain releaseEvidence=false.')
    expect(
      localProxyDiagnosticValidationFailures(
        { ...report, browserOriginProven: true },
        { expectedSourceFingerprint: report.sourceFingerprint },
      ),
    ).toContain('report must remain browserOriginProven=false.')
    expect(
      localProxyDiagnosticValidationFailures(
        { ...report, requestCredentialsAbsent: false },
        { expectedSourceFingerprint: report.sourceFingerprint },
      ),
    ).toContain('passed report must prove client request credentials are absent.')
    expect(
      localProxyDiagnosticValidationFailures(report, {
        expectedSourceFingerprint: {
          ...report.sourceFingerprint,
          sha256: 'B'.repeat(64),
        },
      }),
    ).toContain(
      'report sourceFingerprint must match the current local proxy diagnostic source tree.',
    )
  })

  it('uses Worker-hosted credentials while sending no provider credential to the proxy', async () => {
    const requests = []
    const worker = {
      async fetch(request, environment) {
        const action = request.headers.get('x-zerochat-proxy-action')
        const payload = action === 'chat' ? await request.json() : null
        requests.push({
          action,
          authorization: request.headers.get('authorization'),
          apiKey: request.headers.get('x-api-key'),
          hostedKey: JSON.parse(environment.PROVIDER_KEYS)['provider.example'],
          stream: payload?.stream,
        })

        if (action === 'models') {
          return Response.json({ data: [{ id: 'gpt-5-5' }] })
        }

        const marker = String(payload.messages?.[0]?.content || '')
          .match(/ZC_LOOPBACK_PROXY_[A-Z0-9]+/u)?.[0]
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: marker } }] })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        )
      },
    }
    const report = await runLocalProxyDiagnostic({
      baseUrl: 'https://provider.example/v1',
      apiKey: fakeApiKey,
      worker,
      sourceFingerprint,
      randomBytesImpl: () => Buffer.alloc(32, 7),
    })

    expect(report).toMatchObject({
      status: 'passed',
      releaseEvidence: false,
      browserUiExecuted: false,
      browserOriginProven: false,
      providerKeyBrowserExposed: false,
      requestCredentialsAbsent: true,
      modelList: { status: 200, modelCount: 1 },
      chat: { status: 200, selectedModel: 'gpt-5-5', markerCaptured: true },
    })
    expect(report.requestLog).toHaveLength(2)
    expect(report.requestLog.map((record) => record.action)).toEqual(['models', 'chat'])
    expect(requests).toHaveLength(2)
    expect(requests.every((request) => request.authorization === null && request.apiKey === null)).toBe(true)
    expect(requests.every((request) => request.hostedKey === fakeApiKey)).toBe(true)
    expect(requests[1].stream).toBe(true)

    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(fakeApiKey)
    expect(serialized).not.toContain('provider.example')
    expect(serialized).not.toContain('https://')
    expect(() => assertLocalProxyDiagnosticSafe(report, [fakeApiKey])).not.toThrow()
  })

  it('keeps failed upstream responses diagnostic-only and without response bodies', async () => {
    const worker = {
      async fetch() {
        return new Response(`upstream failure: Bearer ${fakeApiKey}`, { status: 502 })
      },
    }
    const report = await runLocalProxyDiagnostic({
      baseUrl: 'https://provider.example/v1',
      apiKey: fakeApiKey,
      worker,
      sourceFingerprint,
    })

    expect(report).toMatchObject({
      status: 'failed',
      releaseEvidence: false,
      browserOriginProven: false,
      failureKind: 'model-list-request-failed',
      modelList: { status: 502 },
    })
    expect(JSON.stringify(report)).not.toContain(fakeApiKey)
    expect(JSON.stringify(report)).not.toContain('upstream failure')
  })

  it('fails closed when a started proxy harness cannot close', async () => {
    const report = await runLocalProxyDiagnostic({
      baseUrl: 'https://provider.example/v1',
      apiKey: fakeApiKey,
      sourceFingerprint,
      startHarness: async () => ({
        url: 'http://127.0.0.1:39123',
        close: async () => {
          throw new Error(`fixture close failure: ${fakeApiKey}`)
        },
      }),
      fetchImpl: async (_url, init) => {
        const action = init.headers['x-zerochat-proxy-action']
        if (action === 'models') {
          return Response.json({ data: [{ id: 'gpt-5-5' }] })
        }

        const payload = JSON.parse(String(init.body || '{}'))
        const marker = String(payload.messages?.[0]?.content || '')
          .match(/ZC_LOOPBACK_PROXY_[A-Z0-9]+/u)?.[0]
        return new Response(
          `data: ${JSON.stringify({ choices: [{ delta: { content: marker } }] })}\n\ndata: [DONE]\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        )
      },
    })

    expect(report).toMatchObject({
      status: 'failed',
      passed: false,
      failureKind: 'proxy-harness-cleanup-failed',
      harnessCleanup: {
        harnessStarted: true,
        harnessCloseAttempted: true,
        harnessClosed: false,
        harnessCloseFailed: true,
      },
    })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(fakeApiKey)
    expect(serialized).not.toContain('fixture close failure')
  })

  it('chooses a requested listed model or the preferred chat fallback', () => {
    expect(selectLocalProxyDiagnosticModel(['other', 'gpt-5-5'], '')).toBe('gpt-5-5')
    expect(selectLocalProxyDiagnosticModel(['gpt-4o-mini'], 'gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(selectLocalProxyDiagnosticModel(['gpt-4o-mini'], 'gpt-5-5')).toBe('')
  })
})
