import { describe, expect, it, vi } from 'vitest'

import {
  liveProviderChatModelAttemptValidationFailures,
  liveProviderEmptyChatRetryDelaysMs,
  runWithLiveProviderEmptyChatRetry,
} from '../live-provider-empty-chat-retry.mjs'

describe('live provider successful-empty chat retry', () => {
  it('retries the same model after successful empty responses and records every attempt', async () => {
    const runAttempt = vi
      .fn()
      .mockResolvedValueOnce({
        emptySuccessfulResponse: true,
        model: 'gpt-test',
        ok: false,
        reason: 'unexpected reply:',
        status: 200,
      })
      .mockResolvedValueOnce({
        emptySuccessfulResponse: true,
        model: 'gpt-test',
        ok: false,
        reason: 'unexpected reply:',
        status: 200,
      })
      .mockResolvedValueOnce({
        model: 'gpt-test',
        ok: true,
        reply: 'ZeroChat OK',
        status: 200,
      })
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await runWithLiveProviderEmptyChatRetry({ runAttempt, sleep })

    expect(runAttempt).toHaveBeenCalledTimes(3)
    expect(runAttempt.mock.calls.map(([context]) => context)).toEqual([
      { attemptNumber: 1 },
      { attemptNumber: 2 },
      { attemptNumber: 3 },
    ])
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual([400, 900])
    expect(result).toMatchObject({
      model: 'gpt-test',
      ok: true,
      reply: 'ZeroChat OK',
      status: 200,
    })
    expect(result.attempts).toEqual([
      {
        attemptNumber: 1,
        delayMs: 400,
        outcome: 'successful-empty-response',
        retryScheduled: true,
        status: 200,
      },
      {
        attemptNumber: 2,
        delayMs: 900,
        outcome: 'successful-empty-response',
        retryScheduled: true,
        status: 200,
      },
      {
        attemptNumber: 3,
        outcome: 'passed',
        retryScheduled: false,
        status: 200,
      },
    ])
  })

  it('stops after four successful empty responses', async () => {
    const runAttempt = vi.fn().mockResolvedValue({
      emptySuccessfulResponse: true,
      model: 'gpt-test',
      ok: false,
      reason: 'unexpected reply:',
      status: 200,
    })
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await runWithLiveProviderEmptyChatRetry({ runAttempt, sleep })

    expect(runAttempt).toHaveBeenCalledTimes(4)
    expect(sleep.mock.calls.map(([delayMs]) => delayMs)).toEqual(
      liveProviderEmptyChatRetryDelaysMs,
    )
    expect(result.ok).toBe(false)
    expect(result.attempts).toHaveLength(4)
    expect(result.attempts.at(-1)).toEqual({
      attemptNumber: 4,
      outcome: 'successful-empty-response',
      retryScheduled: false,
      status: 200,
    })
  })

  it.each([
    ['HTTP failure', { ok: false, reason: 'unavailable', status: 503 }],
    ['transport failure', { ok: false, reason: 'fetch failed' }],
    [
      'nonempty wrong reply',
      { ok: false, reason: 'unexpected reply: hello', status: 200 },
    ],
  ])('does not retry a %s', async (_label, attemptResult) => {
    const runAttempt = vi.fn().mockResolvedValue({
      model: 'gpt-test',
      ...attemptResult,
    })
    const sleep = vi.fn().mockResolvedValue(undefined)

    const result = await runWithLiveProviderEmptyChatRetry({ runAttempt, sleep })

    expect(runAttempt).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(result.attempts).toEqual([
      {
        attemptNumber: 1,
        outcome: 'failed',
        retryScheduled: false,
        ...('status' in attemptResult ? { status: attemptResult.status } : {}),
      },
    ])
  })

  it('validates the bounded publishable model-attempt evidence shape', () => {
    const valid = [
      {
        model: 'gpt-test',
        attempts: [
          {
            attemptNumber: 1,
            delayMs: 400,
            outcome: 'successful-empty-response',
            retryScheduled: true,
            status: 200,
          },
          {
            attemptNumber: 2,
            outcome: 'passed',
            retryScheduled: false,
            status: 200,
          },
        ],
      },
    ]

    expect(
      liveProviderChatModelAttemptValidationFailures(valid, {
        attemptedChatModels: ['gpt-test'],
        requirePassedFinal: true,
      }),
    ).toEqual([])
    expect(
      liveProviderChatModelAttemptValidationFailures(
        [
          {
            model: 'gpt-test',
            attempts: [
              {
                attemptNumber: 1,
                outcome: 'successful-empty-response',
                payload: 'must never enter evidence',
                retryScheduled: false,
                status: 200,
              },
            ],
          },
        ],
        { attemptedChatModels: ['different-model'], requirePassedFinal: true },
      ),
    ).toEqual([
      '[0].attempts[0] contains an unsafe or unknown field.',
      '[0] successful empty responses may stop only after four attempts.',
      'model order must match attemptedChatModels.',
      'the final model attempt must pass.',
    ])
  })
})
