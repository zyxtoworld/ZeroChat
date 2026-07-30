import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const source = await readFile(
  new URL('../../apps/windows/ZeroChat/SecretStore.cpp', import.meta.url),
  'utf8',
)

function functionBody(signature, nextSignature) {
  const start = source.indexOf(signature)
  expect(start, `missing ${signature}`).not.toBe(-1)
  const end = source.indexOf(nextSignature, start + signature.length)
  expect(end, `missing ${nextSignature}`).not.toBe(-1)
  return source.slice(start, end)
}

describe('Windows PasswordVault atomic replacement', () => {
  it('serializes cleanup and publication across app processes', () => {
    expect(source).toMatch(
      /SecretStoreMutexName\[\] = L"Local\\\\ZeroChat\.SecretStore\.v2"/,
    )
    expect(source).toMatch(/class CrossProcessSecretStoreLock final/)
    expect(source).toMatch(/WaitForSingleObject\(m_mutex, INFINITE\)/)
    expect(source).toMatch(/waitResult != WAIT_OBJECT_0 && waitResult != WAIT_ABANDONED/)
    expect(
      source.match(/CrossProcessSecretStoreLock processLock;/g)?.length,
    ).toBe(3)
  })

  it('stages a complete generation before publishing the revision pointer', () => {
    const body = functionBody(
      'void StageCommittedSnapshot(',
      'void RequireSnapshotMatches(',
    )
    const valueWrite = body.indexOf(
      'AddCredentialVerified(vault, TransactionValueAccount(transaction, name), value);',
    )
    const migrationWrite = body.indexOf('TransactionMigrationAccount(transaction),')
    const commitWrite = body.indexOf(
      'AddCredentialVerified(vault, CommitAccount(transaction), CommitValue);',
    )
    const revisionWrite = body.indexOf(
      'AddCredentialVerified(vault, RevisionAccount, transaction);',
    )

    expect(valueWrite).toBeGreaterThanOrEqual(0)
    expect(valueWrite).toBeLessThan(migrationWrite)
    expect(migrationWrite).toBeLessThan(commitWrite)
    expect(commitWrite).toBeLessThan(revisionWrite)
    expect(body).not.toMatch(/Remove|vault\.Remove/)
  })

  it('keeps UUID revisions while reading only committed generations', () => {
    expect(source).toMatch(/CommitAccountPrefix\[\] = L"meta:commit:"/)
    expect(source).toMatch(
      /auto commit = ReadCredential\(vault, CommitAccount\(\*revision\)\);[\s\S]*if \(!commit\.has_value\(\)\)[\s\S]*return std::nullopt;[\s\S]*if \(\*commit != CommitValue\)[\s\S]*throw hresult_error\(E_FAIL\)/,
    )
    expect(source).toMatch(/auto nextRevision = transaction;/)
    expect(source).not.toMatch(/v2:/)
  })

  it('retries residual cleanup around every committed read and mutation', () => {
    expect(
      source.match(/CleanupResidualCredentials\(vault, snapshot\.transaction\);/g)?.length,
    ).toBe(2)
    expect(source).toMatch(
      /CleanupResidualCredentials\(vault, previous\.transaction\);[\s\S]*previous\.revision != expectedRevision/,
    )
    expect(source).toMatch(
      /RequireSnapshotMatches\([\s\S]*CleanupResidualCredentialsAfterCommit\(vault, transaction\);/,
    )
    expect(source).not.toMatch(/RemoveCredential\(vault, account\)/)
  })

  it('defers only PasswordVault failures during post-commit cleanup', () => {
    const body = functionBody(
      'void CleanupResidualCredentialsAfterCommit(',
      'void StageCommittedSnapshot(',
    )
    expect(body).toMatch(/catch \(hresult_error const&\)/)
    expect(body).not.toMatch(/catch \(\.\.\.\)/)
    expect(body).toMatch(/later Probe\/Read\/Mutate retries cleanup/)
  })
})
