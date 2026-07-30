import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { loadLocale, setRuntimeLocale } from '../../i18n'
import {
  reportStartupRenderFailure,
  runtimeFailureCopy,
} from '../startupFatalError'

class FakeElement {
  attributes = new Map<string, string>()
  children: FakeElement[] = []
  className = ''
  focused = false
  listeners = new Map<string, Array<() => void>>()
  readonly tagName: string
  textContent: string | null = null
  type = ''

  constructor(tagName: string) {
    this.tagName = tagName
  }

  append(...children: FakeElement[]) {
    this.children.push(...children)
  }

  addEventListener(name: string, listener: () => void) {
    const listeners = this.listeners.get(name) ?? []
    listeners.push(listener)
    this.listeners.set(name, listeners)
  }

  click() {
    for (const listener of this.listeners.get('click') ?? []) {
      listener()
    }
  }

  focus() {
    this.focused = true
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }

  visibleText(): string {
    return [
      this.textContent ?? '',
      ...this.children.map((child) => child.visibleText()),
    ].join(' ')
  }
}

class FakeDocument {
  body = new FakeElement('body')
  root: FakeElement | null

  constructor({ hasRoot = true }: { hasRoot?: boolean } = {}) {
    this.root = hasRoot ? new FakeElement('div') : null
  }

  createElement(tagName: string) {
    return new FakeElement(tagName)
  }

  getElementById(id: string) {
    return id === 'root' ? this.root : null
  }
}

beforeAll(async () => {
  await Promise.all([loadLocale('en-US'), loadLocale('zh-CN')])
})

beforeEach(() => {
  setRuntimeLocale('en-US')
})

describe('reportStartupRenderFailure', () => {
  it('renders a minimal startup failure without exposing raw error text', () => {
    const doc = new FakeDocument()
    const logger = { error: vi.fn() }
    const reloadPage = vi.fn()

    reportStartupRenderFailure(new Error('api_key=sk-secret123456'), {
      doc: doc as unknown as Document,
      logger,
      reloadPage,
    })

    const fallback = doc.root?.children[0]
    const reloadButton = fallback?.children[2]
    const copy = runtimeFailureCopy()
    expect(logger.error).toHaveBeenCalledWith(
      'ZeroChat startup failed.',
      expect.any(Error),
    )
    expect(fallback?.tagName).toBe('main')
    expect(fallback?.className).toContain('startup-failure-state')
    expect(fallback?.attributes.get('role')).toBe('alert')
    expect(fallback?.attributes.get('aria-live')).toBe('assertive')
    expect(fallback?.visibleText()).toContain(copy.title)
    expect(fallback?.visibleText()).toContain(copy.description)
    expect(reloadButton?.textContent).toBe(copy.reloadLabel)
    expect(reloadButton?.type).toBe('button')
    expect(reloadButton?.focused).toBe(true)
    expect(fallback?.visibleText()).not.toContain('sk-secret')
    reloadButton?.click()
    expect(reloadPage).toHaveBeenCalledOnce()
  })

  it('falls back to document.body when the root element is missing', () => {
    const doc = new FakeDocument({ hasRoot: false })

    reportStartupRenderFailure(new Error('missing root'), {
      doc: doc as unknown as Document,
      logger: { error: vi.fn() },
    })

    expect(doc.body.children[0]?.className).toContain('startup-failure-state')
    expect(doc.body.children[0]?.visibleText()).toContain(runtimeFailureCopy().title)
  })

  it('uses the loaded runtime locale for pre-React recovery copy', () => {
    const doc = new FakeDocument()
    setRuntimeLocale('zh-CN')

    reportStartupRenderFailure(new Error('startup failed'), {
      doc: doc as unknown as Document,
      logger: { error: vi.fn() },
    })

    expect(doc.root?.children[0]?.visibleText()).toContain('启动失败')
    expect(doc.root?.children[0]?.visibleText()).toContain('重新加载')
  })

  it('renders recovery even when the diagnostic logger throws', () => {
    const doc = new FakeDocument()

    expect(() =>
      reportStartupRenderFailure(new Error('startup failed'), {
        doc: doc as unknown as Document,
        logger: {
          error: vi.fn(() => {
            throw new Error('logger unavailable')
          }),
        },
      }),
    ).not.toThrow()
    expect(doc.root?.children[0]?.className).toContain('startup-failure-state')
  })

  it('contains reload failures without destroying the recovery state', () => {
    const doc = new FakeDocument()
    const logger = { error: vi.fn() }

    reportStartupRenderFailure(new Error('startup failed'), {
      doc: doc as unknown as Document,
      logger,
      reloadPage: () => {
        throw new Error('reload unavailable')
      },
    })

    const reloadButton = doc.root?.children[0]?.children[2]
    expect(() => reloadButton?.click()).not.toThrow()
    expect(logger.error).toHaveBeenCalledWith(
      'ZeroChat startup recovery reload failed.',
      expect.any(Error),
    )
  })
})
