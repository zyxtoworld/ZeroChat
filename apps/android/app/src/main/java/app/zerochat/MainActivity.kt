package app.zerochat

import android.Manifest
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.util.Log
import android.view.MotionEvent
import android.view.inputmethod.InputMethodManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableLongStateOf
import androidx.core.content.edit
import androidx.lifecycle.ViewModelProvider
import app.zerochat.sync.LocalUserTriggeredSyncAction
import app.zerochat.sync.SyncNotificationPermissionGate
import app.zerochat.sync.shouldRequestPostNotifications
import app.zerochat.ui.ZeroChatApp
import app.zerochat.ui.settings.BackupTaskViewModel
import java.util.concurrent.atomic.AtomicLong

class MainActivity : ComponentActivity() {
    private val lifecycleInstanceId = nextLifecycleInstanceId.getAndIncrement()
    private val quickAskDeliveryCount = mutableLongStateOf(0L)
    private val quickAskOwner = QuickAskActivityOwner()
    private val backupTaskViewModel by lazy(LazyThreadSafetyMode.NONE) {
        ViewModelProvider(this)[BackupTaskViewModel::class.java]
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN && isImeVisible()) {
            currentFocus?.clearFocus()
            getSystemService(InputMethodManager::class.java)
                ?.hideSoftInputFromWindow(window.decorView.windowToken, 0)
        }
        return super.dispatchTouchEvent(event)
    }

    private fun isImeVisible(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
            window.decorView.rootWindowInsets?.isVisible(android.view.WindowInsets.Type.ime()) == true

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        if (isDebuggable()) {
            Log.i(
                ACTIVITY_LIFECYCLE_LOG_TAG,
                "event=created instance=$lifecycleInstanceId pid=${Process.myPid()}",
            )
        }
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
        val savedQuickAskConsumed =
            savedInstanceState?.getBoolean(QUICK_ASK_CONSUMED_STATE_KEY, false) == true
        quickAskDeliveryCount.longValue = quickAskOwner.onCreate(
            savedQuickAskConsumed,
            QuickAskIntents.isQuickAsk(intent),
        )
        setContent {
            CompositionLocalProvider(
                LocalUserTriggeredSyncAction provides notificationPermissionGate,
            ) {
                ZeroChatApp(
                    quickAskDeliveryCount = quickAskDeliveryCount.longValue,
                    backupTaskViewModel = backupTaskViewModel,
                )
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean(QUICK_ASK_CONSUMED_STATE_KEY, quickAskOwner.consumedForInstance)
        super.onSaveInstanceState(outState)
    }

    override fun onDestroy() {
        if (isDebuggable()) {
            Log.i(
                ACTIVITY_LIFECYCLE_LOG_TAG,
                "event=destroyed instance=$lifecycleInstanceId pid=${Process.myPid()} " +
                    "changingConfigurations=$isChangingConfigurations",
            )
        }
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        quickAskDeliveryCount.longValue = quickAskOwner.onNewIntent(
            QuickAskIntents.isQuickAsk(intent),
        )
    }

    private fun isDebuggable(): Boolean =
        applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0

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
        const val ACTIVITY_LIFECYCLE_LOG_TAG = "ZeroChatActivityLifecycle"
        const val NOTIFICATION_PERMISSION_PREFERENCES = "notification_permissions"
        const val NOTIFICATION_PERMISSION_REQUESTED = "post_notifications_requested"
        val nextLifecycleInstanceId = AtomicLong(1L)
    }
}
