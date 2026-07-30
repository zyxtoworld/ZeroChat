package app.zerochat.sync

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import app.zerochat.MainActivity
import app.zerochat.client.R

interface SyncStatusNotifier {
    fun ensureChannel()
    fun showStatus(message: String, completed: Boolean)
    fun clear()
}

data class SyncNotificationLabels(
    val channelName: String,
    val channelDescription: String,
    val title: String,
)

class AndroidSyncStatusNotifier(
    context: Context,
    initialLabels: SyncNotificationLabels,
) : SyncStatusNotifier {
    private val appContext = context.applicationContext
    private val notificationManager = appContext.getSystemService(NotificationManager::class.java)
    @Volatile
    private var labels = initialLabels

    fun updateLabels(labels: SyncNotificationLabels) {
        this.labels = labels
        ensureChannel()
    }

    override fun ensureChannel() {
        ensureChannel(labels)
    }

    private fun ensureChannel(labels: SyncNotificationLabels) {
        val channel = NotificationChannel(
            SYNC_CHANNEL_ID,
            labels.channelName,
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = labels.channelDescription
            setShowBadge(false)
        }

        notificationManager.createNotificationChannel(channel)
    }

    override fun showStatus(message: String, completed: Boolean) {
        val text = message.trim()
        if (text.isBlank()) {
            return
        }

        val currentLabels = labels
        ensureChannel(currentLabels)
        if (!canPostNotifications()) {
            return
        }

        val notification = Notification.Builder(appContext, SYNC_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(currentLabels.title)
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setContentIntent(openAppIntent())
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setOngoing(!completed)
            .setAutoCancel(completed)
            .build()

        notificationManager.notify(SYNC_NOTIFICATION_ID, notification)
    }

    override fun clear() {
        notificationManager.cancel(SYNC_NOTIFICATION_ID)
    }

    private fun canPostNotifications(): Boolean {
        val permissionGranted = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            true
        } else {
            appContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        }

        return canPostSyncNotification(
            sdkInt = Build.VERSION.SDK_INT,
            permissionGranted = permissionGranted,
            notificationsEnabled = notificationManager.areNotificationsEnabled(),
        )
    }

    private fun openAppIntent(): PendingIntent {
        val intent = Intent(appContext, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }

        return PendingIntent.getActivity(
            appContext,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    companion object {
        const val SYNC_CHANNEL_ID = "zerochat_sync_status"
        private const val SYNC_NOTIFICATION_ID = 4100
    }
}

internal fun canPostSyncNotification(
    sdkInt: Int,
    permissionGranted: Boolean,
    notificationsEnabled: Boolean,
): Boolean =
    notificationsEnabled &&
        (sdkInt < Build.VERSION_CODES.TIRAMISU || permissionGranted)
