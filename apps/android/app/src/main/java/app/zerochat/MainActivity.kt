package app.zerochat

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableLongStateOf
import androidx.core.content.edit
import app.zerochat.sync.LocalUserTriggeredSyncAction
import app.zerochat.sync.SyncNotificationPermissionGate
import app.zerochat.sync.shouldRequestPostNotifications
import app.zerochat.ui.ZeroChatApp

class MainActivity : ComponentActivity() {
    private val quickAskRequestId = mutableLongStateOf(0L)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val notificationPermissionPreferences = getSharedPreferences(
            NOTIFICATION_PERMISSION_PREFERENCES,
            MODE_PRIVATE,
        )
        val notificationPermissionGate = SyncNotificationPermissionGate(
            shouldRequestPermission = {
                shouldRequestPostNotifications(
                    sdkInt = Build.VERSION.SDK_INT,
                    permissionGranted = postNotificationsPermissionGranted(),
                    permissionAlreadyRequested = notificationPermissionPreferences.getBoolean(
                        NOTIFICATION_PERMISSION_REQUESTED,
                        false,
                    ),
                )
            },
            markPermissionRequested = {
                notificationPermissionPreferences.edit {
                    putBoolean(NOTIFICATION_PERMISSION_REQUESTED, true)
                }
            },
            requestPermission = ::requestPostNotifications,
        )
        if (savedInstanceState == null) {
            consumeQuickAskIntent(intent)
        }
        setContent {
            CompositionLocalProvider(
                LocalUserTriggeredSyncAction provides notificationPermissionGate,
            ) {
                ZeroChatApp(quickAskRequestId = quickAskRequestId.longValue)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        consumeQuickAskIntent(intent)
    }

    private fun consumeQuickAskIntent(intent: Intent?) {
        if (QuickAskIntents.isQuickAsk(intent)) {
            quickAskRequestId.longValue += 1L
        }
    }

    private fun postNotificationsPermissionGranted(): Boolean =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            true
        } else {
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        }

    private fun requestPostNotifications() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) {}

    private companion object {
        const val NOTIFICATION_PERMISSION_PREFERENCES = "notification_permissions"
        const val NOTIFICATION_PERMISSION_REQUESTED = "post_notifications_requested"
    }
}
