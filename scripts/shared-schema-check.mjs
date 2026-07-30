import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const failures = []
const capabilityModelFields = [
  'audioSpeechModel',
  'audioTranscriptionModel',
  'embeddingModel',
  'moderationModel',
  'realtimeModel',
]

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    failures.push(`Unable to read JSON ${path}: ${error.message}`)
    return null
  }
}

async function readText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    failures.push(`Unable to read ${path}: ${error.message}`)
    return ''
  }
}

function assert(condition, message) {
  if (!condition) {
    failures.push(message)
  }
}

function objectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? Object.keys(value)
    : []
}

function schemaProperties(schema, path) {
  const properties = path.reduce((node, segment) => node?.[segment], schema)
  return properties && typeof properties === 'object' ? properties : {}
}

function requireSchemaAllowsExampleObject(schemaPropertiesMap, example, label) {
  const allowed = new Set(Object.keys(schemaPropertiesMap))

  for (const key of objectKeys(example)) {
    assert(allowed.has(key), `${label} example field ${key} is not allowed by the shared schema.`)
  }
}

function requireSchemaRequiredFields(required, example, label) {
  for (const key of required ?? []) {
    assert(
      Object.hasOwn(example, key),
      `${label} example is missing required shared schema field ${key}.`,
    )
  }
}

function requireStringSchema(properties, field, label) {
  assert(
    properties[field]?.type === 'string',
    `${label}.${field} must be a string field in the shared schema.`,
  )
}

function canonicalJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalJsonValue)
  }

  if (!value || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalJsonValue(value[key])]),
  )
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

const snapshotSchema = await readJson('shared/snapshot.schema.json')
const syncVaultSchema = await readJson('shared/sync-vault.schema.json')
const encryptedSnapshotSchema = await readJson('shared/encrypted-snapshot.schema.json')
const encryptedObjectSchema = await readJson('shared/encrypted-object.schema.json')
const snapshotExample = await readJson('shared/examples/snapshot.v1.json')
const syncVaultExample = await readJson('shared/examples/sync-vault.v1.json')
const encryptedSnapshotExample = await readJson('shared/examples/encrypted-snapshot.v1.json')
const encryptedObjectExample = await readJson('shared/examples/encrypted-object.v1.json')
const gistOperationVectors = await readJson(
  'shared/examples/gist-operation-v2-vectors.json',
)
const gistSyncContract = await readText('shared/gist-sync-v2.md')
const sharedReadme = await readText('shared/README.md')
const aiProviderContract = await readText('shared/ai-provider-contract.md')
const platformDocs = await readText('docs/PLATFORMS.md')
const packageJson = await readJson('package.json')

if (snapshotSchema && snapshotExample) {
  requireSchemaAllowsExampleObject(snapshotSchema.properties, snapshotExample, 'snapshot root')
  requireSchemaRequiredFields(snapshotSchema.required, snapshotExample, 'snapshot root')

  const providerDef = snapshotSchema.$defs?.provider ?? {}
  const providerProperties = providerDef.properties ?? {}
  const providerExample = snapshotExample.providers?.[0] ?? {}

  requireSchemaAllowsExampleObject(providerProperties, providerExample, 'provider')
  requireSchemaRequiredFields(providerDef.required, providerExample, 'provider')

  for (const field of capabilityModelFields) {
    requireStringSchema(providerProperties, field, 'provider')
    assert(
      providerExample[field],
      `shared/examples/snapshot.v1.json must include provider.${field}.`,
    )
    assert(
      providerExample.models?.includes(providerExample[field]),
      `provider.${field} must be present in the shared provider model list example.`,
    )
    assert(
      aiProviderContract.includes(`| \`${field}\` |`),
      `shared/ai-provider-contract.md must document provider.${field}.`,
    )
    assert(
      platformDocs.includes(`\`${field}\``),
      `docs/PLATFORMS.md must name provider.${field} in the native shared contract baseline.`,
    )
  }

  const capabilityEnum = new Set(providerProperties.capabilities?.items?.enum ?? [])

  for (const capability of providerExample.capabilities ?? []) {
    assert(
      capabilityEnum.has(capability),
      `provider capability example ${capability} is not allowed by the shared schema.`,
    )
  }

  for (const capability of ['audio', 'embeddings', 'moderation', 'realtime']) {
    assert(
      providerExample.capabilities?.includes(capability),
      `shared/examples/snapshot.v1.json must include provider capability ${capability}.`,
    )
  }

  const messageDef = snapshotSchema.$defs?.message ?? {}
  const messageStatusEnum = messageDef.properties?.status?.enum ?? []
  assert(
    messageStatusEnum.includes('queued'),
    'shared/snapshot.schema.json must allow queued message status for offline text persistence.',
  )
  assert(
    messageDef.properties?.queuedTextRequest?.$ref === '#/$defs/queuedTextRequest' &&
      snapshotSchema.$defs?.queuedTextRequest?.required?.includes('providerId') &&
      snapshotSchema.$defs?.queuedTextRequest?.required?.includes('model') &&
      !snapshotSchema.$defs?.queuedTextRequest?.required?.includes('promptMessageId') &&
      snapshotSchema.$defs?.queuedTextRequest?.properties?.promptMessageId?.type === 'string' &&
      snapshotSchema.$defs?.queuedTextRequest?.properties?.promptMessageId?.minLength === 1,
    'shared/snapshot.schema.json must preserve provider/model selection and an optional non-empty prompt identity for each queued text request.',
  )

  const skillChunkDef = snapshotSchema.$defs?.skillChunk ?? {}
  const skillChunkProperties = skillChunkDef.properties ?? {}
  assert(
    !skillChunkDef.required?.includes('content'),
    'shared/snapshot.schema.json skillChunk must not require inline content when contentRef is used.',
  )
  requireStringSchema(skillChunkProperties, 'contentRef', 'skillChunk')
  requireStringSchema(skillChunkProperties, 'contentPreview', 'skillChunk')
}

