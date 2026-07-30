package app.zerochat.sync

import android.os.Build
import androidx.compose.runtime.staticCompositionLocalOf

fun interface UserTriggeredSyncAction {
    fun run(action: () -> Unit)
}

internal class SyncNotificationPermissionGate(
    private val shouldRequestPermission: () -> Boolean,
    private val markPermissionRequested: () -> Unit,
    private val requestPermission: () -> Unit,
) : UserTriggeredSyncAction {
    override fun run(action: () -> Unit) {
        val shouldRequest = shouldRequestPermission()
        action()
        if (shouldRequest) {
            markPermissionRequested()
            requestPermission()
        }
    }
}

internal val LocalUserTriggeredSyncAction = staticCompositionLocalOf<UserTriggeredSyncAction> {
    UserTriggeredSyncAction { action -> action() }
}

internal fun shouldRequestPostNotifications(
    sdkInt: Int,
    permissionGranted: Boolean,
    permissionAlreadyRequested: Boolean,
): Boolean =
    sdkInt >= Build.VERSION_CODES.TIRAMISU &&
        !permissionGranted &&
        !permissionAlreadyRequested
