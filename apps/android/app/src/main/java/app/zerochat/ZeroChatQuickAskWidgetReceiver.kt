package app.zerochat

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.widget.RemoteViews
import app.zerochat.client.R
import app.zerochat.ui.NativeI18n

class ZeroChatQuickAskWidgetReceiver : AppWidgetProvider() {
    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray,
    ) {
        appWidgetIds.forEach { appWidgetId ->
            appWidgetManager.updateAppWidget(appWidgetId, quickAskRemoteViews(context))
        }
    }

    companion object {
        private const val QUICK_ASK_REQUEST_CODE = 4101

        fun quickAskRemoteViews(context: Context): RemoteViews {
            val i18n = NativeI18n.forMode(NativeI18n.systemLanguageKey())
            val title = i18n.t("title.newChat")
            val body = i18n.t("app.localFirst")
            val action = i18n.t("action.new")
            val accessibility = listOf("ZeroChat", title, body, action).joinToString(". ")

            return RemoteViews(context.packageName, R.layout.zerochat_quick_ask_widget).apply {
                setTextViewText(R.id.widget_brand, "ZeroChat")
                setTextViewText(R.id.widget_title, title)
                setTextViewText(R.id.widget_body, body)
                setTextViewText(R.id.widget_action, action)
                setContentDescription(R.id.widget_root, accessibility)
                setOnClickPendingIntent(R.id.widget_root, quickAskPendingIntent(context))
            }
        }

        private fun quickAskPendingIntent(context: Context): PendingIntent =
            PendingIntent.getActivity(
                context,
                QUICK_ASK_REQUEST_CODE,
                QuickAskIntents.openQuickAskIntent(context),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
    }
}
