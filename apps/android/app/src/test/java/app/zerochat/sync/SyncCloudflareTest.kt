package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.EncryptedObjectEnvelope
import app.zerochat.data.EncryptedSnapshotEnvelope
import app.zerochat.data.EnvelopeCrypto
import app.zerochat.data.IncrementalManifest
import app.zerochat.data.IncrementalSyncHead
import app.zerochat.data.ObjectEnvelopeCrypto
import app.zerochat.data.SyncVault
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.encodedPath
import io.ktor.http.headersOf
import io.ktor.utils.io.ByteReadChannel
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import io.mockk.every
import io.mockk.mockk
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncCloudflareTest {
    @Test
    fun normalizeWorkerEndpointAllowsHttpsAndLoopbackDebuggingOnly() {
        assertEquals(
            "https://zerochat.example.workers.dev",
            normalizeWorkerEndpoint(" https://zerochat.example.workers.dev/ "),
        )
        assertEquals(
            "http://127.0.0.1:8787",
            normalizeWorkerEndpoint("http://127.0.0.1:8787/"),
        )
        assertEquals(
            "http://10.0.2.2:8787",
            normalizeWorkerEndpoint("http://10.0.2.2:8787"),
        )
    }

    @Test
    fun normalizeWorkerEndpointRejectsCredentialedQueryFragmentAndRemoteHttpUrls() {
        assertThrows(IllegalArgumentException::class.java) {
            normalizeWorkerEndpoint("https://user:pass@example.workers.dev")
        }
        assertThrows(IllegalArgumentException::class.java) {
            normalizeWorkerEndpoint("https://example.workers.dev?debug=true")
        }
        assertThrows(IllegalArgumentException::class.java) {
            normalizeWorkerEndpoint("https://example.workers.dev/#frag")
        }
        assertThrows(IllegalArgumentException::class.java) {
            normalizeWorkerEndpoint("http://example.workers.dev")
        }
    }

    @Test
    fun readSnapshotEnvelopeDrainsNotFoundBodyBeforeFallbackUpload() = runBlocking {
        val notFoundBody = ByteReadChannel("legacy snapshot missing")
        val client = HttpClient(
            MockEngine {
                respond(
                    content = notFoundBody,
                    status = HttpStatusCode.NotFound,
                    headers = generationHeaders(HttpHeaders.ContentType to "text/plain"),
                )
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        val envelope = transport.readSnapshotEnvelope("https://zerochat.example.workers.dev", "access-key")

        assertEquals(LegacySnapshotRead.Missing(TEST_GENERATION), envelope)
        assertTrue(notFoundBody.isClosedForRead, "404 snapshot body must be drained before upload fallback continues.")
    }

    @Test
    fun readSnapshotEnvelopeAcceptsOnlyCanonicalStrongSnapshotEtag() = runBlocking {
        val envelope = snapshotEnvelope(updatedAt = 100)
        val serialized = Json.encodeToString(EncryptedSnapshotEnvelope.serializer(), envelope)
        val etag = "\"snapshot-sha256-${"a".repeat(64)}\""
        val client = HttpClient(
            MockEngine {
                respond(
                    content = serialized,
                    status = HttpStatusCode.OK,
                    headers = generationHeaders(HttpHeaders.ETag to etag),
                )
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        val read = transport.readSnapshotEnvelope("https://zerochat.example.workers.dev", "access-key")

        assertEquals(LegacySnapshotRead.Found(envelope, etag, TEST_GENERATION), read)
    }

    @Test
    fun headAndSnapshotReadsRejectMissingOrMalformedSyncGeneration() {
        val head = Json.encodeToString(
            IncrementalSyncHead.serializer(),
            IncrementalSyncHead(
                manifestKey = "manifest-11111111-1111-4111-8111-111111111111.json",
                updatedAt = 100,
            ),
        )
        val invalidGenerations = listOf(
            null,
            "11111111-1111-3111-8111-111111111111",
            "11111111-1111-4111-7111-111111111111",
            " $TEST_GENERATION",
        )
        val reads = listOf(
            Triple("/sync/head", HttpStatusCode.OK, head),
            Triple("/sync/head", HttpStatusCode.NotFound, ""),
            Triple("/snapshot", HttpStatusCode.OK, "{}"),
            Triple("/snapshot", HttpStatusCode.NotFound, ""),
        )

        for ((path, status, body) in reads) {
            for (generation in invalidGenerations) {
                val responseBody = ByteReadChannel(body)
                val etag = "\"snapshot-sha256-${"a".repeat(64)}\""
                val client = HttpClient(
                    MockEngine {
                        respond(
                            content = responseBody,
                            status = status,
                            headers = headersWithGeneration(
                                generation,
                                *(if (path == "/snapshot" && status == HttpStatusCode.OK) {
                                    arrayOf(HttpHeaders.ETag to etag)
                                } else {
                                    emptyArray()
                                }),
                            ),
                        )
                    },
                )
                val transport = CloudflareSyncTransport(client, CryptoEngine())

                val error = assertThrows(IllegalStateException::class.java) {
                    runBlocking {
                        if (path == "/sync/head") {
                            transport.readIncrementalHead("https://zerochat.example.workers.dev", "access-key")
                        } else {
                            transport.readSnapshotEnvelope("https://zerochat.example.workers.dev", "access-key")
                        }
                    }
                }

                assertEquals("Remote sync generation is invalid.", error.message)
                assertTrue(responseBody.isClosedForRead, "Invalid generation responses must be drained.")
                client.close()
            }
        }
    }

    @Test
    fun incrementalHeadReadReturnsValidatedGeneration() = runBlocking {
        val head = IncrementalSyncHead(
            manifestKey = "manifest-11111111-1111-4111-8111-111111111111.json",
            updatedAt = 100,
        )
        val client = HttpClient(
            MockEngine {
                respond(
                    Json.encodeToString(IncrementalSyncHead.serializer(), head),
                    HttpStatusCode.OK,
                    generationHeaders(),
                )
            },
        )

        val read = CloudflareSyncTransport(client, CryptoEngine()).readIncrementalHead(
            "https://zerochat.example.workers.dev",
            "access-key",
        )

        assertEquals(IncrementalHeadRead.Head(head, TEST_GENERATION), read)
    }

    @Test
    fun readSnapshotEnvelopeFailsClosedForMissingWeakOrMalformedEtag() {
        val invalidEtags = listOf(
            null,
            "W/\"snapshot-sha256-${"a".repeat(64)}\"",
            "\"snapshot-sha256-short\"",
            "\"snapshot-md5-${"a".repeat(64)}\"",
        )

        invalidEtags.forEach { etag ->
            val client = HttpClient(
                MockEngine {
                    respond(
                        content = "{}",
                        status = HttpStatusCode.OK,
                        headers = etag?.let { headersOf(HttpHeaders.ETag, it) } ?: headersOf(),
                    )
                },
            )
            val transport = CloudflareSyncTransport(client, CryptoEngine())

            val error = assertThrows(IllegalStateException::class.java) {
                runBlocking {
                    transport.readSnapshotEnvelope("https://zerochat.example.workers.dev", "access-key")
                }
            }

            assertEquals("Remote snapshot has invalid strong ETag.", error.message)
            client.close()
        }
    }

    @Test
    fun readSnapshotEnvelopeReportsWorkerErrorBody() {
        val client = HttpClient(
            MockEngine {
                respondError(HttpStatusCode.Forbidden, "bad access key")
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        val error = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                transport.readSnapshotEnvelope("https://zerochat.example.workers.dev", "access-key")
            }
        }

        assertEquals("bad access key", error.message)
    }

    @Test
    fun readSnapshotEnvelopeCancelsChunkedBodiesPastTheSafetyLimit() {
        val oversizedBody = ByteReadChannel("x".repeat(MAX_SYNC_SNAPSHOT_BYTES + 1))
        val client = HttpClient(
            MockEngine {
                respond(
                    content = oversizedBody,
                    status = HttpStatusCode.OK,
                    headers = generationHeaders(
                        HttpHeaders.ETag to "\"snapshot-sha256-${"a".repeat(64)}\"",
                    ),
                )
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        val error = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                transport.readSnapshotEnvelope("https://zerochat.example.workers.dev", "access-key")
            }
        }

        assertEquals(
            "Cloud sync snapshot response exceeded the 900000-byte safety limit.",
            error.message,
        )
        assertTrue(oversizedBody.isClosedForRead, "Oversized response channels must be cancelled immediately.")
    }

    @Test
    fun clearRemoteValidatesRotatedGenerationAndDrainsSuccessBody() = runBlocking {
        val successBody = ByteReadChannel("{\"cleared\":true}")
        val client = HttpClient(
            MockEngine { request ->
                assertEquals(HttpMethod.Delete, request.method)
                assertEquals("/sync/clear", request.url.encodedPath)
                assertNull(request.headers[TEST_GENERATION_HEADER])
                respond(
                    content = successBody,
                    status = HttpStatusCode.OK,
                    headers = generationHeaders(HttpHeaders.ContentType to "application/json"),
                )
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        transport.clearRemote("https://zerochat.example.workers.dev", "access-key")

        assertTrue(successBody.isClosedForRead, "Successful clear responses must be drained.")
    }

    @Test
    fun clearRemoteRejectsSuccessWithoutRotatedGeneration() {
        val successBody = ByteReadChannel("{\"cleared\":true}")
        val client = HttpClient(
            MockEngine {
                respond(
                    content = successBody,
                    status = HttpStatusCode.OK,
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        val error = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                transport.clearRemote("https://zerochat.example.workers.dev", "access-key")
            }
        }

        assertEquals("Remote sync generation is invalid.", error.message)
        assertTrue(successBody.isClosedForRead, "Invalid clear responses must be drained before failing.")
    }

    @Test
    fun clearRemoteDrainsBulkFallbackAndLegacyDeleteBodies() = runBlocking {
        val bulkFallbackBody = ByteReadChannel("bulk clear unsupported")
        val headReadBody = ByteReadChannel("head already empty")
        val headDeleteBody = ByteReadChannel("head already empty")
        val snapshotMissingBody = ByteReadChannel("snapshot already empty")
        val calls = mutableListOf<String>()
        val client = HttpClient(
            MockEngine { request ->
                calls += "${request.method.value} ${request.url.encodedPath}"
                when {
                    request.url.encodedPath == "/sync/clear" -> {
                        assertNull(request.headers[TEST_GENERATION_HEADER])
                        respond(
                            content = bulkFallbackBody,
                            status = HttpStatusCode.MethodNotAllowed,
                            headers = headersOf(HttpHeaders.ContentType, "text/plain"),
                        )
                    }
                    request.method == HttpMethod.Get && request.url.encodedPath == "/sync/head" -> respond(
                        content = headReadBody,
                        status = HttpStatusCode.NotFound,
                        headers = generationHeaders(HttpHeaders.ContentType to "text/plain"),
                    )
                    request.method == HttpMethod.Delete && request.url.encodedPath == "/sync/head" -> {
                        assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                        respond(
                            content = headDeleteBody,
                            status = HttpStatusCode.NotFound,
                            headers = headersOf(HttpHeaders.ContentType, "text/plain"),
                        )
                    }
                    request.method == HttpMethod.Delete && request.url.encodedPath == "/snapshot" -> {
                        assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                        respond(
                            content = snapshotMissingBody,
                            status = HttpStatusCode.NotFound,
                            headers = headersOf(HttpHeaders.ContentType, "text/plain"),
                        )
                    }
                    else -> respondError(HttpStatusCode.NotFound)
                }
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        transport.clearRemote("https://zerochat.example.workers.dev", "access-key")

        assertEquals(
            listOf("DELETE /sync/clear", "GET /sync/head", "DELETE /sync/head", "DELETE /snapshot"),
            calls,
        )
        assertTrue(
            bulkFallbackBody.isClosedForRead,
            "Clear-cloud bulk fallback body must be drained before legacy cleanup starts.",
        )
        assertTrue(headReadBody.isClosedForRead, "Missing incremental head read body must be drained during cleanup.")
        assertTrue(headDeleteBody.isClosedForRead, "Missing incremental head delete body must be drained during cleanup.")
        assertTrue(snapshotMissingBody.isClosedForRead, "Missing legacy snapshot body must be drained during cleanup.")
    }

    @Test
    fun deleteIncrementalObjectDrainsMissingObjectBody() = runBlocking {
        val missingObjectBody = ByteReadChannel("chunk already gone")
        val client = HttpClient(
            MockEngine { request ->
                assertEquals(HttpMethod.Delete, request.method)
                assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                respond(
                    content = missingObjectBody,
                    status = HttpStatusCode.NotFound,
                    headers = headersOf(HttpHeaders.ContentType, "text/plain"),
                )
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        transport.deleteIncrementalObject(
            "https://zerochat.example.workers.dev",
            "access-key",
            "chunk-1",
            TEST_GENERATION,
        )

        assertTrue(
            missingObjectBody.isClosedForRead,
            "Missing incremental object body must be drained during rollback cleanup.",
        )
    }

    @Test
    fun incrementalObjectMutationConflictsFailClosed() {
        for (status in syncConflictStatuses()) {
            for (method in listOf(HttpMethod.Put, HttpMethod.Delete)) {
                val conflictBody = ByteReadChannel("sync generation changed")
                val client = HttpClient(
                    MockEngine { request ->
                        assertEquals(method, request.method)
                        assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                        respond(conflictBody, status)
                    },
                )
                val transport = CloudflareSyncTransport(client, CryptoEngine())

                val error = assertThrows(CloudflareGenerationConflictException::class.java) {
                    runBlocking {
                        if (method == HttpMethod.Put) {
                            transport.writeIncrementalObject(
                                "https://zerochat.example.workers.dev",
                                "access-key",
                                "chunk-1",
                                encryptedEnvelope("conversationChunk:conversation-1:0", 100),
                                TEST_GENERATION,
                            )
                        } else {
                            transport.deleteIncrementalObject(
                                "https://zerochat.example.workers.dev",
                                "access-key",
                                "chunk-1",
                                TEST_GENERATION,
                            )
                        }
                    }
                }

                assertEquals("Cloud data changed. Pull again before uploading.", error.message)
                assertTrue(conflictBody.isClosedForRead)
                client.close()
            }
        }
    }

    @Test
    fun legacySnapshotFirstPublishUsesCreateOnlyCondition() = runBlocking {
        var ifNoneMatch: String? = null
        var ifMatch: String? = null
        val client = HttpClient(
            MockEngine { request ->
                ifNoneMatch = request.headers[HttpHeaders.IfNoneMatch]
                ifMatch = request.headers[HttpHeaders.IfMatch]
                assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                respond("")
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        transport.writeSnapshotEnvelope(
            endpoint = "https://zerochat.example.workers.dev",
            token = "access-key",
            envelope = snapshotEnvelope(updatedAt = 200),
            previousEtag = null,
            generation = TEST_GENERATION,
        )

        assertEquals("*", ifNoneMatch)
        assertNull(ifMatch)
    }

    @Test
    fun legacySnapshotReplacementUsesExactlyTheEtagReadFromGet() = runBlocking {
        val etag = "\"snapshot-sha256-${"b".repeat(64)}\""
        var ifNoneMatch: String? = null
        var ifMatch: String? = null
        val client = HttpClient(
            MockEngine { request ->
                ifNoneMatch = request.headers[HttpHeaders.IfNoneMatch]
                ifMatch = request.headers[HttpHeaders.IfMatch]
                assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                respond("")
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        transport.writeSnapshotEnvelope(
            endpoint = "https://zerochat.example.workers.dev",
            token = "access-key",
            envelope = snapshotEnvelope(updatedAt = 200),
            previousEtag = etag,
            generation = TEST_GENERATION,
        )

        assertNull(ifNoneMatch)
        assertEquals(etag, ifMatch)
    }

    @Test
    fun successfulCloudflareWritesDrainResponseBodies() = runBlocking {
        val responseBodies = mutableListOf<ByteReadChannel>()
        val client = HttpClient(
            MockEngine {
                val body = ByteReadChannel("ok")
                responseBodies += body
                respond(body, HttpStatusCode.OK)
            },
        )
        val transport = CloudflareSyncTransport(client, CryptoEngine())

        transport.writeSnapshotEnvelope(
            endpoint = "https://zerochat.example.workers.dev",
            token = "access-key",
            envelope = snapshotEnvelope(updatedAt = 200),
            previousEtag = null,
            generation = TEST_GENERATION,
        )
        transport.writeIncrementalObject(
            endpoint = "https://zerochat.example.workers.dev",
            token = "access-key",
            key = "chunk-1",
            envelope = encryptedEnvelope("conversationChunk:conversation-1:0", 100),
            generation = TEST_GENERATION,
        )
        transport.writeIncrementalHead(
            endpoint = "https://zerochat.example.workers.dev",
            token = "access-key",
            head = IncrementalSyncHead(
                manifestKey = "manifest-22222222-2222-2222-2222-222222222222.json",
                updatedAt = 100,
            ),
            previousManifestKey = null,
            generation = TEST_GENERATION,
        )

        assertEquals(3, responseBodies.size)
        assertTrue(responseBodies.all { it.isClosedForRead })
        client.close()
    }

    @Test
    fun legacySnapshotConflictStatusesAreReportedAsRemoteUpdated() {
        syncConflictStatuses().forEach { status ->
            val conflictBody = ByteReadChannel("snapshot changed")
            val client = HttpClient(
                MockEngine {
                    respond(
                        content = conflictBody,
                        status = status,
                    )
                },
            )
            val transport = CloudflareSyncTransport(client, CryptoEngine())

            val error = assertThrows(CloudflareSnapshotConflictException::class.java) {
                runBlocking {
                    transport.writeSnapshotEnvelope(
                        endpoint = "https://zerochat.example.workers.dev",
                        token = "access-key",
                        envelope = snapshotEnvelope(updatedAt = 200),
                        previousEtag = "\"snapshot-sha256-${"c".repeat(64)}\"",
                        generation = TEST_GENERATION,
                    )
                }
            }

            assertEquals("Cloud data changed. Pull again before uploading.", error.message)
            assertTrue(conflictBody.isClosedForRead, "Conflict response bodies must be drained.")
            client.close()
        }
    }

    @Test
    fun staleGenerationOnSnapshotDeleteIsReportedAsRemoteUpdated() {
        for (status in syncConflictStatuses()) {
            val conflictBody = ByteReadChannel("sync generation changed")
            val client = HttpClient(
                MockEngine { request ->
                    assertEquals(HttpMethod.Delete, request.method)
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    respond(conflictBody, status)
                },
            )
            val transport = CloudflareSyncTransport(client, CryptoEngine())

            assertThrows(CloudflareSnapshotConflictException::class.java) {
                runBlocking {
                    transport.deleteLegacySnapshot(
                        "https://zerochat.example.workers.dev",
                        "access-key",
                        TEST_GENERATION,
                    )
                }
            }
            assertTrue(conflictBody.isClosedForRead)
            client.close()
        }
    }

    @Test
    fun syncClientCarriesLegacySnapshotEtagIntoConditionalPut() {
        val local = snapshotEnvelope(updatedAt = 200)
        val remote = snapshotEnvelope(updatedAt = 100)
        val etag = "\"snapshot-sha256-${"d".repeat(64)}\""
        val remoteJson = Json.encodeToString(EncryptedSnapshotEnvelope.serializer(), remote)
        var snapshotPuts = 0
        val engine = MockEngine { request ->
            when {
                request.method == HttpMethod.Get && request.url.encodedPath == "/sync/head" ->
                    respond("Unsupported", HttpStatusCode.NotImplemented)
                request.method == HttpMethod.Get && request.url.encodedPath == "/snapshot" ->
                    respond(remoteJson, HttpStatusCode.OK, generationHeaders(HttpHeaders.ETag to etag))
                request.method == HttpMethod.Put && request.url.encodedPath == "/snapshot" -> {
                    snapshotPuts += 1
                    assertEquals(etag, request.headers[HttpHeaders.IfMatch])
                    assertNull(request.headers[HttpHeaders.IfNoneMatch])
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    respond("snapshot changed", HttpStatusCode.Conflict)
                }
                else -> error("Unexpected request: ${request.method.value} ${request.url.encodedPath}")
            }
        }

        val error = assertThrows(CloudflareSnapshotConflictException::class.java) {
            runBlocking {
                SyncClient(providedEngine = engine).use { sync ->
                    sync.syncCloudflare(
                        envelope = local,
                        workerEndpoint = "https://zerochat.example.workers.dev",
                        token = "access-key",
                        hasCompletedSync = true,
                    )
                }
            }
        }

        assertEquals("Cloud data changed. Pull again before uploading.", error.message)
        assertEquals(1, snapshotPuts)
        assertEquals(200, local.updatedAt, "A conflict must leave the caller's local snapshot untouched.")
    }

    @Test
    fun syncVaultCarriesLegacySnapshotEtagIntoConditionalPut() = runBlocking {
        val passphrase = "test-passphrase"
        val crypto = mockk<CryptoEngine>()
        val local = SyncVault(data = AppSnapshot(updatedAt = 200))
        val remote = SyncVault(data = AppSnapshot(updatedAt = 100))
        val remoteEnvelope = snapshotEnvelope(updatedAt = 100)
        every { crypto.decryptVault(remoteEnvelope, passphrase) } returns remote
        every { crypto.encryptVault(local, passphrase) } returns snapshotEnvelope(updatedAt = 200)
        val remoteJson = Json.encodeToString(
            EncryptedSnapshotEnvelope.serializer(),
            remoteEnvelope,
        )
        val etag = "\"snapshot-sha256-${"e".repeat(64)}\""
        var snapshotPuts = 0
        val engine = MockEngine { request ->
            when {
                request.method == HttpMethod.Get && request.url.encodedPath == "/sync/head" ->
                    respond("Unsupported", HttpStatusCode.NotImplemented)
                request.method == HttpMethod.Get && request.url.encodedPath == "/snapshot" ->
                    respond(remoteJson, HttpStatusCode.OK, generationHeaders(HttpHeaders.ETag to etag))
                request.method == HttpMethod.Put && request.url.encodedPath == "/snapshot" -> {
                    snapshotPuts += 1
                    assertEquals(etag, request.headers[HttpHeaders.IfMatch])
                    assertNull(request.headers[HttpHeaders.IfNoneMatch])
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    respond("")
                }
                else -> error("Unexpected request: ${request.method.value} ${request.url.encodedPath}")
            }
        }

        val result = SyncClient(crypto = crypto, providedEngine = engine).use { sync ->
            sync.syncCloudflareVault(
                vault = local,
                passphrase = passphrase,
                workerEndpoint = "https://zerochat.example.workers.dev",
                token = "access-key",
                hasCompletedSync = true,
            )
        }

        assertEquals(local, result)
        assertEquals(1, snapshotPuts)
    }

    @Test
    fun syncClientTreatsUncertainLegacyPutAsFailureAndKeepsLocalSnapshot() {
        val local = snapshotEnvelope(updatedAt = 200)
        var snapshotPuts = 0
        val engine = MockEngine { request ->
            when {
                request.method == HttpMethod.Get && request.url.encodedPath == "/sync/head" ->
                    respond("Unsupported", HttpStatusCode.NotImplemented)
                request.method == HttpMethod.Get && request.url.encodedPath == "/snapshot" ->
                    respond("missing", HttpStatusCode.NotFound, generationHeaders())
                request.method == HttpMethod.Put && request.url.encodedPath == "/snapshot" -> {
                    snapshotPuts += 1
                    assertEquals("*", request.headers[HttpHeaders.IfNoneMatch])
                    assertNull(request.headers[HttpHeaders.IfMatch])
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    respond("commit result unknown", HttpStatusCode.ServiceUnavailable)
                }
                else -> error("Unexpected request: ${request.method.value} ${request.url.encodedPath}")
            }
        }

        val error = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                SyncClient(providedEngine = engine).use { sync ->
                    sync.syncCloudflare(
                        envelope = local,
                        workerEndpoint = "https://zerochat.example.workers.dev",
                        token = "access-key",
                        hasCompletedSync = true,
                    )
                }
            }
        }

        assertEquals("commit result unknown", error.message)
        assertEquals(1, snapshotPuts)
        assertEquals(200, local.updatedAt, "An uncertain commit must leave the local snapshot available for retry.")
    }

    @Test
    fun syncAttemptRejectsHeadAndLegacySnapshotGenerationMismatchBeforeWriting() {
        var mutations = 0
        val engine = MockEngine { request ->
            when {
                request.method == HttpMethod.Get && request.url.encodedPath == "/sync/head" ->
                    respond("", HttpStatusCode.NotFound, generationHeaders())
                request.method == HttpMethod.Get && request.url.encodedPath == "/snapshot" ->
                    respond("", HttpStatusCode.NotFound, headersWithGeneration(OTHER_GENERATION))
                request.method != HttpMethod.Get -> {
                    mutations += 1
                    respond("")
                }
                else -> error("Unexpected request: ${request.method.value} ${request.url.encodedPath}")
            }
        }

        val error = assertThrows(CloudflareGenerationConflictException::class.java) {
            runBlocking {
                SyncClient(providedEngine = engine).use { sync ->
                    sync.syncCloudflare(
                        envelope = snapshotEnvelope(updatedAt = 200),
                        workerEndpoint = "https://zerochat.example.workers.dev",
                        token = "access-key",
                        hasCompletedSync = true,
                    )
                }
            }
        }

        assertEquals("Cloud data changed. Pull again before uploading.", error.message)
        assertEquals(0, mutations, "A generation mismatch must stop before any remote mutation.")
    }

    @Test
    fun snapshotRemoteAcceptRechecksGenerationAndEtagAfterMaterialization() {
        val remote = snapshotEnvelope(updatedAt = 200)
        val remoteJson = Json.encodeToString(EncryptedSnapshotEnvelope.serializer(), remote)
        val firstEtag = "\"snapshot-sha256-${"a".repeat(64)}\""
        val changedEtag = "\"snapshot-sha256-${"b".repeat(64)}\""
        val changedObservations = listOf(
            TEST_GENERATION to changedEtag,
            OTHER_GENERATION to firstEtag,
        )

        for ((secondGeneration, secondEtag) in changedObservations) {
            var snapshotReads = 0
            var mutations = 0
            val engine = MockEngine { request ->
                when {
                    request.method == HttpMethod.Get && request.url.encodedPath == "/sync/head" ->
                        respond("unsupported", HttpStatusCode.NotImplemented)
                    request.method == HttpMethod.Get && request.url.encodedPath == "/snapshot" -> {
                        snapshotReads += 1
                        val generation = if (snapshotReads == 1) TEST_GENERATION else secondGeneration
                        val etag = if (snapshotReads == 1) firstEtag else secondEtag
                        respond(
                            remoteJson,
                            HttpStatusCode.OK,
                            headersWithGeneration(generation, HttpHeaders.ETag to etag),
                        )
                    }
                    request.method != HttpMethod.Get -> {
                        mutations += 1
                        respond("")
                    }
                    else -> error("Unexpected request: ${request.method.value} ${request.url.encodedPath}")
                }
            }

            assertThrows(CloudflareSnapshotConflictException::class.java) {
                runBlocking {
                    SyncClient(providedEngine = engine).use { sync ->
                        sync.syncCloudflare(
                            envelope = snapshotEnvelope(updatedAt = 100),
                            workerEndpoint = "https://zerochat.example.workers.dev",
                            token = "access-key",
                            hasCompletedSync = true,
                        )
                    }
                }
            }
            assertEquals(2, snapshotReads)
            assertEquals(0, mutations, "A changed snapshot observation must never be accepted locally.")
        }
    }

    @Test
    fun incrementalRemoteAcceptRechecksGenerationAndHeadAfterMaterialization() {
        val passphrase = "test-passphrase"
        val crypto = mockk<CryptoEngine>()
        val firstHead = IncrementalSyncHead(
            manifestKey = "manifest-11111111-1111-4111-8111-111111111111.json",
            updatedAt = 200,
        )
        val changedHead = firstHead.copy(
            manifestKey = "manifest-22222222-2222-4222-a222-222222222222.json",
        )
        val manifest = IncrementalManifest(
            updatedAt = 200,
            data = AppSnapshot(updatedAt = 200),
        )
        val manifestEnvelope = encryptedEnvelope("manifest", 200)
        every {
            crypto.decryptObject(
                IncrementalManifest.serializer(),
                manifestEnvelope,
                passphrase,
                "manifest",
            )
        } returns manifest
        val changedObservations = listOf(
            TEST_GENERATION to changedHead,
            OTHER_GENERATION to firstHead,
        )

        for ((secondGeneration, secondHead) in changedObservations) {
            var headReads = 0
            var mutations = 0
            val engine = MockEngine { request ->
                when {
                    request.method == HttpMethod.Get && request.url.encodedPath == "/sync/head" -> {
                        headReads += 1
                        val generation = if (headReads == 1) TEST_GENERATION else secondGeneration
                        val head = if (headReads == 1) firstHead else secondHead
                        respond(
                            Json.encodeToString(IncrementalSyncHead.serializer(), head),
                            HttpStatusCode.OK,
                            headersWithGeneration(generation),
                        )
                    }
                    request.method == HttpMethod.Get &&
                        request.url.encodedPath == "/sync/object/${firstHead.manifestKey}" ->
                        respond(
                            Json.encodeToString(EncryptedObjectEnvelope.serializer(), manifestEnvelope),
                            HttpStatusCode.OK,
                        )
                    request.method != HttpMethod.Get -> {
                        mutations += 1
                        respond("")
                    }
                    else -> error("Unexpected request: ${request.method.value} ${request.url.encodedPath}")
                }
            }

            assertThrows(CloudflareHeadConflictException::class.java) {
                runBlocking {
                    SyncClient(crypto = crypto, providedEngine = engine).use { sync ->
                        sync.syncCloudflareVault(
                            vault = SyncVault(data = AppSnapshot(updatedAt = 100)),
                            passphrase = passphrase,
                            workerEndpoint = "https://zerochat.example.workers.dev",
                            token = "access-key",
                            hasCompletedSync = true,
                        )
                    }
                }
            }
            assertEquals(2, headReads)
            assertEquals(0, mutations, "A changed incremental observation must never be accepted locally.")
        }
    }

    @Test
    fun firstIncrementalPublishUsesCreateOnlyHeadAndRollsBackOnConflict() {
        val upload = builtUpload()
        val uploadedObjects = mutableListOf<String>()
        val deletedObjects = mutableListOf<String>()
        var ifNoneMatch: String? = null
        var ifMatch: String? = null
        val engine = MockEngine { request ->
            val path = request.url.encodedPath
            when {
                request.method == HttpMethod.Get && path == "/sync/head" ->
                    respond("Head is empty", HttpStatusCode.NotFound, generationHeaders())
                request.method == HttpMethod.Get && path == "/snapshot" ->
                    respond("Snapshot is empty", HttpStatusCode.NotFound, generationHeaders())
                request.method == HttpMethod.Put && path.startsWith("/sync/object/") -> {
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    uploadedObjects += path
                    respond("")
                }
                request.method == HttpMethod.Put && path == "/sync/head" -> {
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    ifNoneMatch = request.headers[HttpHeaders.IfNoneMatch]
                    ifMatch = request.headers[HttpHeaders.IfMatch]
                    respond("Head changed", HttpStatusCode.Conflict)
                }
                request.method == HttpMethod.Delete && path.startsWith("/sync/object/") -> {
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    deletedObjects += path
                    respond("")
                }
                else -> error("Unexpected request: ${request.method.value} $path")
            }
        }

        val error = assertThrows(CloudflareHeadConflictException::class.java) {
            runBlocking {
                publishWithEngine(engine, upload, previousManifestKey = null)
            }
        }

        assertEquals("Cloud data changed. Pull again before uploading.", error.message)
        assertEquals("*", ifNoneMatch)
        assertNull(ifMatch)
        assertEquals(2, uploadedObjects.size)
        assertEquals(uploadedObjects, deletedObjects)
    }

    @Test
    fun replacementIncrementalPublishUsesPreviousManifestEtag() = runBlocking {
        val upload = builtUpload()
        val previousManifestKey = "manifest-11111111-1111-1111-1111-111111111111.json"
        var ifNoneMatch: String? = null
        var ifMatch: String? = null
        val engine = MockEngine { request ->
            val path = request.url.encodedPath
            when {
                request.method == HttpMethod.Put && path.startsWith("/sync/object/") -> {
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    respond("")
                }
                request.method == HttpMethod.Put && path == "/sync/head" -> {
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    ifNoneMatch = request.headers[HttpHeaders.IfNoneMatch]
                    ifMatch = request.headers[HttpHeaders.IfMatch]
                    respond("")
                }
                else -> error("Unexpected request: ${request.method.value} $path")
            }
        }

        publishWithEngine(engine, upload, previousManifestKey)

        assertNull(ifNoneMatch)
        assertEquals("\"$previousManifestKey\"", ifMatch)
    }

    @Test
    fun incrementalHeadConflictStatusesAreReportedAsRemoteUpdated() {
        for (status in syncConflictStatuses()) {
            val conflictBody = ByteReadChannel("head changed")
            val client = HttpClient(
                MockEngine { request ->
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    respond(conflictBody, status)
                },
            )
            val transport = CloudflareSyncTransport(client, CryptoEngine())

            assertThrows(CloudflareHeadConflictException::class.java) {
                runBlocking {
                    transport.writeIncrementalHead(
                        endpoint = "https://zerochat.example.workers.dev",
                        token = "access-key",
                        head = builtUpload().head,
                        previousManifestKey = null,
                        generation = TEST_GENERATION,
                    )
                }
            }
            assertTrue(conflictBody.isClosedForRead)
            client.close()
        }
    }

    @Test
    fun staleGenerationOnFallbackHeadDeleteStopsSnapshotDelete() {
        var snapshotDeletes = 0
        val engine = MockEngine { request ->
            when {
                request.method == HttpMethod.Delete && request.url.encodedPath == "/sync/clear" ->
                    respond("unsupported", HttpStatusCode.MethodNotAllowed)
                request.method == HttpMethod.Get && request.url.encodedPath == "/sync/head" ->
                    respond("", HttpStatusCode.NotFound, generationHeaders())
                request.method == HttpMethod.Delete && request.url.encodedPath == "/sync/head" -> {
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    respond("sync generation changed", HttpStatusCode.PreconditionFailed)
                }
                request.method == HttpMethod.Delete && request.url.encodedPath == "/snapshot" -> {
                    snapshotDeletes += 1
                    respond("")
                }
                else -> error("Unexpected request: ${request.method.value} ${request.url.encodedPath}")
            }
        }

        assertThrows(CloudflareHeadConflictException::class.java) {
            runBlocking {
                HttpClient(engine).use { client ->
                    CloudflareSyncTransport(client, CryptoEngine()).clearRemote(
                        "https://zerochat.example.workers.dev",
                        "access-key",
                    )
                }
            }
        }
        assertEquals(0, snapshotDeletes)
    }

    @Test
    fun ambiguousHeadFailureKeepsUploadedImmutableObjects() {
        val upload = builtUpload()
        val uploadedObjects = mutableListOf<String>()
        val deletedObjects = mutableListOf<String>()
        val engine = MockEngine { request ->
            val path = request.url.encodedPath
            when {
                request.method == HttpMethod.Get && path == "/sync/head" ->
                    respond("Head is empty", HttpStatusCode.NotFound, generationHeaders())
                request.method == HttpMethod.Get && path == "/snapshot" ->
                    respond("Snapshot is empty", HttpStatusCode.NotFound, generationHeaders())
                request.method == HttpMethod.Put && path.startsWith("/sync/object/") -> {
                    assertEquals(TEST_GENERATION, request.headers[TEST_GENERATION_HEADER])
                    uploadedObjects += path
                    respond("")
                }
                request.method == HttpMethod.Put && path == "/sync/head" ->
                    if (request.headers[TEST_GENERATION_HEADER] == TEST_GENERATION) {
                        respond("Commit result is unknown", HttpStatusCode.ServiceUnavailable)
                    } else {
                        error("Incremental head write omitted the sync generation.")
                    }
                request.method == HttpMethod.Delete && path.startsWith("/sync/object/") -> {
                    deletedObjects += path
                    respond("")
                }
                else -> error("Unexpected request: ${request.method.value} $path")
            }
        }

        val error = assertThrows(IllegalStateException::class.java) {
            runBlocking {
                publishWithEngine(engine, upload, previousManifestKey = null)
            }
        }

        assertEquals("Commit result is unknown", error.message)
        assertEquals(2, uploadedObjects.size)
        assertTrue(deletedObjects.isEmpty(), "An uncertain head result must retain every uploaded object.")
    }

    private suspend fun publishWithEngine(
        engine: MockEngine,
        upload: BuiltIncrementalUpload,
        previousManifestKey: String?,
    ) {
        HttpClient(engine).use { client ->
            publishIncrementalUpload(
                cloudflare = CloudflareSyncTransport(client, CryptoEngine()),
                endpoint = "https://zerochat.example.workers.dev",
                token = "access-key",
                upload = upload,
                previousManifestKey = previousManifestKey,
                generation = TEST_GENERATION,
            )
        }
    }

    private fun builtUpload(): BuiltIncrementalUpload {
        val updatedAt = 100L
        val manifestKey = "manifest-22222222-2222-2222-2222-222222222222.json"
        val manifest = IncrementalManifest(
            updatedAt = updatedAt,
            data = AppSnapshot(updatedAt = updatedAt),
        )
        return BuiltIncrementalUpload(
            head = IncrementalSyncHead(manifestKey = manifestKey, updatedAt = updatedAt),
            manifest = manifest,
            manifestEnvelope = encryptedEnvelope("manifest", updatedAt),
            chunks = listOf(
                PendingChunkUpload(
                    key = "chunk-33333333-3333-3333-3333-333333333333.json",
                    envelope = encryptedEnvelope("conversationChunk:conversation-1:0", updatedAt),
                ),
            ),
        )
    }

    private fun encryptedEnvelope(objectType: String, updatedAt: Long) = EncryptedObjectEnvelope(
        objectType = objectType,
        encryptedAt = updatedAt,
        updatedAt = updatedAt,
        crypto = ObjectEnvelopeCrypto(
            iterations = 600_000,
            salt = "salt",
            iv = "iv",
            aad = "aad",
        ),
        payload = "payload",
    )

    private fun snapshotEnvelope(updatedAt: Long) = EncryptedSnapshotEnvelope(
        encryptedAt = updatedAt,
        updatedAt = updatedAt,
        crypto = EnvelopeCrypto(
            iterations = 600_000,
            salt = "salt",
            iv = "iv",
            aad = "aad",
        ),
        payload = "payload",
    )

    private fun generationHeaders(vararg values: Pair<String, String>): io.ktor.http.Headers =
        headersWithGeneration(TEST_GENERATION, *values)

    private fun headersWithGeneration(
        generation: String?,
        vararg values: Pair<String, String>,
    ): io.ktor.http.Headers {
        val headers = values.map { it.first to listOf(it.second) }.toMutableList()
        if (generation != null) {
            headers += TEST_GENERATION_HEADER to listOf(generation)
        }
        return headersOf(*headers.toTypedArray())
    }

    private fun syncConflictStatuses() = listOf(
        HttpStatusCode.Conflict,
        HttpStatusCode.PreconditionFailed,
        HttpStatusCode(428, "Precondition Required"),
    )

    private companion object {
        const val TEST_GENERATION_HEADER = "x-zerochat-sync-generation"
        const val TEST_GENERATION = "11111111-1111-4111-8111-111111111111"
        const val OTHER_GENERATION = "22222222-2222-4222-a222-222222222222"
    }
}
