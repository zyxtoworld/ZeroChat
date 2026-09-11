export function cleanupIndexedDbDatabase({ indexedDBApi, name }) {
  const openRequest = indexedDBApi.open(name)

  return new Promise((resolve, reject) => {
    openRequest.onerror = () => reject(openRequest.error ?? new Error(`IndexedDB open failed: ${name}`))
    openRequest.onupgradeneeded = () => undefined
    openRequest.onsuccess = () => {
      const database = openRequest.result
      try {
        database.close()
      } catch (error) {
        reject(error)
        return
      }

      const deleteRequest = indexedDBApi.deleteDatabase(name)
      deleteRequest.onerror = () =>
        reject(deleteRequest.error ?? new Error(`IndexedDB deletion failed: ${name}`))
      deleteRequest.onblocked = () => reject(new Error(`IndexedDB deletion blocked: ${name}`))
      deleteRequest.onsuccess = () => resolve()
    }
  })
}

export function createIndexedDbCleanupScript(name) {
  return `(async () => {
    const name = ${JSON.stringify(name)}
    const openRequest = indexedDB.open(name)
    const database = await new Promise((resolve, reject) => {
      openRequest.onerror = () => reject(openRequest.error ?? new Error('IndexedDB open failed: ' + name))
      openRequest.onupgradeneeded = () => undefined
      openRequest.onsuccess = () => resolve(openRequest.result)
    })
    database.close()
    const deleteRequest = indexedDB.deleteDatabase(name)
    await new Promise((resolve, reject) => {
      deleteRequest.onerror = () => reject(deleteRequest.error ?? new Error('IndexedDB deletion failed: ' + name))
      deleteRequest.onblocked = () => reject(new Error('IndexedDB deletion blocked: ' + name))
      deleteRequest.onsuccess = () => resolve()
    })
    return true
  })()`
}
