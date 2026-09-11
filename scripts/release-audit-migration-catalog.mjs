// Classification input for the opt-in external preserve-provenance command.
// Historical AST/text occurrences are intentionally kept outside the repository.
export const releaseAuditMigrationCatalog = Object.freeze({
  schema: 'zerochat.release-audit-migration-catalog.v3',
  checkers: Object.freeze({
    'completion-audit': Object.freeze({ entries: Object.freeze([]) }),
    'repository-health': Object.freeze({ entries: Object.freeze([]) }),
  }),
})

