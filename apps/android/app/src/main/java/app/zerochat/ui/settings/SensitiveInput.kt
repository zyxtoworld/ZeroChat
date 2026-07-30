package app.zerochat.ui.settings

import android.content.ClipData
import android.content.ClipDescription
import android.os.Build
import android.os.PersistableBundle
import androidx.annotation.ChecksSdkIntAtLeast
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.sensitiveContent
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.isSensitiveData
import androidx.compose.ui.semantics.password
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType

internal val sensitiveCredentialKeyboardOptions = KeyboardOptions(
    autoCorrectEnabled = false,
    keyboardType = KeyboardType.Password,
)

internal fun Modifier.sensitiveCredential(): Modifier =
    sensitiveContent().semantics {
        contentType = ContentType.Password
        isSensitiveData = true
        password()
    }

internal fun sensitivePlainTextClip(
    label: String,
    text: String,
): ClipData = ClipData.newPlainText(label, text).apply {
    if (currentSdkSupportsSensitiveClipboard()) {
        description.extras = (description.extras ?: PersistableBundle()).apply {
            putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
        }
    }
}

internal fun shouldMarkClipboardSensitive(sdkInt: Int): Boolean =
    sdkInt >= Build.VERSION_CODES.TIRAMISU

@ChecksSdkIntAtLeast(api = Build.VERSION_CODES.TIRAMISU)
private fun currentSdkSupportsSensitiveClipboard(): Boolean =
    shouldMarkClipboardSensitive(Build.VERSION.SDK_INT)
