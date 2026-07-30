package app.zerochat.sync

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SyncNotificationPermissionTest {
    @Test
    fun postNotificationPermissionIsRequestedOnlyOnceOnAndroid13OrNewer() {
        assertFalse(
            shouldRequestPostNotifications(
                sdkInt = 32,
                permissionGranted = false,
                permissionAlreadyRequested = false,
            ),
        )
        assertFalse(
            shouldRequestPostNotifications(
                sdkInt = 33,
                permissionGranted = true,
                permissionAlreadyRequested = false,
            ),
        )
        assertFalse(
            shouldRequestPostNotifications(
                sdkInt = 33,
                permissionGranted = false,
                permissionAlreadyRequested = true,
            ),
        )
        assertTrue(
            shouldRequestPostNotifications(
                sdkInt = 33,
                permissionGranted = false,
                permissionAlreadyRequested = false,
            ),
        )
    }

    @Test
    fun permissionRequestDoesNotBlockUserSyncAction() {
        val events = mutableListOf<String>()
        val gate = SyncNotificationPermissionGate(
            shouldRequestPermission = { true },
            markPermissionRequested = { events += "marked" },
            requestPermission = { events += "requested" },
        )

        gate.run { events += "synced" }

        assertEquals(listOf("synced", "marked", "requested"), events)
    }

    @Test
    fun permissionGateRunsSyncWithoutPromptWhenNoRequestIsNeeded() {
        val events = mutableListOf<String>()
        val gate = SyncNotificationPermissionGate(
            shouldRequestPermission = { false },
            markPermissionRequested = { events += "marked" },
            requestPermission = { events += "requested" },
        )

        gate.run { events += "synced" }

        assertEquals(listOf("synced"), events)
    }

    @Test
    fun notifierRequiresRuntimePermissionOnlyOnAndroid13OrNewer() {
        assertTrue(
            canPostSyncNotification(
                sdkInt = 32,
                permissionGranted = false,
                notificationsEnabled = true,
            ),
        )
        assertFalse(
            canPostSyncNotification(
                sdkInt = 33,
                permissionGranted = false,
                notificationsEnabled = true,
            ),
        )
        assertFalse(
            canPostSyncNotification(
                sdkInt = 33,
                permissionGranted = true,
                notificationsEnabled = false,
            ),
        )
        assertTrue(
            canPostSyncNotification(
                sdkInt = 33,
                permissionGranted = true,
                notificationsEnabled = true,
            ),
        )
    }
}
