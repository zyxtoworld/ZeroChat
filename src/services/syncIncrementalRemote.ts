import type {
  EncryptedObjectEnvelope,
  IncrementalSyncHead,
} from '../types'
import { rt } from '../i18n'
import {
  decryptObject,
  isEncryptedObject,
} from './crypto'
import {
  type IncrementalManifest,
  type IncrementalRemoteState,
  isIncrementalHead,
  isIncrementalManifest,
} from './syncIncrementalHelpers'
import {
  MAX_SYNC_ERROR_BODY_BYTES,
  MAX_SYNC_INCREMENTAL_HEAD_BYTES,
  MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
  assertSyncTextSize,
  fetchSync,
  readSyncError,
  readSyncResponseJson,
  readSyncResponseText,
} from './syncHttpBody'

const INCREMENTAL_HEAD_PATH = '/sync/head'
const INCREMENTAL_OBJECT_PATH = '/sync/object'
const SYNC_GENERATION_HEADER = 'x-zerochat-sync-generation'
const SYNC_GENERATION_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export interface IncrementalHeadObservation {
  generation: string
  head: IncrementalSyncHead | null
}

export class IncrementalHeadConflictError extends Error {
  constructor() {
    super(rt('error.remoteUpdated'))
    this.name = 'IncrementalHeadConflictError'
  }
}

export class IncrementalGenerationConflictError extends Error {
  constructor() {
    super(rt('error.remoteUpdated'))
    this.name = 'IncrementalGenerationConflictError'
  }
}

export function isIncrementalHeadConflictError(
  error: unknown,
): error is IncrementalHeadConflictError {
  return error instanceof IncrementalHeadConflictError
}

export function isIncrementalGenerationConflictError(
  error: unknown,
): error is IncrementalGenerationConflictError {
  return error instanceof IncrementalGenerationConflictError
}

export function readSyncGeneration(response: Response): string {
  const generation = response.headers.get(SYNC_GENERATION_HEADER)
  if (!SYNC_GENERATION_PATTERN.test(generation ?? '')) {
    throw new Error(rt('error.remoteUpdated'))
  }
  return generation as string
}

export async function readIncrementalHead(
  endpoint: string,
  token: string,
  signal?: AbortSignal,
): Promise<IncrementalHeadObservation | 'unsupported'> {
  const head = await fetchSync(
    `${endpoint}${INCREMENTAL_HEAD_PATH}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      signal,
    },
    async (response, signal) => {
      if (response.status === 501) {
        const message = await readSyncError(response, signal)

        if (message.includes('R2 binding zerochat_r2 is required')) {
          return 'unsupported' as const
        }

        throw new Error(message)
      }

      if (response.status === 404) {
        const text = await readSyncResponseText(
          response,
          MAX_SYNC_ERROR_BODY_BYTES,
          'Cloud incremental head not-found response',
          signal,
        )
        return text.trim() === 'Not found'
          ? ('unsupported' as const)
          : { generation: readSyncGeneration(response), head: null }
      }

      if (!response.ok) {
        throw new Error(await readSyncError(response, signal))
      }

      return {
        generation: readSyncGeneration(response),
        head: await readSyncResponseJson<unknown>(
          response,
          MAX_SYNC_INCREMENTAL_HEAD_BYTES,
          'Cloud incremental head response',
          signal,
        ),
      }
    },
  )

  if (head === 'unsupported') {
    return head
  }

  if (head.head !== null && !isIncrementalHead(head.head)) {
    throw new Error(rt('error.remoteIncrementalHeadFormat'))
  }

  return {
    generation: head.generation,
    head: head.head,
  }
}

export async function readIncrementalObject(
  endpoint: string,
  token: string,
  key: string,
  signal?: AbortSignal,
): Promise<EncryptedObjectEnvelope> {
  const envelope = await fetchSync(
    `${endpoint}${INCREMENTAL_OBJECT_PATH}/${encodeURIComponent(key)}`,
    {
      headers: {
        authorization: `Bearer ${token}`,
      },
      signal,
    },
    async (response, signal) => {
      if (response.status === 412) {
        throw new IncrementalGenerationConflictError()
      }
      if (!response.ok) {
        throw new Error(await readSyncError(response, signal))
      }

      return readSyncResponseJson<unknown>(
        response,
        MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
        'Cloud incremental object response',
        signal,
      )
    },
  )

  if (!isEncryptedObject(envelope)) {
    throw new Error(rt('error.remoteIncrementalObjectFormat'))
  }

  return envelope
}

export async function writeIncrementalObject(
  endpoint: string,
  token: string,
  key: string,
  envelope: EncryptedObjectEnvelope,
  generation: string,
  signal?: AbortSignal,
): Promise<void> {
  const serialized = JSON.stringify(envelope)
  assertSyncTextSize(
    serialized,
    MAX_SYNC_INCREMENTAL_OBJECT_BYTES,
    'Encrypted incremental sync object',
  )
  await fetchSync(
    `${endpoint}${INCREMENTAL_OBJECT_PATH}/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        [SYNC_GENERATION_HEADER]: generation,
      },
      body: serialized,
      signal,
    },
    async (response, signal) => {
      if (response.status === 412) {
        throw new IncrementalGenerationConflictError()
      }
      if (!response.ok) {
        throw new Error(await readSyncError(response, signal))
      }
    },
  )
}

