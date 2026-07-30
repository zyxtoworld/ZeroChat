package app.zerochat

import android.annotation.SuppressLint
import android.content.SharedPreferences

@SuppressLint("ApplySharedPref", "UseKtx")
internal inline fun SharedPreferences.commitOrThrow(
    failureMessage: String,
    mutation: SharedPreferences.Editor.() -> Unit,
) {
    check(edit().apply(mutation).commit()) { failureMessage }
}
