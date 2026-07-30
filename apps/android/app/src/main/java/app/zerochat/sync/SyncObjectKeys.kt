package app.zerochat.sync

import java.util.UUID

internal fun objectKey(prefix: String): String =
    "$prefix-${UUID.randomUUID()}.json"

internal fun isSafeObjectKey(value: String): Boolean =
    OBJECT_KEY_PATTERN.matches(value)

private val OBJECT_KEY_PATTERN = Regex("^(manifest|chunk|skill|attachment)-[0-9a-fA-F-]+\\.json$")
