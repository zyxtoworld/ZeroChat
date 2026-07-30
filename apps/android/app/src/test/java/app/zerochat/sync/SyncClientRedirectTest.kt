package app.zerochat.sync

import app.zerochat.data.AppSnapshot
import app.zerochat.data.EncryptedObjectEnvelope
import app.zerochat.data.ObjectEnvelopeCrypto
import app.zerochat.data.SyncVault
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import io.ktor.utils.io.ByteReadChannel
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncClientRedirectTest {
    @Test
    fun injectedEngineDoesNotFollowGitHubCredentialRedirect() {
        val requestedUrls = mutableListOf<String>()
        val engine = MockEngine { request ->
            requestedUrls += request.url.toString()
            assertEquals("Bearer github-token", request.headers[HttpHeaders.Authorization])
            respond(
                content = "redirect",
                status = HttpStatusCode.TemporaryRedirect,
                headers = headersOf(HttpHeaders.Location, "https://attacker.example/github"),
            )
        }
        val client = SyncClient(providedEngine = engine)

        try {
            assertThrows(IllegalStateException::class.java) {
                runBlocking {
                    client.clearGist(
                        gistId = "0123456789abcdef0123456789abcdef",
                        gistFile = "zerochat-sync.json",
                        token = "github-token",
                        passphrase = "test-passphrase",
                    )
                }
            }

            assertEquals(
                listOf("https://api.github.com/gists/0123456789abcdef0123456789abcdef"),
                requestedUrls,
            )
        } finally {
            client.close()
        }
    }

    @Test
    fun injectedEngineDoesNotFollowCloudflareCredentialRedirect() {
        val requestedUrls = mutableListOf<String>()
        val engine = MockEngine { request ->
            requestedUrls += request.url.toString()
            assertEquals("Bearer cloudflare-access-key", request.headers[HttpHeaders.Authorization])
            respond(
                content = "redirect",
                status = HttpStatusCode.TemporaryRedirect,
                headers = headersOf(HttpHeaders.Location, "https://attacker.example/cloudflare"),
            )
        }
        val client = SyncClient(providedEngine = engine)

        try {
            assertThrows(IllegalStateException::class.java) {
                runBlocking {
                    client.clearCloudflare(
                        workerEndpoint = "https://worker.example.test",
                        token = "cloudflare-access-key",
                    )
                }
            }

            assertEquals(
                listOf("https://worker.example.test/sync/clear"),
                requestedUrls,
            )
        } finally {
            client.close()
        }
    }

    @Test
    fun clearGistDrainsMissingRemoteBodyBeforeReturning() = runBlocking {
        val missingBody = ByteReadChannel("missing gist")
        val engine = MockEngine { request ->
            assertEquals("GET", request.method.value)
            respond(
                content = missingBody,
                status = HttpStatusCode.NotFound,
                headers = headersOf(HttpHeaders.ContentType, "text/plain"),
            )
        }
        val client = SyncClient(providedEngine = engine)

        try {
            client.clearGist(
                gistId = "0123456789abcdef0123456789abcdef",
                gistFile = "zerochat-sync.json",
                token = "github-token",
                passphrase = "test-passphrase",
            )
        } finally {
            client.close()
        }

        assertTrue(missingBody.isClosedForRead, "Missing Gist response bodies must be drained before clearing.")
    }

    @Test
    fun successfulGistPatchDrainsResponseBodyBeforeReturning() = runBlocking {
        val patchBody = ByteReadChannel("updated gist")
        val crypto = mockk<CryptoEngine>()
        every {
            crypto.encryptObject<JsonElement>(any(), any(), any(), any(), any())
        } returns EncryptedObjectEnvelope(
            objectType = "gistState",
            encryptedAt = 1,
            updatedAt = 1,
            crypto = ObjectEnvelopeCrypto(
                iterations = 600_000,
                salt = "salt",
                iv = "iv",
                aad = "aad",
            ),
            payload = "payload",
        )
        val engine = MockEngine { request ->
            when (request.method.value) {
                "GET" -> respond(
                    content = "{\"id\":\"gist-patch-body\",\"files\":{}}",
                    status = HttpStatusCode.OK,
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
                "PATCH" -> respond(
                    content = patchBody,
                    status = HttpStatusCode.OK,
                    headers = headersOf(HttpHeaders.ContentType, "application/json"),
                )
                else -> error("Unexpected Gist request: ${request.method.value}")
            }
        }
        val client = SyncClient(crypto = crypto, providedEngine = engine)

        try {
            client.clearGist(
                gistId = "gist-patch-body",
                gistFile = "zerochat-sync.json",
                token = "github-token",
                passphrase = "test-passphrase",
            )
        } finally {
            client.close()
        }

        assertTrue(patchBody.isClosedForRead, "Successful Gist PATCH response bodies must be drained.")
    }

    @Test
    fun gistRawFileUrlMustStayOnGitHubGistHost() = runBlocking {
        val requestedUrls = mutableListOf<String>()
        val engine = MockEngine { request ->
            requestedUrls += request.url.toString()
            respond(
                content = """
                    {
                      "id":"gist-host-validation",
                      "files":{
                        "zerochat-sync.json":{
                          "raw_url":"https://attacker.example/zerochat-sync.json",
                          "truncated":true
                        }
                      }
                    }
                """.trimIndent(),
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json"),
            )
        }
        val client = SyncClient(providedEngine = engine)

        try {
            assertThrows(IllegalArgumentException::class.java) {
                runBlocking {
                    client.syncGistVault(
                        vault = SyncVault(data = AppSnapshot(updatedAt = 1)),
                        passphrase = "test-passphrase",
                        gistId = "gist-host-validation",
                        gistFile = "zerochat-sync.json",
                        token = "github-token",
                        firstSyncStrategy = FirstSyncStrategy.UseRemote,
                        hasCompletedSync = false,
                        hasLocalUserContent = false,
                    )
                }
            }
        } finally {
            client.close()
        }

        assertEquals(
            listOf("https://api.github.com/gists/gist-host-validation"),
            requestedUrls,
        )
    }
}