if (syncVaultSchema && syncVaultExample && snapshotSchema) {
  requireSchemaAllowsExampleObject(syncVaultSchema.properties, syncVaultExample, 'sync vault root')
  requireSchemaRequiredFields(syncVaultSchema.required, syncVaultExample, 'sync vault root')
  requireSchemaAllowsExampleObject(snapshotSchema.properties, syncVaultExample.data, 'sync vault data')
  requireSchemaRequiredFields(snapshotSchema.required, syncVaultExample.data, 'sync vault data')

  const secretsProperties = schemaProperties(syncVaultSchema, [
    'properties',
    'secrets',
    'properties',
  ])
  requireSchemaAllowsExampleObject(secretsProperties, syncVaultExample.secrets, 'sync vault secrets')
  requireSchemaRequiredFields(
    syncVaultSchema.properties?.secrets?.required,
    syncVaultExample.secrets,
    'sync vault secrets',
  )
  assert(
    syncVaultExample.secrets?.providerKeys &&
      typeof syncVaultExample.secrets.providerKeys === 'object' &&
      !Array.isArray(syncVaultExample.secrets.providerKeys),
    'shared/examples/sync-vault.v1.json must include a providerKeys object.',
  )
}

if (encryptedSnapshotSchema && encryptedSnapshotExample) {
  requireSchemaAllowsExampleObject(
    encryptedSnapshotSchema.properties,
    encryptedSnapshotExample,
    'encrypted snapshot root',
  )
  requireSchemaRequiredFields(
    encryptedSnapshotSchema.required,
    encryptedSnapshotExample,
    'encrypted snapshot root',
  )

  const cryptoProperties = schemaProperties(encryptedSnapshotSchema, [
    'properties',
    'crypto',
    'properties',
  ])
  requireSchemaAllowsExampleObject(
    cryptoProperties,
    encryptedSnapshotExample.crypto,
    'encrypted snapshot crypto',
  )
  requireSchemaRequiredFields(
    encryptedSnapshotSchema.properties?.crypto?.required,
    encryptedSnapshotExample.crypto,
    'encrypted snapshot crypto',
  )
}

if (encryptedObjectSchema && encryptedObjectExample) {
  requireSchemaAllowsExampleObject(
    encryptedObjectSchema.properties,
    encryptedObjectExample,
    'encrypted object root',
  )
  requireSchemaRequiredFields(
    encryptedObjectSchema.required,
    encryptedObjectExample,
    'encrypted object root',
  )
  assert(
    encryptedObjectExample.kind === encryptedObjectSchema.properties?.kind?.const,
    'shared/examples/encrypted-object.v1.json must use the encrypted object kind.',
  )
  assert(
    encryptedObjectExample.objectType === 'manifest',
    'shared/examples/encrypted-object.v1.json must use a manifest objectType example.',
  )

  const cryptoProperties = schemaProperties(encryptedObjectSchema, [
    'properties',
    'crypto',
    'properties',
  ])
  requireSchemaAllowsExampleObject(
    cryptoProperties,
    encryptedObjectExample.crypto,
    'encrypted object crypto',
  )
  requireSchemaRequiredFields(
    encryptedObjectSchema.properties?.crypto?.required,
    encryptedObjectExample.crypto,
    'encrypted object crypto',
  )
  assert(
    encryptedObjectSchema.properties?.crypto?.properties?.compression?.enum?.includes(
      encryptedObjectExample.crypto?.compression,
    ),
    'shared/examples/encrypted-object.v1.json must use an allowed compression value.',
  )
}

