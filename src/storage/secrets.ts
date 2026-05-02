const SECRET_PREFIX = 'zerochat:secret:'
const SYNC_PASSPHRASE_KEY = `${SECRET_PREFIX}sync-passphrase`

export function getProviderKey(providerId: string): string {
  return localStorage.getItem(`${SECRET_PREFIX}provider:${providerId}`) ?? ''
}

export function setProviderKey(providerId: string, value: string): void {
  const key = `${SECRET_PREFIX}provider:${providerId}`

  if (value.trim()) {
    localStorage.setItem(key, value.trim())
    return
  }

  localStorage.removeItem(key)
}

export function getProviderProxyToken(providerId: string): string {
  return localStorage.getItem(`${SECRET_PREFIX}proxy:${providerId}`) ?? ''
}

export function setProviderProxyToken(providerId: string, value: string): void {
  const key = `${SECRET_PREFIX}proxy:${providerId}`

  if (value.trim()) {
    localStorage.setItem(key, value.trim())
    return
  }

  localStorage.removeItem(key)
}

export function getGithubToken(): string {
  return localStorage.getItem(`${SECRET_PREFIX}github-token`) ?? ''
}

export function setGithubToken(value: string): void {
  const key = `${SECRET_PREFIX}github-token`

  if (value.trim()) {
    localStorage.setItem(key, value.trim())
    return
  }

  localStorage.removeItem(key)
}

export function getWorkerToken(): string {
  return localStorage.getItem(`${SECRET_PREFIX}worker-token`) ?? ''
}

export function setWorkerToken(value: string): void {
  const key = `${SECRET_PREFIX}worker-token`

  if (value.trim()) {
    localStorage.setItem(key, value.trim())
    return
  }

  localStorage.removeItem(key)
}

export function getSyncPassphrase(): string {
  const legacy = localStorage.getItem(SYNC_PASSPHRASE_KEY)

  if (legacy) {
    sessionStorage.setItem(SYNC_PASSPHRASE_KEY, legacy)
    localStorage.removeItem(SYNC_PASSPHRASE_KEY)
    return legacy
  }

  return sessionStorage.getItem(SYNC_PASSPHRASE_KEY) ?? ''
}

export function setSyncPassphrase(value: string): void {
  if (value) {
    sessionStorage.setItem(SYNC_PASSPHRASE_KEY, value)
    localStorage.removeItem(SYNC_PASSPHRASE_KEY)
    return
  }

  sessionStorage.removeItem(SYNC_PASSPHRASE_KEY)
  localStorage.removeItem(SYNC_PASSPHRASE_KEY)
}

export function clearProviderSecrets(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)

    if (
      key?.startsWith(`${SECRET_PREFIX}provider:`) ||
      key?.startsWith(`${SECRET_PREFIX}proxy:`)
    ) {
      localStorage.removeItem(key)
    }
  }
}

export function clearZeroChatSecrets(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)

    if (key?.startsWith(SECRET_PREFIX)) {
      localStorage.removeItem(key)
    }
  }

  sessionStorage.removeItem(SYNC_PASSPHRASE_KEY)
}
