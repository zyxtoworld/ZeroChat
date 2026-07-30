package app.zerochat.data

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption

internal const val MAX_LOCAL_SNAPSHOT_FILE_BYTES = 64_000_000

internal class LocalSnapshotTooLargeException(
    val maxBytes: Int,
) : IOException("Local snapshot exceeded the $maxBytes-byte safety limit.")

internal fun assertLocalSnapshotByteSize(
    byteLength: Long,
    maxBytes: Int = MAX_LOCAL_SNAPSHOT_FILE_BYTES,
) {
    require(byteLength >= 0 && maxBytes >= 0) {
        "Local snapshot size limit must not be negative."
    }
    if (byteLength > maxBytes) {
        throw LocalSnapshotTooLargeException(maxBytes)
    }
}

internal fun readBoundedSnapshotText(
    file: File,
    maxBytes: Int = MAX_LOCAL_SNAPSHOT_FILE_BYTES,
): String {
    assertLocalSnapshotByteSize(file.length(), maxBytes)
    val bytes = file.inputStream().buffered().use { input ->
        readBoundedSnapshotInputStream(input, maxBytes)
    }
    return bytes.toString(Charsets.UTF_8)
}

internal fun readBoundedSnapshotInputStream(
    input: InputStream,
    maxBytes: Int = MAX_LOCAL_SNAPSHOT_FILE_BYTES,
): ByteArray {
    assertLocalSnapshotByteSize(0, maxBytes)

    val output = ByteArrayOutputStream(minOf(maxBytes, 16_384))
    val buffer = ByteArray(16_384)
    while (true) {
        val remaining = maxBytes - output.size()
        val readLimit = if (remaining == 0) 1 else minOf(remaining, buffer.size)
        val count = input.read(buffer, 0, readLimit)
        if (count < 0) {
            break
        }
        if (count > remaining) {
            throw LocalSnapshotTooLargeException(maxBytes)
        }
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}

internal fun writeBoundedSnapshotTextAtomically(
    file: File,
    text: String,
    maxBytes: Int = MAX_LOCAL_SNAPSHOT_FILE_BYTES,
) {
    val bytes = text.toByteArray(Charsets.UTF_8)
    assertLocalSnapshotByteSize(bytes.size.toLong(), maxBytes)

    val parent = file.parentFile ?: throw IOException("Local snapshot has no parent directory.")
    Files.createDirectories(parent.toPath())
    val tempFile = snapshotTempFile(file)
    try {
        FileOutputStream(tempFile, false).use { output ->
            output.write(bytes)
            output.fd.sync()
        }
        replaceSnapshotFile(tempFile, file)
    } catch (error: Exception) {
        tempFile.delete()
        throw error
    }
}

internal fun snapshotTempFile(file: File): File = File(file.parentFile, "${file.name}.tmp")

internal fun replaceSnapshotFile(source: File, destination: File) {
    try {
        Files.move(
            source.toPath(),
            destination.toPath(),
            StandardCopyOption.ATOMIC_MOVE,
            StandardCopyOption.REPLACE_EXISTING,
        )
    } catch (_: AtomicMoveNotSupportedException) {
        Files.move(
            source.toPath(),
            destination.toPath(),
            StandardCopyOption.REPLACE_EXISTING,
        )
    }
}
