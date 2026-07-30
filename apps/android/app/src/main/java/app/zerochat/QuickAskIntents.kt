package app.zerochat

import android.content.Context
import android.content.Intent
import androidx.core.net.toUri

object QuickAskIntents {
    const val ACTION_QUICK_ASK = "app.zerochat.action.QUICK_ASK"
    const val EXTRA_QUICK_ASK = "app.zerochat.extra.QUICK_ASK"
    val quickAskUri = "zerochat://quick-ask".toUri()

    fun isQuickAsk(intent: Intent?): Boolean {
        if (intent == null) {
            return false
        }

        return intent.getBooleanExtra(EXTRA_QUICK_ASK, false) ||
            intent.action == ACTION_QUICK_ASK ||
            (intent.data?.scheme == "zerochat" && intent.data?.host == "quick-ask")
    }

    fun openQuickAskIntent(context: Context): Intent =
        Intent(context, MainActivity::class.java).apply {
            action = ACTION_QUICK_ASK
            data = quickAskUri
            putExtra(EXTRA_QUICK_ASK, true)
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
}
