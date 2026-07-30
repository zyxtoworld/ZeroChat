import { afterEach, describe, expect, it, vi } from 'vitest'

const labels = {
  copy: 'Copy',
  copied: 'Copied',
  copyCode: 'Copy code',
  copyFailed: 'Copy failed',
  plainText: 'Plain text',
}

describe('Markdown worker client', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('contains direct Markdown worker termination failures', async () => {
    const { terminateMarkdownWorker } = await import('../markdownWorkerClient')
    const terminate = vi.fn(() => {
      throw new Error('terminate blocked')
    })
    const worker = {
      terminate,
    } as unknown as Worker

    expect(terminateMarkdownWorker(null)).toBe(true)
    expect(terminateMarkdownWorker(worker)).toBe(false)
    expect(terminate).toHaveBeenCalledTimes(1)
  })

  it('falls back when Markdown worker termination fails after worker errors', async () => {
    vi.useFakeTimers()
    let errorListener: (() => void) | undefined
    const terminate = vi.fn(() => {
      throw new Error('terminate blocked')
    })
    const postMessage = vi.fn()

    class FailingTerminateWorker {
      addEventListener(type: string, listener: () => void): void {
        if (type === 'error') {
          errorListener = listener
        }
      }

      postMessage(message: unknown): void {
        postMessage(message)
      }

      terminate(): void {
        terminate()
      }
    }

    vi.stubGlobal('Worker', FailingTerminateWorker)
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })

    const { renderMarkdown } = await import('../markdownWorkerClient')
    const render = renderMarkdown('worker failed <here>', labels)

    expect(() => errorListener?.()).not.toThrow()

    await expect(render).resolves.toBe('<p>worker failed &lt;here&gt;</p>')
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('falls back immediately when worker postMessage throws', async () => {
    vi.useFakeTimers()
    const postMessage = vi.fn()
    const terminate = vi.fn()
    let workerCount = 0

    class ThrowingWorker {
      private messageListener:
        | ((event: MessageEvent<{ id: number; html: string }>) => void)
        | undefined
      private readonly workerIndex = workerCount

      constructor() {
        workerCount += 1
      }

      addEventListener(type: string, listener: EventListener): void {
        if (type === 'message') {
          this.messageListener = listener as (
            event: MessageEvent<{ id: number; html: string }>,
          ) => void
        }
      }

      postMessage(message: { id: number }): void {
        postMessage(message)
        if (this.workerIndex === 0) {
          throw new Error('postMessage failed')
        }

        this.messageListener?.({
          data: { id: message.id, html: '<p>worker recovered</p>' },
        } as MessageEvent<{ id: number; html: string }>)
      }

      terminate(): void {
        terminate()
      }
    }

    vi.stubGlobal('Worker', ThrowingWorker)
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })

    const { renderMarkdown } = await import('../markdownWorkerClient')
    const html = await renderMarkdown('hello <world>', labels)
    const recovered = await renderMarkdown('hello again', labels)

    expect(postMessage).toHaveBeenCalledTimes(2)
    expect(html).toBe('<p>hello &lt;world&gt;</p>')
    expect(recovered).toBe('<p>worker recovered</p>')
    expect(workerCount).toBe(2)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('replaces a timed-out Markdown worker before the next render', async () => {
    vi.useFakeTimers()
    const terminate = vi.fn()
    let workerCount = 0

    class RecoveringWorker {
      private messageListener:
        | ((event: MessageEvent<{ id: number; html: string }>) => void)
        | undefined
      private readonly workerIndex = workerCount

      constructor() {
        workerCount += 1
      }

      addEventListener(type: string, listener: EventListener): void {
        if (type === 'message') {
          this.messageListener = listener as (
            event: MessageEvent<{ id: number; html: string }>,
          ) => void
        }
      }

      postMessage(message: { id: number }): void {
        if (this.workerIndex === 1) {
          this.messageListener?.({
            data: { id: message.id, html: '<p>worker recovered</p>' },
          } as MessageEvent<{ id: number; html: string }>)
        }
      }

      terminate(): void {
        terminate()
      }
    }

    vi.stubGlobal('Worker', RecoveringWorker)
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })

    const { renderMarkdown } = await import('../markdownWorkerClient')
    const timedOutRender = renderMarkdown('stalled <worker>', labels)
    const concurrentRender = renderMarkdown('also stalled', labels)

    await vi.advanceTimersByTimeAsync(8000)
    await expect(timedOutRender).resolves.toBe(
      '<p>stalled &lt;worker&gt;</p>',
    )
    await expect(concurrentRender).resolves.toBe('<p>also stalled</p>')
    await expect(renderMarkdown('recovered', labels)).resolves.toBe(
      '<p>worker recovered</p>',
    )

    expect(workerCount).toBe(2)
    expect(terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
