import { describe, expect, it, vi } from 'vitest'

import {
  SERVICE_WORKER_REGISTRATION_WARNING,
  installServiceWorkerRegistration,
  registerServiceWorker,
} from '../serviceWorkerRegistration'

function createWindowHarness() {
  let loadListener: (() => void) | null = null
  let loadListenerOnce = false
  const win = {
    addEventListener: vi.fn((
      type: 'load',
      listener: () => void,
      options?: { once?: boolean },
    ) => {
      if (type === 'load') {
        loadListener = listener
        loadListenerOnce = options?.once === true
      }
    }),
  }

  return {
    triggerLoad() {
      const listener = loadListener
      if (loadListenerOnce) {
        loadListener = null
      }
      listener?.()
    },
    win,
  }
}

async function flushPromises() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('service worker registration', () => {
  it('does not install outside production or without service worker support', () => {
    const supported = createWindowHarness()

    expect(
      installServiceWorkerRegistration({
        isProd: false,
        nav: { serviceWorker: { register: vi.fn() } },
        win: supported.win,
      }),
    ).toBe(false)
    expect(supported.win.addEventListener).not.toHaveBeenCalled()

    const unsupported = createWindowHarness()

    expect(
      installServiceWorkerRegistration({
        isProd: true,
        nav: {},
        win: unsupported.win,
      }),
    ).toBe(false)
    expect(unsupported.win.addEventListener).not.toHaveBeenCalled()
  })

  it('does not register a service worker on the Windows virtual origin', () => {
    const register = vi.fn(() => Promise.resolve())
    const harness = createWindowHarness()

    expect(
      installServiceWorkerRegistration({
        isProd: true,
        nav: { serviceWorker: { register } },
        origin: 'https://appassets.zerochat.local',
        win: harness.win,
      }),
    ).toBe(false)
    expect(harness.win.addEventListener).not.toHaveBeenCalled()

    registerServiceWorker({
      nav: { serviceWorker: { register } },
      origin: 'https://appassets.zerochat.local',
    })
    expect(register).not.toHaveBeenCalled()
  })

  it('registers the app service worker after the window load event', () => {
    const register = vi.fn(() => Promise.resolve())
    const harness = createWindowHarness()

    expect(
      installServiceWorkerRegistration({
        baseUrl: '/app/',
        isProd: true,
        nav: { serviceWorker: { register } },
        win: harness.win,
      }),
    ).toBe(true)
    expect(register).not.toHaveBeenCalled()
    expect(harness.win.addEventListener).toHaveBeenCalledWith(
      'load',
      expect.any(Function),
      { once: true },
    )

    harness.triggerLoad()
    harness.triggerLoad()

    expect(register).toHaveBeenCalledWith('/app/sw.js')
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('coalesces repeated installs before the window load event', () => {
    const register = vi.fn(() => Promise.resolve())
    const listeners: Array<() => void> = []
    const win = {
      addEventListener: vi.fn((
        _type: 'load',
        listener: () => void,
      ) => {
        listeners.push(listener)
      }),
    }
    const options = {
      isProd: true,
      nav: { serviceWorker: { register } },
      win,
    }

    expect(installServiceWorkerRegistration(options)).toBe(true)
    expect(installServiceWorkerRegistration(options)).toBe(true)
    expect(win.addEventListener).toHaveBeenCalledTimes(1)

    for (const listener of listeners) {
      listener()
    }

    expect(register).toHaveBeenCalledWith('/sw.js')
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('does not lose a load transition between the readyState check and listener registration', () => {
    const register = vi.fn(() => Promise.resolve())
    let readyState: 'loading' | 'complete' = 'loading'
    const win = {
      addEventListener: vi.fn(() => {
        readyState = 'complete'
      }),
    }

    expect(
      installServiceWorkerRegistration({
        baseUrl: '/app/',
        doc: {
          get readyState() {
            return readyState
          },
        },
        isProd: true,
        nav: { serviceWorker: { register } },
        win,
      }),
    ).toBe(true)

    expect(register).toHaveBeenCalledWith('/app/sw.js')
    expect(register).toHaveBeenCalledTimes(1)
  })

  it('joins a base URL without a trailing slash before the worker filename', () => {
    const register = vi.fn(() => Promise.resolve())
    const harness = createWindowHarness()

    expect(
      installServiceWorkerRegistration({
        baseUrl: '/app',
        doc: { readyState: 'complete' },
        isProd: true,
        nav: { serviceWorker: { register } },
        win: harness.win,
      }),
    ).toBe(true)

    expect(register).toHaveBeenCalledWith('/app/sw.js')
  })

  it('allows a later install to retry after registration rejection', async () => {
    const register = vi
      .fn()
      .mockImplementationOnce(() => Promise.reject(new Error('first attempt failed')))
      .mockImplementationOnce(() => Promise.resolve())
    const logger = { warn: vi.fn() }
    const harness = createWindowHarness()
    const options = {
      doc: { readyState: 'complete' as const },
      isProd: true,
      logger,
      nav: { serviceWorker: { register } },
      win: harness.win,
    }

    expect(installServiceWorkerRegistration(options)).toBe(true)
    await flushPromises()
    expect(installServiceWorkerRegistration(options)).toBe(true)

    expect(register).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('allows an immediate retry after a synchronous registration failure', () => {
    const register = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('synchronous registration failure')
      })
      .mockImplementationOnce(() => Promise.resolve())
    const logger = { warn: vi.fn() }
    const harness = createWindowHarness()
    const options = {
      doc: { readyState: 'complete' as const },
      isProd: true,
      logger,
      nav: { serviceWorker: { register } },
      win: harness.win,
    }

    expect(installServiceWorkerRegistration(options)).toBe(true)
    expect(installServiceWorkerRegistration(options)).toBe(true)

    expect(register).toHaveBeenCalledTimes(2)
    expect(logger.warn).toHaveBeenCalledOnce()
  })

  it('registers immediately when the window load event already passed', () => {
    const register = vi.fn(() => Promise.resolve())
    const harness = createWindowHarness()

    expect(
      installServiceWorkerRegistration({
        baseUrl: '/late/',
        doc: { readyState: 'complete' },
        isProd: true,
        nav: { serviceWorker: { register } },
        win: harness.win,
      }),
    ).toBe(true)

    expect(register).toHaveBeenCalledWith('/late/sw.js')
    expect(harness.win.addEventListener).not.toHaveBeenCalled()
  })

  it('logs rejected service worker registration without exposing raw error text', async () => {
    const failure = new Error('api_key=sk-secret123456')
    failure.name = 'api_key=sk-secret123456'
    const logger = { warn: vi.fn() }

    registerServiceWorker({
      baseUrl: '/zerochat/',
      logger,
      nav: {
        serviceWorker: {
          register: vi.fn(() => Promise.reject(failure)),
        },
      },
    })

    await flushPromises()

    expect(logger.warn).toHaveBeenCalledWith(
      SERVICE_WORKER_REGISTRATION_WARNING,
      'unknown',
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('sk-secret')
  })

  it('contains synchronous service worker and diagnostic logger failures', () => {
    const logger = { warn: vi.fn(() => void 0) }

    registerServiceWorker({
      logger,
      nav: {
        serviceWorker: {
          register: vi.fn(() => {
            throw Object.assign(new Error('blocked'), { name: 'SecurityError' })
          }),
        },
      },
    })

    expect(logger.warn).toHaveBeenCalledWith(
      SERVICE_WORKER_REGISTRATION_WARNING,
      'SecurityError',
    )

    expect(() =>
      registerServiceWorker({
        logger: {
          warn: vi.fn(() => {
            throw new Error('logger down')
          }),
        },
        nav: {
          serviceWorker: {
            register: vi.fn(() => {
              throw new Error('blocked')
            }),
          },
        },
      }),
    ).not.toThrow()
  })

  it('contains service worker load listener installation failures', () => {
    const register = vi.fn()
    const logger = { warn: vi.fn() }
    const win = {
      addEventListener: vi.fn(() => {
        throw Object.assign(new Error('load listener blocked'), {
          name: 'SecurityError',
        })
      }),
    }

    expect(
      installServiceWorkerRegistration({
        isProd: true,
        logger,
        nav: { serviceWorker: { register } },
        win,
      }),
    ).toBe(false)

    expect(register).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledWith(
      SERVICE_WORKER_REGISTRATION_WARNING,
      'SecurityError',
    )

    expect(() =>
      installServiceWorkerRegistration({
        isProd: true,
        logger: {
          warn: vi.fn(() => {
            throw new Error('logger down')
          }),
        },
        nav: { serviceWorker: { register } },
        win,
      }),
    ).not.toThrow()
  })
})
