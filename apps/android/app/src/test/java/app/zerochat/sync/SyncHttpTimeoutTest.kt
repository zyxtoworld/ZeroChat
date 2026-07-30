package app.zerochat.sync

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.client.plugins.HttpRequestTimeoutException
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.utils.io.ByteChannel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class SyncHttpTimeoutTest {
    @Test
    fun syncRequestTimeoutCancelsSlowTransports() {
        val client = HttpClient(
            MockEngine {
                delay(5_000)
                respond("late response")
            },
        ) {
            installSyncRequestTimeout(timeoutMillis = 50)
        }

        try {
            assertThrows(HttpRequestTimeoutException::class.java) {
                runBlocking {
                    client.get("https://sync.example.test/snapshot")
                }
            }
        } finally {
            client.close()
        }
    }

    @Test
    fun boundedErrorBodyDoesNotConvertCancellationIntoFallbackText() {
        val body = ByteChannel()
        val client = HttpClient(
            MockEngine {
                respond(
                    content = body,
                    status = HttpStatusCode.BadRequest,
                )
            },
        )

        try {
            assertThrows(CancellationException::class.java) {
                runBlocking {
                    withTimeout(50) {
                        client.get("https://sync.example.test/failure")
                            .readBoundedError("fallback")
                    }
                }
            }
        } finally {
            body.cancel(CancellationException("test cleanup"))
            client.close()
        }
    }

    @Test
    fun boundedBodyDrainDoesNotSwallowCancellation() {
        val body = ByteChannel()
        val client = HttpClient(
            MockEngine {
                respond(
                    content = body,
                    status = HttpStatusCode.NotFound,
                )
            },
        )

        try {
            assertThrows(CancellationException::class.java) {
                runBlocking {
                    withTimeout(50) {
                        client.get("https://sync.example.test/missing")
                            .drainBoundedBody()
                    }
                }
            }
        } finally {
            body.cancel(CancellationException("test cleanup"))
            client.close()
        }
    }
}
