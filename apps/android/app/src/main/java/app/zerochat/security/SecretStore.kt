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
        preferences.edit().putString("provider:$providerId", value).apply()
    }

    fun syncToken(): String = preferences.getString("sync-token", null).orEmpty()

    fun setSyncToken(value: String) {
        preferences.edit().putString("sync-token", value).apply()
    }

    fun githubToken(): String = preferences.getString("github-token", null).orEmpty()

    fun setGithubToken(value: String) {
        preferences.edit().putString("github-token", value).apply()
    }
}
