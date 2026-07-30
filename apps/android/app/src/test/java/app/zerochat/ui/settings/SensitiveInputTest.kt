package app.zerochat.ui.settings

import androidx.compose.ui.text.input.KeyboardType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SensitiveInputTest {
    @Test
    fun sensitiveCredentialsUsePasswordKeyboardWithoutAutocorrect() {
        assertEquals(KeyboardType.Password, sensitiveCredentialKeyboardOptions.keyboardType)
        assertEquals(false, sensitiveCredentialKeyboardOptions.autoCorrectEnabled)
    }

    @Test
    fun clipboardSensitivityStartsOnAndroid13() {
        assertFalse(shouldMarkClipboardSensitive(32))
        assertTrue(shouldMarkClipboardSensitive(33))
        assertTrue(shouldMarkClipboardSensitive(36))
    }
}
