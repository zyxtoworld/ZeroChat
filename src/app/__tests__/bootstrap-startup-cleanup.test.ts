import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => {
  let listener:
    | ((state: { status: string }, previous: { status: string }) => void)
    | undefined
  const unsubscribe = vi.fn()
  const createRoot = vi.fn(() => ({ render: vi.fn() }))
  const subscribe = vi.fn(
    (
      next: (state: { status: string }, previous: { status: string }) => void,
    ) => {
      listener = next
      return unsubscribe
    },
  )
  const getState = vi.fn(() => ({ data: null }))
  const useAppStore = Object.assign(vi.fn(), { getState, subscribe })

  const reset = () => {
    listener = undefined
    createRoot.mockReset()
    createRoot.mockReturnValue({ render: vi.fn() })
    getState.mockReset()
    getState.mockReturnValue({ data: null })
    subscribe.mockClear()
    unsubscribe.mockClear()
  }

  return {
    createRoot,
    getState,
    listener: () => listener,
    reset,
    subscribe,
    unsubscribe,
    useAppStore,
  }
})

const reportStartupRenderFailure = vi.hoisted(() => vi.fn())

vi.mock('react-dom/client', () => ({
  createRoot: harness.createRoot,
}))
vi.mock('../App', () => ({ App: () => null }))
vi.mock('../components/RuntimeBoundary', () => ({ RuntimeBoundary: () => null }))
vi.mock('../components/RuntimeFailureSmoke', () => ({ RuntimeFailureSmoke: () => null }))
vi.mock('../../services/serviceWorkerRegistration', () => ({
  installServiceWorkerRegistration: vi.fn(),
}))
vi.mock('../../services/startupFatalError', () => ({ reportStartupRenderFailure }))
vi.mock('../../storage/db', () => ({
  saveAppData: vi.fn(),
}))
vi.mock('../startupShell', () => ({ applyStartupShell: vi.fn() }))
vi.mock('../runtimeFailureProbe', () => ({
  appTestBridgeRequested: vi.fn(() => false),
  runtimeFailureProbeRequested: vi.fn(() => false),
}))
vi.mock('../store', () => ({
  appT: vi.fn(() => ''),
  useAppStore: harness.useAppStore,
}))
vi.mock('../theme', () => ({ applyTheme: vi.fn() }))

describe('bootstrap startup cleanup', () => {
  beforeEach(() => {
    vi.resetModules()
    harness.reset()
    reportStartupRenderFailure.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function installDom(root: object | null) {
    vi.stubGlobal('window', { location: {} })
    vi.stubGlobal('document', {
      documentElement: { dir: '', lang: '' },
      getElementById: vi.fn(() => root),
    })
  }

  it('releases the ready subscription when the root cannot be mounted', async () => {
    installDom(null)

    await import('../bootstrap')

    expect(harness.subscribe).toHaveBeenCalledOnce()
    expect(reportStartupRenderFailure).toHaveBeenCalledOnce()
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(harness.listener()).toBeTypeOf('function')
  })

  it('releases the ready subscription when root rendering throws', async () => {
    installDom({})
    harness.createRoot.mockReturnValue({
      render: vi.fn(() => {
        throw new Error('render failed')
      }),
    })

    await import('../bootstrap')

    expect(harness.createRoot).toHaveBeenCalledOnce()
    expect(reportStartupRenderFailure).toHaveBeenCalledOnce()
    expect(harness.unsubscribe).toHaveBeenCalledOnce()
  })

  it('keeps the subscription until ready and releases it only once', async () => {
    installDom({})

    await import('../bootstrap')

    expect(reportStartupRenderFailure).not.toHaveBeenCalled()
    expect(harness.unsubscribe).not.toHaveBeenCalled()

    const listener = harness.listener()
    expect(listener).toBeTypeOf('function')
    listener?.({ status: 'ready' }, { status: 'loading' })
    listener?.({ status: 'ready' }, { status: 'loading' })

    expect(harness.unsubscribe).toHaveBeenCalledOnce()
  })
})
