package com.qybrix.silentzone

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

/**
 * BootReceiver - Handles device reboot to reschedule alarms
 *
 * When the device restarts, all AlarmManager alarms are cleared by Android. This receiver triggers
 * a headless JS task that will reinitialize the app and reschedule all necessary alarms.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action

        Log.d(TAG, "BootReceiver triggered with action: $action")

        if (action == Intent.ACTION_BOOT_COMPLETED ||
                        action == Intent.ACTION_LOCKED_BOOT_COMPLETED ||
                        action == "android.intent.action.QUICKBOOT_POWERON" ||
                        action == "com.htc.intent.action.QUICKBOOT_POWERON"
        ) {

            Log.i(TAG, "Device rebooted - Starting alarm rescheduling service")

            // Re-arm the native guard on boot
            AlarmGuardWorker.schedule(context)

            // Start the headless JS task to reschedule alarms
            val serviceIntent = Intent(context, BootRescheduleService::class.java)
            context.startService(serviceIntent)
        }
    }

    companion object {
        internal const val TAG = "SilentZone.BootReceiver"
    }
}

/** BootRescheduleService - Headless JS task service for rescheduling alarms after boot */
class BootRescheduleService : HeadlessJsTaskService() {

    override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
        Log.d(TAG, "BootRescheduleService started")

        return HeadlessJsTaskConfig(
                "BootRescheduleTask",
                Arguments.createMap().apply {
                    putString("reason", "DEVICE_REBOOTED")
                    putDouble("timestamp", System.currentTimeMillis().toDouble())
                },
                30000,
                false
        )
    }

    companion object {
        internal const val TAG = "SilentZone.BootService"
    }
}
