import test from 'node:test'
import assert from 'node:assert/strict'

import { cleanupIndexedDbDatabase } from '../browser-indexeddb-cleanup.mjs'

function request(result) {
  const value = {}
  queueMicrotask(() => {
    if (result.kind === 'open-error') {
      value.error = new Error('open failed')
      value.onerror?.()
    } else {
      value.result = { close: result.close ?? (() => undefined) }
      value.onsuccess?.()
    }
  })
  return value
}

function indexedDbFixture(result) {
  const deletes = []
  return {
    deletes,
    indexedDBApi: {
      open: () => request(result),
      deleteDatabase: () => {
        const value = {}
        deletes.push(value)
        queueMicrotask(() => {
          if (result.kind === 'blocked') value.onblocked?.()
          else if (result.kind === 'delete-error') {
            value.error = new Error('delete failed')
            value.onerror?.()
          } else value.onsuccess?.()
        })
        return value
      },
    },
  }
}

test('IndexedDB cleanup closes the database before a successful deletion', async () => {
  let closed = false
  const fixture = indexedDbFixture({ close: () => { closed = true } })

  await cleanupIndexedDbDatabase({ indexedDBApi: fixture.indexedDBApi, name: 'zerochat-secrets' })
  assert.equal(closed, true)
  assert.equal(fixture.deletes.length, 1)
})

test('IndexedDB cleanup fails closed for blocked deletion', async () => {
  const fixture = indexedDbFixture({ kind: 'blocked' })

  await assert.rejects(
    () => cleanupIndexedDbDatabase({ indexedDBApi: fixture.indexedDBApi, name: 'blocked' }),
    /IndexedDB deletion blocked/u,
  )
})

test('IndexedDB cleanup fails closed for open and delete errors', async () => {
  const openError = indexedDbFixture({ kind: 'open-error' })
  await assert.rejects(
    () => cleanupIndexedDbDatabase({ indexedDBApi: openError.indexedDBApi, name: 'open-error' }),
    /open failed/u,
  )

  const deleteError = indexedDbFixture({ kind: 'delete-error' })
  await assert.rejects(
    () => cleanupIndexedDbDatabase({ indexedDBApi: deleteError.indexedDBApi, name: 'delete-error' }),
    /delete failed/u,
  )
})

test('IndexedDB cleanup stops before deletion when close fails', async () => {
  const fixture = indexedDbFixture({ close: () => { throw new Error('close failed') } })

  await assert.rejects(
    () => cleanupIndexedDbDatabase({ indexedDBApi: fixture.indexedDBApi, name: 'close-error' }),
    /close failed/u,
  )
  assert.equal(fixture.deletes.length, 0)
})