export async function deleteIncrementalObject(
  endpoint: string,
  token: string,
  key: string,
  generation: string,
  signal?: AbortSignal,
): Promise<void> {
  await fetchSync(
    `${endpoint}${INCREMENTAL_OBJECT_PATH}/${encodeURIComponent(key)}`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        [SYNC_GENERATION_HEADER]: generation,
      },
      signal,
    },
    async (response, signal) => {
      if (response.status === 412) {
        throw new IncrementalGenerationConflictError()
      }
      if (!response.ok && response.status !== 404) {
        throw new Error(await readSyncError(response, signal))
      }
    },
  )
}

export async function deleteIncrementalHead(
  endpoint: string,
  token: string,
  generation: string,
  signal?: AbortSignal,
): Promise<void> {
  await fetchSync(
    `${endpoint}${INCREMENTAL_HEAD_PATH}`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        [SYNC_GENERATION_HEADER]: generation,
      },
      signal,
    },
    async (response, signal) => {
      if (response.status === 412) {
        throw new IncrementalGenerationConflictError()
      }
      if (!response.ok && response.status !== 404) {
        throw new Error(await readSyncError(response, signal))
      }
    },
  )
}

export async function writeIncrementalHead(
  endpoint: string,
  token: string,
  head: IncrementalSyncHead,
  previousHead: IncrementalSyncHead | null,
  generation: string,
  signal?: AbortSignal,
): Promise<void> {
  const serialized = JSON.stringify(head)
  assertSyncTextSize(
    serialized,
    MAX_SYNC_INCREMENTAL_HEAD_BYTES,
    'Incremental sync head',
  )
  await fetchSync(
    `${endpoint}${INCREMENTAL_HEAD_PATH}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        [SYNC_GENERATION_HEADER]: generation,
        ...(previousHead
          ? { 'if-match': `"${previousHead.manifestKey}"` }
          : { 'if-none-match': '*' }),
      },
      body: serialized,
      signal,
    },
    async (response, signal) => {
      if (response.status === 409) {
        throw new IncrementalHeadConflictError()
      }
      if (response.status === 412) {
        throw new IncrementalGenerationConflictError()
      }

      if (!response.ok) {
        throw new Error(await readSyncError(response, signal))
      }
    },
  )
}

export async function deleteLegacySnapshot(
  endpoint: string,
  token: string,
  generation: string | undefined,
  signal?: AbortSignal,
): Promise<void> {
  await fetchSync(
    `${endpoint}/snapshot`,
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${token}`,
        ...(generation ? { [SYNC_GENERATION_HEADER]: generation } : {}),
      },
      signal,
    },
    async (response, signal) => {
      if (response.status === 412) {
        throw new IncrementalGenerationConflictError()
      }
      if (!response.ok && response.status !== 404 && response.status !== 405) {
        throw new Error(await readSyncError(response, signal))
      }
    },
  )
}

export async function readIncrementalManifest(
  endpoint: string,
  token: string,
  passphrase: string,
  head: IncrementalSyncHead,
  signal?: AbortSignal,
): Promise<IncrementalManifest> {
  const envelope = await readIncrementalObject(
    endpoint,
    token,
    head.manifestKey,
    signal,
  )
  const manifest = await decryptObject<IncrementalManifest>(
    envelope,
    passphrase,
    'manifest',
  )

  if (!isIncrementalManifest(manifest) || manifest.updatedAt !== head.updatedAt) {
    throw new Error(rt('error.remoteIncrementalManifestFormat'))
  }

  return manifest
}

export async function readIncrementalRemoteState(
  endpoint: string,
  token: string,
  passphrase: string,
  head: IncrementalSyncHead,
  signal?: AbortSignal,
): Promise<IncrementalRemoteState> {
  return {
    head,
    manifest: await readIncrementalManifest(
      endpoint,
      token,
      passphrase,
      head,
      signal,
    ),
  }
}
