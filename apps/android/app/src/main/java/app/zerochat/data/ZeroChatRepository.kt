package app.zerochat.data

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File

class ZeroChatRepository(context: Context) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        prettyPrint = true
    }
    private val snapshotFile = File(context.filesDir, "snapshot.v1.json")

    suspend fun load(): AppSnapshot = withContext(Dispatchers.IO) {
        if (!snapshotFile.exists()) {
            return@withContext AppSnapshot()
        }

        json.decodeFromString<AppSnapshot>(snapshotFile.readText())
    }

    suspend fun save(snapshot: AppSnapshot) = withContext(Dispatchers.IO) {
        snapshotFile.writeText(json.encodeToString(AppSnapshot.serializer(), snapshot))
    }

    suspend fun clear() = withContext(Dispatchers.IO) {
        snapshotFile.delete()
    }
}
