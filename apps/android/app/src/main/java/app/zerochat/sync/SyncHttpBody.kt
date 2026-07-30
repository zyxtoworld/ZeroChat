package app.zerochat.sync

import app.zerochat.runCatchingPreservingCancellation
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpHeaders
import io.ktor.utils.io.readAvailable
import kotlinx.serialization.json.Json
import java.io.ByteArrayOutputStream

internal const val MAX_SYNC_SNAPSHOT_BYTES = 900_000
internal const val MAX_SYNC_INCREMENTAL_OBJECT_BYTES = 5_000_000
internal const val MAX_SYNC_INCREMENTAL_HEAD_BYTES = 16_384
internal const val MAX_SYNC_ERROR_BODY_BYTES = 16_384
internal const val MAX_SYNC_GIST_RESPONSE_BYTES = 5_000_000

internal fun assertSyncTextSize(text: String, maxBytes: Int, label: String) {
    require(text.toByteArray(Charsets.UTF_8).size <= maxBytes) {
        "$label exceeded the $maxBytes-byte safety limit."
    }
}

internal suspend fun HttpResponse.readBoundedText(maxBytes: Int, label: String): String {
    val message = "$label exceeded the $maxBytes-byte safety limit."
    val declaredLength = headers[HttpHeaders.ContentLength]?.toLongOrNull()
    val channel = bodyAsChannel()

    if (declaredLength != null && declaredLength > maxBytes) {
        val failure = IllegalStateException(message)
        channel.cancel(failure)
        throw failure
    }

    val initialCapacity = declaredLength
        ?.coerceAtMost(maxBytes.toLong())
        ?.toInt()
        ?: 8_192
    val output = ByteArrayOutputStream(initialCapacity)
    val buffer = ByteArray(8_192)
    var totalBytes = 0

    while (true) {
        val read = channel.readAvailable(buffer, 0, buffer.size)
        if (read == -1) {
            break
        }
        if (read == 0) {
            continue
        }

        totalBytes += read
        if (totalBytes > maxBytes) {
            val failure = IllegalStateException(message)
            channel.cancel(failure)
            throw failure
        }

        output.write(buffer, 0, read)
    }

    return output.toString(Charsets.UTF_8.name())
}

internal suspend inline fun <reified T> HttpResponse.readBoundedJson(
    json: Json,
    maxBytes: Int,
    label: String,
): T = json.decodeFromString(readBoundedText(maxBytes, label))

internal suspend fun HttpResponse.readBoundedError(fallback: String): String =
    runCatchingPreservingCancellation {
        readBoundedText(MAX_SYNC_ERROR_BODY_BYTES, "Cloud sync error response")
    }.getOrNull()?.ifBlank { fallback } ?: fallback

internal suspend fun HttpResponse.drainBoundedBody() {
    runCatchingPreservingCancellation {
        readBoundedText(MAX_SYNC_ERROR_BODY_BYTES, "Cloud sync response")
    }
}
