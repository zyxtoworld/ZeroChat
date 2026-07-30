export const APP_DATA_WRITE_CONFLICT_MESSAGE =
  'Local data changed in another tab or window. Reload before saving again.'

export class AppDataWriteConflictError extends Error {
  constructor() {
    super(APP_DATA_WRITE_CONFLICT_MESSAGE)
    this.name = 'AppDataWriteConflictError'
  }
}
