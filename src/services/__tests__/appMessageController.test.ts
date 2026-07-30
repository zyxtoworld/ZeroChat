import {
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import {
  createTranslator,
  loadLocale,
  type Translator,
} from '../../i18n'
import {
  formatAppErrorMessage,
  localizeLocalSaveError,
  localizeSyncRuntimeMessage,
  reportLocalSaveErrorNotice,
} from '../appMessageController'
import { APP_DATA_WRITE_CONFLICT_MESSAGE } from '../../storage/appDataWriteConflict'
import { ProviderRequestError } from '../providerErrors'

const fakeTranslator: Translator = (key) => `translated:${key}`

beforeAll(async () => {
  await Promise.all([
    loadLocale('en-US'),
    loadLocale('zh-CN'),
  ])
})

describe('formatAppErrorMessage', () => {
  it('maps provider error codes to localized user-facing copy', () => {
    expect(formatAppErrorMessage({ code: 'network' }, fakeTranslator, 'en-US')).toBe(
      'translated:error.networkRequestFailed',
    )
    expect(formatAppErrorMessage({ code: 'timeout' }, fakeTranslator, 'en-US')).toBe(
      'translated:error.networkRequestFailed',
    )
    expect(formatAppErrorMessage({ code: 'auth' }, fakeTranslator, 'en-US')).toBe(
      'translated:error.apiKeyInvalid',
    )
    expect(formatAppErrorMessage({ code: 'quota' }, fakeTranslator, 'en-US')).toBe(
      'translated:error.apiBalanceInsufficient',
    )
    expect(formatAppErrorMessage({ code: 'rate-limit' }, fakeTranslator, 'en-US')).toBe(
      'translated:error.apiRateLimited',
    )
    expect(formatAppErrorMessage({ code: 'endpoint' }, fakeTranslator, 'en-US')).toBe(
      'translated:error.providerEndpointMissing',
    )
    expect(formatAppErrorMessage({ code: 'server' }, fakeTranslator, 'en-US')).toBe(
      'translated:error.apiUnavailable',
    )
    expect(formatAppErrorMessage({ code: 'request' }, fakeTranslator, 'en-US')).toBe(
      'translated:error.apiRequestFailed',
    )
  })

  it('preserves focused browser CORS guidance for provider connection failures', () => {
    const message = formatAppErrorMessage(
      new ProviderRequestError(
        'network',
        'Cannot connect to Model list API at https://relay.example.test/v1/models. If terminal tools work but the browser does not, the provider is likely blocking browser CORS/preflight requests. Configure your own AI proxy URL (Cloudflare Worker) in provider settings.',
        { retryable: true },
      ),
      fakeTranslator,
      'en-US',
    )

    expect(message).toContain('Cannot connect to Model list API')
    expect(message).toContain('[redacted-url]')
    expect(message).not.toContain('relay.example.test')
    expect(message).toContain('browser CORS/preflight')
    expect(message).toContain('Cloudflare Worker')
  })

  it('redacts secrets and provider URLs from unknown error text before showing it', () => {
    const message = formatAppErrorMessage(
      new Error(
        'Provider rejected api_key=sk-verysecret123456789 at https://relay.example.test/v1/chat/completions',
      ),
      fakeTranslator,
      'en-US',
    )

    expect(message).toBe('Provider rejected api_key: [redacted] at [redacted-url]')
    expect(message).not.toContain('sk-verysecret')
    expect(message).not.toContain('relay.example.test')
  })
})

describe('localizeSyncRuntimeMessage', () => {
  it('localizes known sync runtime messages without involving App.tsx', () => {
    expect(localizeSyncRuntimeMessage('Sync complete', 'zh-CN')).toBe('同步完成')
    expect(localizeSyncRuntimeMessage('not in dictionary', 'zh-CN')).toBe(
      'not in dictionary',
    )
  })
})

describe('localizeLocalSaveError', () => {
  it('uses known-message localization and redacts local save details', () => {
    expect(localizeLocalSaveError('Sync complete', 'zh-CN')).toBe('同步完成')
    expect(
      localizeLocalSaveError(APP_DATA_WRITE_CONFLICT_MESSAGE, 'zh-CN'),
    ).toBe('本机数据已在另一个标签页或窗口中更改，请重新加载后再保存。')
    expect(
      localizeLocalSaveError(
        'IndexedDB write failed with Bearer local-token-12345',
        'en-US',
      ),
    ).toBe('IndexedDB write failed with Bearer [redacted]')
  })

  it('can use real translator output for provider-facing errors', () => {
    const t = createTranslator('zh-CN')

    expect(formatAppErrorMessage({ code: 'auth' }, t, 'zh-CN')).toBe(
      'API Key 无效，请检查是否复制完整',
    )
  })

  it('reports local save failures as explicit error notices', () => {
    const setNotice = vi.fn()

    reportLocalSaveErrorNotice(
      'Disk full while saving Bearer local-token-12345',
      'en-US',
      setNotice,
    )

    expect(setNotice).toHaveBeenCalledWith(
      'Disk full while saving Bearer [redacted]',
      'error',
    )
  })

  it('contains local-save notice reporter failures', () => {
    const failingNotice = vi.fn(() => {
      throw new Error('notice unavailable')
    })

    expect(() =>
      reportLocalSaveErrorNotice(
        'Disk full while saving Bearer local-token-12345',
        'en-US',
        failingNotice,
      ),
    ).not.toThrow()
    expect(failingNotice).toHaveBeenCalledWith(
      'Disk full while saving Bearer [redacted]',
      'error',
    )

    const unformattableError = {
      toString: () => {
        throw new Error('formatting unavailable')
      },
    }
    const unusedNotice = vi.fn()

    expect(() =>
      reportLocalSaveErrorNotice(unformattableError, 'en-US', unusedNotice),
    ).not.toThrow()
    expect(unusedNotice).not.toHaveBeenCalled()
  })
})
