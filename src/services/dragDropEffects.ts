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
