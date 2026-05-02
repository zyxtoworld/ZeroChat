package app.zerochat.sync

import app.zerochat.data.EncryptedSnapshotEnvelope
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.android.Android
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.bearerAuth
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json

class SyncClient {
    private val client = HttpClient(Android) {
        install(ContentNegotiation) {
            json(Json {
                ignoreUnknownKeys = true
                explicitNulls = false
            })
        }
    }

    suspend fun syncCloudflare(
        envelope: EncryptedSnapshotEnvelope,
        workerEndpoint: String,
        token: String,
    ): EncryptedSnapshotEnvelope {
        val endpoint = workerEndpoint.trimEnd('/')
        require(endpoint.isNotBlank()) { "Cloudflare Worker 地址为空" }

        val remoteResponse = client.get("$endpoint/snapshot") {
            bearerAuth(token)
        }

        if (remoteResponse.status == HttpStatusCode.OK) {
            val remote = remoteResponse.body<EncryptedSnapshotEnvelope>()
            if (remote.kind == "zerochat.encryptedSnapshot" && remote.updatedAt > envelope.updatedAt) {
                return remote
            }
        }

        client.put("$endpoint/snapshot") {
            bearerAuth(token)
            contentType(ContentType.Application.Json)
            setBody(envelope)
        }

        return envelope
    }
}
