package app.zerochat.sync

import android.content.Context
import app.zerochat.commitOrThrow
import java.util.concurrent.ConcurrentHashMap

interface GistCursorStorage {
    fun read(key: String): String?

    fun write(key: String, value: String)

    fun remove(key: String)
}

object ProcessGistCursorStorage : GistCursorStorage {
    private val values = ConcurrentHashMap<String, String>()

    override fun read(key: String): String? = values[key]

    override fun write(key: String, value: String) {
        values[key] = value
    }

    override fun remove(key: String) {
        values.remove(key)
    }

    internal fun clear() {
        values.clear()
    }
}

class SharedPreferencesGistCursorStorage(context: Context) : GistCursorStorage {
    private val preferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    override fun read(key: String): String? = preferences.getString(key, null)

    override fun write(key: String, value: String) {
        preferences.commitOrThrow("Unable to persist the Gist sync cursor.") {
            putString(key, value)
        }
    }

    override fun remove(key: String) {
        preferences.commitOrThrow("Unable to clear the Gist sync cursor.") {
            remove(key)
        }
    }

    private companion object {
        const val PREFERENCES_NAME = "zerochat-gist-sync-cursors-v2"
    }
}