if (gistOperationVectors) {
  assert(
    gistOperationVectors.schema === 'zerochat.gistOperationVectors.v1',
    'Gist operation vectors must use the shared vector schema identifier.',
  )

  for (const name of ['clear', 'state']) {
    const vector = gistOperationVectors[name]
    const canonicalJson = JSON.stringify(canonicalJsonValue(vector?.core))
    const operationId = sha256(canonicalJson)

    assert(
      vector?.canonicalJson === canonicalJson,
      `Gist ${name} canonical JSON does not match its core object.`,
    )
    assert(
      vector?.operationId === operationId,
      `Gist ${name} operation ID does not match its canonical JSON SHA-256.`,
    )
    assert(
      vector?.fileName ===
        `${gistOperationVectors.baseFileName}.zerochat-op-${operationId}.json`,
      `Gist ${name} filename does not match its operation ID.`,
    )
  }

  const normalizationInput = gistOperationVectors.normalization?.input
  const normalizedVault = gistOperationVectors.normalization?.normalized
  const inputProvider = normalizationInput?.data?.providers?.[0]
  const normalizedProvider = normalizedVault?.data?.providers?.[0]
  const inputMessage = normalizationInput?.data?.conversations?.[0]?.messages?.[0]
  const normalizedMessage = normalizedVault?.data?.conversations?.[0]?.messages?.[0]
  const inputChunk = normalizationInput?.data?.skills?.[0]?.chunks?.[0]
  const normalizedChunk = normalizedVault?.data?.skills?.[0]?.chunks?.[0]
  const normalizedSync = normalizedVault?.data?.sync
  const normalizedPreferences = normalizedVault?.data?.preferences

  assert(
    inputProvider?.clientRequestMode === false &&
      inputProvider?.custom === false &&
      inputProvider?.models?.length === 0 &&
      inputProvider?.capabilities?.length === 0 &&
      !Object.hasOwn(normalizedProvider ?? {}, 'clientRequestMode') &&
      !Object.hasOwn(normalizedProvider ?? {}, 'custom') &&
      !Object.hasOwn(normalizedProvider ?? {}, 'models') &&
      !Object.hasOwn(normalizedProvider ?? {}, 'capabilities'),
    'Gist normalization vectors must remove explicit provider defaults.',
  )
  assert(
    inputMessage?.status === 'done' &&
      inputMessage?.attachments?.length === 0 &&
      !Object.hasOwn(normalizedMessage ?? {}, 'status') &&
      !Object.hasOwn(normalizedMessage ?? {}, 'attachments') &&
      inputChunk?.content === '' &&
      !Object.hasOwn(normalizedChunk ?? {}, 'content'),
    'Gist normalization vectors must remove message and skill-chunk defaults.',
  )
  assert(
    normalizedSync?.encryptionEnabled === true &&
      !Object.hasOwn(normalizedSync ?? {}, 'gistId') &&
      !Object.hasOwn(normalizedSync ?? {}, 'gistFile') &&
      !Object.hasOwn(normalizedSync ?? {}, 'lastSyncAt') &&
      !Object.hasOwn(normalizedSync ?? {}, 'lastSyncStatus') &&
      !Object.hasOwn(normalizedPreferences ?? {}, 'chatContextMessageLimit') &&
      !Object.hasOwn(normalizedPreferences ?? {}, 'dismissedDangerWarnings') &&
      !Object.hasOwn(normalizedPreferences ?? {}, 'dismissedFeatureHints'),
    'Gist normalization vectors must remove sync metadata and preference defaults.',
  )

  assert(
    gistSyncContract.includes('RFC 8785') &&
      gistSyncContract.includes('UTF-16 code unit order') &&
      gistSyncContract.includes('must never use a\nlocale-sensitive collation API') &&
      gistSyncContract.includes('Readers must reject unknown or missing operation-core fields') &&
      gistSyncContract.includes('preferences.chatContextMessageLimit') &&
      gistSyncContract.includes('descending `updatedAt`, then UTF-16 `id`') &&
      gistSyncContract.includes('Normal state publication also compacts observed history'),
    'shared/gist-sync-v2.md must define JCS serialization and locale-independent sorting.',
  )
  assert(
    sharedReadme.includes('gist-sync-v2.md') &&
      sharedReadme.includes('gist-operation-v2-vectors.json'),
    'shared/README.md must index the Gist v2 contract and golden vectors.',
  )
}

assert(
  packageJson?.scripts?.['check:shared-schema'] === 'node scripts/shared-schema-check.mjs',
  'package.json must expose check:shared-schema for shared contract validation.',
)

if (failures.length) {
  throw new Error(`Shared schema checks failed:\n- ${failures.join('\n- ')}`)
}

console.log('Shared schema checks passed')
