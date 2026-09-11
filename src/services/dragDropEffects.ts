export function setDataTransferDropEffect(
  dataTransfer: Pick<DataTransfer, 'dropEffect'> | null | undefined,
  dropEffect: DataTransfer['dropEffect'],
): boolean {
  if (!dataTransfer) {
    return false
  }

  try {
    dataTransfer.dropEffect = dropEffect
    return true
  } catch {
    return false
  }
}

export function installDragDropCancelListeners(
  onCancel: () => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  let blurRegistered = false
  let dragendRegistered = false

  const cleanup = () => {
    if (blurRegistered) {
      blurRegistered = false
      try {
        window.removeEventListener('blur', onCancel)
      } catch {
        // Browser teardown may make listener removal unavailable.
      }
    }
    if (dragendRegistered) {
      dragendRegistered = false
      try {
        window.removeEventListener('dragend', onCancel)
      } catch {
        // Browser teardown may make listener removal unavailable.
      }
    }
  }

  try {
    window.addEventListener('blur', onCancel)
    blurRegistered = true
    window.addEventListener('dragend', onCancel)
    dragendRegistered = true
  } catch {
    cleanup()
  }

  return cleanup
}
