package app.zerochat.ui

import android.content.Context
import android.net.Uri
import java.io.ByteArrayOutputStream
import java.io.InputStream

internal const val MAX_ENCRYPTED_BACKUP_FILE_BYTES = 50_000_000
internal const val MAX_SKILL_FILE_BYTES = 2_000_000
internal const val MAX_IMAGE_FILE_BYTES = 20_000_000

internal fun localFileTooLargeMessage(i18n: NativeI18n, maxBytes: Int): String =
    i18n.t("message.fileTooLarge")
        .replace("{maxMb}", i18n.formatNumber(maxBytes / 1_000_000))

internal fun assertLocalByteSize(
    byteLength: Int,
    maxBytes: Int,
    tooLargeMessage: String,
) {
    require(byteLength >= 0) { "Local file byte length must not be negative." }
    require(maxBytes >= 0) { "Local file size limit must not be negative." }
    if (byteLength > maxBytes) {
        throw IllegalArgumentException(tooLargeMessage)
    }
}

internal fun readBoundedLocalInputStream(
    input: InputStream,
    maxBytes: Int,
    tooLargeMessage: String,
): ByteArray {
    assertLocalByteSize(0, maxBytes, tooLargeMessage)

    val output = ByteArrayOutputStream(minOf(maxBytes, DEFAULT_BUFFER_SIZE))
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var totalBytes = 0

    while (true) {
        val read = input.read(buffer)
        if (read < 0) {
            break
        }
        if (read == 0) {
            val byte = input.read()
            if (byte < 0) {
                break
            }
            if (totalBytes == maxBytes) {
                throw IllegalArgumentException(tooLargeMessage)
            }
            output.write(byte)
            totalBytes += 1
            continue
        }
        if (totalBytes > maxBytes - read) {
            throw IllegalArgumentException(tooLargeMessage)
        }

        output.write(buffer, 0, read)
        totalBytes += read
    }

    return output.toByteArray()
}

internal fun readBoundedLocalUriBytes(
    context: Context,
    uri: Uri,
    maxBytes: Int,
    tooLargeMessage: String,
): ByteArray =
    context.contentResolver.openInputStream(uri)?.use { input ->
        readBoundedLocalInputStream(input, maxBytes, tooLargeMessage)
    } ?: throw IllegalArgumentException("Could not open selected file for reading.")

internal fun readBoundedLocalUriText(
    context: Context,
    uri: Uri,
    maxBytes: Int,
    tooLargeMessage: String,
): String = readBoundedLocalUriBytes(context, uri, maxBytes, tooLargeMessage).toString(Charsets.UTF_8)
