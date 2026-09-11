import { describe, expect, it } from 'vitest'

import worker from '../../cloudflare/sync-worker.js'

describe('Cloudflare sync worker static assets', () => {
  it('serves production assets through the configured ASSETS binding', async () => {
    const requests = []
    const env = {
      ASSETS: {
        async fetch(request) {
          requests.push(request)
          return new Response('ZeroChat asset', {
            status: 200,
            headers: { 'content-type': 'text/plain; charset=utf-8' },
          })
        },
      },
    }

    const response = await worker.fetch(
      new Request('https://zerochat.test/assets/app.js'),
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ZeroChat asset')
    expect(requests).toHaveLength(1)
    expect(requests[0].url).toBe('https://zerochat.test/assets/app.js')
  })

  it('forwards HEAD asset requests without changing the request method', async () => {
    const requests = []
    const env = {
      ASSETS: {
        async fetch(request) {
          requests.push(request)
          return new Response(null, { status: 200 })
        },
      },
    }

    const response = await worker.fetch(
      new Request('https://zerochat.test/assets/app.js', { method: 'HEAD' }),
      env,
    )

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('')
    expect(requests).toHaveLength(1)
    expect(requests[0].method).toBe('HEAD')
  })

  it('rejects non-read asset requests before touching the binding', async () => {
    let fetchCount = 0
    const env = {
      ASSETS: {
        async fetch() {
          fetchCount += 1
          return new Response('unexpected')
        },
      },
    }

    const response = await worker.fetch(
      new Request('https://zerochat.test/assets/app.js', { method: 'POST' }),
      env,
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not found')
    expect(fetchCount).toBe(0)
  })

  it('keeps missing asset bindings fail-closed', async () => {
    const response = await worker.fetch(
      new Request('https://zerochat.test/'),
      {},
    )

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not found')
  })
})
