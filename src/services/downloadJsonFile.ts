export function revokeBackupObjectUrl(url: string): boolean {
  if (!url) return true

  try {
    URL.revokeObjectURL(url)
    return true
  } catch {
    return false
  }
}

function scheduleBackupObjectUrlCleanup(url: string): void {
  try {
    window.setTimeout(() => revokeBackupObjectUrl(url), 1000)
  } catch {
    revokeBackupObjectUrl(url)
  }
}

export function cleanupBackupDownloadAnchor(
  anchor: HTMLAnchorElement | null,
): boolean {
  if (!anchor) return true

  try {
    anchor.remove()
    return true
  } catch {
    try {
      const parent = anchor.parentNode
      if (!parent) return false
      parent.removeChild(anchor)
      return true
    } catch {
      return false
    }
  }
}

export function downloadJsonFile(value: unknown, fileName: string): boolean {
  let link: HTMLAnchorElement | null = null
  let url = ''

  try {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
      type: 'application/json',
    })
    url = URL.createObjectURL(blob)
    link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.append(link)
    link.click()
    scheduleBackupObjectUrlCleanup(url)
    return true
  } catch {
    revokeBackupObjectUrl(url)
    return false
  } finally {
    cleanupBackupDownloadAnchor(link)
  }
}
