package app.zerochat

import android.content.Context
import android.content.Intent
import androidx.core.net.toUri

internal const val QUICK_ASK_CONSUMED_STATE_KEY = "quick_ask_consumed"

internal fun shouldConsumeQuickAskOnCreate(
    savedQuickAskConsumed: Boolean,
    isQuickAskIntent: Boolean,
): Boolean = isQuickAskIntent && !savedQuickAskConsumed

internal class QuickAskActivityOwner {
    var deliveryCount: Long = 0L
        private set

    var consumedForInstance: Boolean = false
        private set

    fun onCreate(savedQuickAskConsumed: Boolean, isQuickAskIntent: Boolean): Long {
        consumedForInstance = savedQuickAskConsumed
        if (shouldConsumeQuickAskOnCreate(savedQuickAskConsumed, isQuickAskIntent)) {
            consume(isQuickAskIntent)
            consumedForInstance = true
        }
        return deliveryCount
    }

    fun onNewIntent(isQuickAskIntent: Boolean): Long {
        consume(isQuickAskIntent)
        consumedForInstance = isQuickAskIntent
        return deliveryCount
    }

    private fun consume(isQuickAskIntent: Boolean) {
        if (isQuickAskIntent) {
            deliveryCount += 1L
        }
    }
}

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
