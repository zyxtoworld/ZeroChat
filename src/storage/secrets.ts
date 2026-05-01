const SECRET_PREFIX = 'zerochat:secret:'

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
  return localStorage.getItem(`${SECRET_PREFIX}sync-passphrase`) ?? ''
}

export function setSyncPassphrase(value: string): void {
  const key = `${SECRET_PREFIX}sync-passphrase`

  if (value) {
    localStorage.setItem(key, value)
    return
  }

  localStorage.removeItem(key)
}

export function clearZeroChatSecrets(): void {
  for (let index = localStorage.length - 1; index >= 0; index -= 1) {
    const key = localStorage.key(index)

    if (key?.startsWith(SECRET_PREFIX)) {
      localStorage.removeItem(key)
    }
  }
}
