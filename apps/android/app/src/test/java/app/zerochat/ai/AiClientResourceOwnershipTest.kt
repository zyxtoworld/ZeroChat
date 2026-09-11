package app.zerochat.ai

import io.ktor.client.HttpClient
import io.mockk.mockk
import io.mockk.verify
import org.junit.jupiter.api.Test

class AiClientResourceOwnershipTest {
    @Test
    fun closeClosesTheOwnedHttpClient() {
        val httpClient = mockk<HttpClient>(relaxed = true)

        AiClient(httpClient).close()

        verify(exactly = 1) { httpClient.close() }
    }
}
