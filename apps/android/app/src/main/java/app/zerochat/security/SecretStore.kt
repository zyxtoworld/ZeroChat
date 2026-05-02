package app.zerochat.security

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

class SecretStore(context: Context) {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val preferences = EncryptedSharedPreferences.create(
        context,
        "zerochat-secrets",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    fun providerKey(providerId: String): String =
        preferences.getString("provider:$providerId", null).orEmpty()

    fun setProviderKey(providerId: String, value: String) {
        val key = "provider:$providerId"
        if (value.isBlank()) {
            preferences.edit().remove(key).apply()
        } else {
            preferences.edit().putString(key, value.trim()).apply()
        }
    }

    fun providerProxyToken(providerId: String): String =
        preferences.getString("proxy:$providerId", null).orEmpty()

    fun setProviderProxyToken(providerId: String, value: String) {
        val key = "proxy:$providerId"
        if (value.isBlank()) {
            preferences.edit().remove(key).apply()
        } else {
            preferences.edit().putString(key, value.trim()).apply()
        }
    }

    fun syncToken(): String = preferences.getString("sync-token", null).orEmpty()

    fun setSyncToken(value: String) {
        if (value.isBlank()) {
            preferences.edit().remove("sync-token").apply()
        } else {
            preferences.edit().putString("sync-token", value.trim()).apply()
        }
    }

    fun githubToken(): String = preferences.getString("github-token", null).orEmpty()

    fun setGithubToken(value: String) {
        if (value.isBlank()) {
            preferences.edit().remove("github-token").apply()
        } else {
            preferences.edit().putString("github-token", value.trim()).apply()
        }
    }
}
