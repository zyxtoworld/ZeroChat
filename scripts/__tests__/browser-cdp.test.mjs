import { EventEmitter } from 'node:events'

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CONNECT_TIMEOUT_MS,
  connectCdp,
  findMainFrameLoadCompletionEvent,
  waitForChrome,
} from '../browser-cdp.mjs'

class FakeWebSocket {
  constructor({ open = true, onSend } = {}) {
    this.listeners = new Map()
    this.onSend = onSend
    this.closed = false

    if (open) {
      queueMicrotask(() => this.emit('open'))
    }
  }

  addEventListener(type, listener) {
    const typeListeners = this.listeners.get(type) ?? new Set()
    typeListeners.add(listener)
    this.listeners.set(type, typeListeners)
  }

  emit(type, payload) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(type === 'message' ? { data: payload } : {})
    }
  }

  emitMessage(message) {
    this.emit('message', JSON.stringify(message))
  }

  send(payload) {
    this.onSend?.(JSON.parse(payload), this)
  }

  close() {
    if (this.closed) {
      return
    }

    this.closed = true
    queueMicrotask(() => this.emit('close'))
  }
}

class FakeChromeProcess extends EventEmitter {
  exitCode = null
  signalCode = null

  exit(code, signal = null) {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

describe('bounded browser CDP client', () => {
  it('keeps the default connection budget aligned with Chrome readiness', () => {
    expect(DEFAULT_CONNECT_TIMEOUT_MS).toBe(30_000)
  })

  it('accepts load completion from the page event or the main frame only', () => {
    const childFrameStop = {
      method: 'Page.frameStoppedLoading',
      params: { frameId: 'child-frame' },
    }
    const mainFrameStop = {
      method: 'Page.frameStoppedLoading',
      params: { frameId: 'main-frame' },
    }

    expect(
      findMainFrameLoadCompletionEvent(
        [childFrameStop, mainFrameStop],
        0,
        'main-frame',
      ),
    ).toBe(mainFrameStop)
    expect(
      findMainFrameLoadCompletionEvent(
        [{ method: 'Page.loadEventFired', params: { timestamp: 1 } }],
        0,
        'main-frame',
      )?.method,
    ).toBe('Page.loadEventFired')
    expect(
      findMainFrameLoadCompletionEvent([childFrameStop], 0, 'main-frame'),
    ).toBeUndefined()
  })

  it('reports a Chrome process that exits before remote debugging is ready', async () => {
    const chrome = new FakeChromeProcess()
    const startup = waitForChrome(12345, {
      childProcess: chrome,
      timeoutMs: 1_000,
      intervalMs: 10,
      requestTimeoutMs: 10,
    })

    chrome.exit(37)

    await expect(startup).rejects.toThrow(
      'Chrome process exited before remote debugging became ready (exit code 37).',
    )
    expect(chrome.listenerCount('exit')).toBe(0)
    expect(chrome.listenerCount('error')).toBe(0)
  })

  it('collects events, resolves commands, and unregisters listeners', async () => {
    const socket = new FakeWebSocket({
      onSend(command, target) {
        queueMicrotask(() => {
          target.emitMessage({ id: command.id, result: { method: command.method } })
        })
      },
    })
    const cdp = await connectCdp('ws://fake', {
      createWebSocket: () => socket,
      connectTimeoutMs: 100,
      commandTimeoutMs: 100,
    })
    const received = []
    const removeListener = cdp.on('Network.requestWillBeSent', (params) => {
      received.push(params.url)
    })

    await expect(cdp.send('Network.enable')).resolves.toEqual({
      method: 'Network.enable',
    })
    socket.emitMessage({
      method: 'Network.requestWillBeSent',
      params: { url: 'https://example.test/first' },
    })
    removeListener()
    socket.emitMessage({
      method: 'Network.requestWillBeSent',
      params: { url: 'https://example.test/second' },
    })

    expect(received).toEqual(['https://example.test/first'])
    expect(cdp.events).toHaveLength(2)
    cdp.close()
  })

  it('rejects a connection that never opens within its deadline', async () => {
    const socket = new FakeWebSocket({ open: false })

    await expect(
      connectCdp('ws://fake', {
        createWebSocket: () => socket,
        connectTimeoutMs: 20,
      }),
    ).rejects.toThrow('Timed out connecting to Chrome DevTools after 20ms')
    expect(socket.closed).toBe(true)
  })

  it('rejects unanswered commands and closes pending work deterministically', async () => {
    const socket = new FakeWebSocket()
    const cdp = await connectCdp('ws://fake', {
      createWebSocket: () => socket,
      connectTimeoutMs: 100,
      commandTimeoutMs: 20,
    })

    await expect(cdp.send('Runtime.evaluate')).rejects.toThrow(
      'Chrome DevTools command timed out after 20ms: Runtime.evaluate',
    )

    const pending = cdp.send('Page.enable')
    cdp.close()
    await expect(pending).rejects.toThrow('Chrome DevTools WebSocket closed by smoke cleanup')
  })

  it('allows one long evaluation to use a larger bounded command deadline', async () => {
    const socket = new FakeWebSocket({
      onSend(command, target) {
        setTimeout(() => {
          target.emitMessage({ id: command.id, result: { completed: true } })
        }, 30)
      },
    })
    const cdp = await connectCdp('ws://fake', {
      createWebSocket: () => socket,
      connectTimeoutMs: 100,
      commandTimeoutMs: 10,
    })

    await expect(
      cdp.send('Runtime.evaluate', {}, { timeoutMs: 100 }),
    ).resolves.toEqual({ completed: true })
    cdp.close()
  })
})
