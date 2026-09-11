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

  it('settles a synchronously fired timeout before posting or leaking a pending request', async () => {
    vi.useFakeTimers()
    const postMessage = vi.fn()
    const terminate = vi.fn()
    let workerCount = 0

    class SynchronouslyTimedOutWorker {
      constructor() {
        workerCount += 1
      }

      addEventListener(): void {}

      postMessage(message: unknown): void {
        postMessage(message)
      }

      terminate(): void {
        terminate()
      }
    }

    vi.stubGlobal('Worker', SynchronouslyTimedOutWorker)
    vi.stubGlobal('window', {
      clearTimeout: vi.fn(),
      setTimeout: vi.fn((handler: () => void) => {
        handler()
        return 1
      }),
    })

    const { renderMarkdown } = await import('../markdownWorkerClient')
    let output: string | undefined
    const pending = renderMarkdown('sync timeout <worker>', labels).then((value) => {
      output = value
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(output).toBe('<p>sync timeout &lt;worker&gt;</p>')
    expect(postMessage).not.toHaveBeenCalled()
    expect(terminate).toHaveBeenCalledOnce()
    expect(workerCount).toBe(1)
    await pending
  })

  it('recreates the worker after synchronous timeout installation fails', async () => {
    vi.useFakeTimers()
    const terminate = vi.fn()
    const activeTimers = new Map<number, () => void>()
    let nextTimer = 1
    let workerCount = 0

    class RetryAfterTimerFailureWorker {
      private readonly workerIndex: number
      private messageListener:
        | ((event: MessageEvent<{ id: number; html: string }>) => void)
        | undefined

      constructor() {
        this.workerIndex = workerCount
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

    let failTimerSetup = true
    vi.stubGlobal('Worker', RetryAfterTimerFailureWorker)
    vi.stubGlobal('window', {
      clearTimeout: vi.fn((handle: number) => {
        activeTimers.delete(handle)
      }),
      setTimeout: vi.fn((handler: () => void) => {
        if (failTimerSetup) {
          failTimerSetup = false
          throw new Error('timer setup failed')
        }

        const handle = nextTimer
        nextTimer += 1
        activeTimers.set(handle, handler)
        return handle
      }),
    })

    const { renderMarkdown } = await import('../markdownWorkerClient')
    await expect(renderMarkdown('timer setup failed', labels)).resolves.toBe(
      '<p>timer setup failed</p>',
    )

    const recovered = renderMarkdown('retry after timer failure', labels)
    await Promise.resolve()
    await Promise.resolve()
    for (const handler of activeTimers.values()) {
      handler()
    }

    await expect(recovered).resolves.toBe('<p>worker recovered</p>')
    expect(workerCount).toBe(2)
    expect(terminate).toHaveBeenCalledOnce()
    expect(activeTimers.size).toBe(0)
  })

  it('terminates a worker whose listener setup fails before retrying with a new worker', async () => {
    vi.useFakeTimers()
    let workerCount = 0
    const terminate = vi.fn()

    class ListenerSetupWorker {
      private messageListener:
        | ((event: MessageEvent<{ id: number; html: string }>) => void)
        | undefined
      private readonly workerIndex = workerCount

      constructor() {
        workerCount += 1
      }

      addEventListener(type: string, listener: EventListener): void {
        if (this.workerIndex === 0 && type === 'message') {
          throw new Error('worker listener setup failed')
        }
        if (type === 'message') {
          this.messageListener = listener as (
            event: MessageEvent<{ id: number; html: string }>,
          ) => void
        }
      }

      postMessage(message: { id: number }): void {
        this.messageListener?.({
          data: { id: message.id, html: '<p>worker recovered</p>' },
        } as MessageEvent<{ id: number; html: string }>)
      }

      terminate(): void {
        terminate()
      }
    }

    vi.stubGlobal('Worker', ListenerSetupWorker)
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })

    const { renderMarkdown } = await import('../markdownWorkerClient')

    await expect(renderMarkdown('first <worker>', labels)).resolves.toBe(
      '<p>first &lt;worker&gt;</p>',
    )
    await expect(renderMarkdown('second <worker>', labels)).resolves.toBe(
      '<p>worker recovered</p>',
    )

    expect(workerCount).toBe(2)
    expect(terminate).toHaveBeenCalledOnce()
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

  it('ignores a late failure from a worker that has already been replaced', async () => {
    vi.useFakeTimers()
    const workers: Array<{
      emitError: () => void
      emitMessage: (html: string) => void
      terminate: () => void
    }> = []

    class OwnedWorker {
      private errorListener: (() => void) | undefined
      private messageListener:
        | ((event: MessageEvent<{ id: number; html: string }>) => void)
        | undefined
      private requestId = 0
      readonly terminate = vi.fn()

      constructor() {
        workers.push({
          emitError: () => this.errorListener?.(),
          emitMessage: (html) =>
            this.messageListener?.({
              data: { id: this.requestId, html },
            } as MessageEvent<{ id: number; html: string }>),
          terminate: this.terminate,
        })
      }

      addEventListener(type: string, listener: EventListener): void {
        if (type === 'message') {
          this.messageListener = listener as (
            event: MessageEvent<{ id: number; html: string }>,
          ) => void
        } else if (type === 'error') {
          this.errorListener = listener as () => void
        }
      }

      postMessage(message: { id: number }): void {
        this.requestId = message.id
      }
    }

    vi.stubGlobal('Worker', OwnedWorker)
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })

    const { renderMarkdown } = await import('../markdownWorkerClient')
    const first = renderMarkdown('first <worker>', labels)
    await vi.advanceTimersByTimeAsync(8000)
    await expect(first).resolves.toBe('<p>first &lt;worker&gt;</p>')

    const second = renderMarkdown('second <worker>', labels)
    expect(workers).toHaveLength(2)
    workers[0].emitError()
    workers[1].emitMessage('<p>second worker</p>')

    await expect(second).resolves.toBe('<p>second worker</p>')
    expect(workers[0].terminate).toHaveBeenCalledOnce()
    expect(workers[1].terminate).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('ignores late events from a failed worker while a replacement request is pending', async () => {
    vi.useFakeTimers()
    type WorkerRecord = {
      errorListener?: () => void
      messageListener?: (event: MessageEvent<{ id: number; html: string }>) => void
      requestId?: number
      terminateCount: number
    }
    const workers: WorkerRecord[] = []

    class ReplacingWorker {
      private readonly record: WorkerRecord

      constructor() {
        this.record = { terminateCount: 0 }
        workers.push(this.record)
      }

      addEventListener(type: string, listener: EventListener): void {
        if (type === 'message') {
          this.record.messageListener = listener as (
            event: MessageEvent<{ id: number; html: string }>,
          ) => void
        } else if (type === 'error') {
          this.record.errorListener = listener as () => void
        }
      }

      postMessage(message: { id: number }): void {
        this.record.requestId = message.id
      }

      terminate(): void {
        this.record.terminateCount += 1
      }
    }

    vi.stubGlobal('Worker', ReplacingWorker)
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })

    const { renderMarkdown } = await import('../markdownWorkerClient')
    const first = renderMarkdown('first <worker>', labels)
    expect(workers).toHaveLength(1)
    const firstId = workers[0]?.requestId
    expect(firstId).toEqual(expect.any(Number))

    workers[0]?.errorListener?.()
    const second = renderMarkdown('second <worker>', labels)
    expect(workers).toHaveLength(2)
    const secondId = workers[1]?.requestId
    expect(secondId).toEqual(expect.any(Number))
    let secondSettled = false
    void second.then(() => {
      secondSettled = true
    })

    workers[0]?.messageListener?.({
      data: { id: firstId as number, html: '<p>stale first worker</p>' },
    } as MessageEvent<{ id: number; html: string }>)
    workers[0]?.errorListener?.()
    await Promise.resolve()
    expect(secondSettled).toBe(false)

    workers[1]?.messageListener?.({
      data: { id: secondId as number, html: '<p>second worker</p>' },
    } as MessageEvent<{ id: number; html: string }>)

    await expect(first).resolves.toBe('<p>first &lt;worker&gt;</p>')
    await expect(second).resolves.toBe('<p>second worker</p>')
    expect(workers[0]?.terminateCount).toBe(1)
    expect(workers[1]?.terminateCount).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
