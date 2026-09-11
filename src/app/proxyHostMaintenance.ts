import { useEffect, useRef } from 'react'

import type { AppData } from '../types'
import type { ManagedProxyHostGroup } from '../services/providerProxyHosts'
import type {
  ProxyHostMaintenanceInput,
  ProxyHostMaintenanceQueue,
} from '../services/proxyHostMaintenanceQueue'

interface UseProxyHostMaintenanceOptions {
  data: AppData | null
  onError: (error: unknown) => void
  syncPassphraseValue: string
}

function reportMaintenanceFailure(
  onError: (error: unknown) => void,
  error: unknown,
): void {
  try {
    onError(error)
  } catch {
    // Detached maintenance cannot recover through a second notification path.
  }
}

export function useProxyHostMaintenance({
  data,
  onError,
  syncPassphraseValue,
}: UseProxyHostMaintenanceOptions): void {
  const inputRef = useRef<ProxyHostMaintenanceInput>({
    data,
    passphrase: syncPassphraseValue,
  })
  const onErrorRef = useRef(onError)
  const previousGroupsRef = useRef<ManagedProxyHostGroup[]>([])
  const queueRef = useRef<ProxyHostMaintenanceQueue | null>(null)

  useEffect(() => {
    inputRef.current = { data, passphrase: syncPassphraseValue }
    onErrorRef.current = onError
  }, [data, onError, syncPassphraseValue])

  useEffect(() => {
    let disposed = false
    let installedQueue: ProxyHostMaintenanceQueue | null = null
    void import('../services/proxyHostMaintenanceQueue')
      .then(({ createProxyHostMaintenanceQueue, maintainProxyHosts }) => {
        if (disposed) return
        const queue = createProxyHostMaintenanceQueue({
          getInput: () => inputRef.current,
          maintain: maintainProxyHosts,
          onError: (error) => onErrorRef.current(error),
          previousGroupsRef,
        })
        installedQueue = queue
        queueRef.current = queue
        queue.schedule()
      })
      .catch((error: unknown) => {
        if (!disposed) reportMaintenanceFailure(onErrorRef.current, error)
      })

    return () => {
      disposed = true
      installedQueue?.dispose()
      if (queueRef.current === installedQueue) queueRef.current = null
    }
  }, [])

  useEffect(() => {
    queueRef.current?.schedule()
  }, [data, syncPassphraseValue])
}
