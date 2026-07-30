import { afterEach, describe, expect, it, vi } from 'vitest'

const labels = {
  copy: 'Copy',
  copied: 'Copied',
  copyCode: 'Copy code',
  copyFailed: 'Copy failed',
  plainText: 'Plain text',
}

describe('Markdown worker', () => {
  afterEach(() => {
    vi.resetModules()
    Reflect.deleteProperty(globalThis, 'onmessage')
  })

  it('posts rendered Markdown responses once', async () => {
    const { handleMarkdownWorkerRequest } = await import('../markdown.worker')
    const postMessage = vi.fn()

    handleMarkdownWorkerRequest(
      {
        data: {
          content: '**ok**',
          id: 7,
          labels,
        },
      } as MessageEvent,
      postMessage,
    )

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith({
      id: 7,
      html: '<p><strong>ok</strong></p>\n',
    })
  })

  it('posts render failures as error responses', async () => {
    const { handleMarkdownWorkerRequest } = await import('../markdown.worker')
    const postMessage = vi.fn()

    handleMarkdownWorkerRequest(
      {
        data: {
          content: '```ts\nconst ok = true\n```',
          id: 8,
          labels: undefined,
        },
      } as unknown as MessageEvent,
      postMessage,
    )

    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 8,
        error: expect.any(String),
      }),
    )
  })

  it('throws a stable worker failure when response postMessage is unavailable', async () => {
    const { handleMarkdownWorkerRequest, postMarkdownWorkerResponse } = await import(
      '../markdown.worker'
    )
    const postMessage = vi.fn(() => {
      throw new Error('postMessage blocked')
    })

    expect(
      postMarkdownWorkerResponse(
        {
          html: '<p>ok</p>',
          id: 9,
        },
        postMessage,
      ),
    ).toBe(false)

    expect(() =>
      handleMarkdownWorkerRequest(
        {
          data: {
            content: '**ok**',
            id: 10,
            labels,
          },
        } as MessageEvent,
        postMessage,
      ),
    ).toThrow('Markdown worker response postMessage failed.')
  })
})
