type UpgradeDatabase = (database: IDBDatabase) => void

export function openIndexedDb(
  name: string,
  version: number,
  upgrade: UpgradeDatabase,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let outcome: 'pending' | 'fulfilled' | 'rejected' = 'pending'
    let ownedDatabase: IDBDatabase | null = null
    const closedUnownedDatabases = new Set<IDBDatabase>()

    const closeUnownedDatabase = (database: IDBDatabase): void => {
      if (database === ownedDatabase || closedUnownedDatabases.has(database)) {
        return
      }

      closedUnownedDatabases.add(database)
      try {
        database.close()
      } catch {
        // A late database is already unowned; its close failure must not change the settled request.
      }
    }

    const rejectOnce = (error: unknown): void => {
      if (outcome !== 'pending') return
      outcome = 'rejected'
      reject(error)
    }

    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => upgrade(request.result)
    request.onblocked = () => rejectOnce(new Error('IndexedDB open blocked'))
    request.onerror = () => rejectOnce(request.error)
    request.onsuccess = () => {
      const database = request.result
      if (outcome !== 'pending') {
        closeUnownedDatabase(database)
        return
      }

      outcome = 'fulfilled'
      ownedDatabase = database
      database.onversionchange = () => database.close()
      resolve(database)
    }
  })
}
