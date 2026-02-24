package com.qybrix.silentzone

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.work.*
import java.util.concurrent.TimeUnit

/**
 * AlarmGuardWorker
 *
 * A WorkManager periodic job that runs every 15 minutes INDEPENDENTLY of the
 * React Native / JS process. It survives app death, Doze mode, and force-stop
 * (except explicit user force-stop from Settings, which no app can recover from).
 *
 * HOW IT WORKS:
 * 1. Your app schedules alarms via PersistentAlarmModule (setAlarmClock)
 * 2. PersistentAlarmModule saves alarm metadata to SharedPreferences
 * 3. Android kills your app during Deep Doze
 * 4. WorkManager wakes up this Worker every 15 minutes (OS-managed, survives app death)
 * 5. Worker reads SharedPreferences, checks if alarms still exist in AlarmManager
 * 6. If any are missing → reschedules them immediately using setAlarmClock
 * 7. Your alarm fires on time
 */
class AlarmGuardWorker(
    private val context: Context,
    workerParams: WorkerParameters
) : Worker(context, workerParams) {

    private val prefs = context.getSharedPreferences("persistent_alarms", Context.MODE_PRIVATE)
    private val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    override fun doWork(): Result {
        Log.i(TAG, "🛡️ AlarmGuard running check...")

        val now = System.currentTimeMillis()
        val allPrefs = prefs.all
        var checkedCount = 0
        var missingCount = 0
        var rescheduledCount = 0

        for ((key, value) in allPrefs) {
            if (!key.startsWith("alarm_")) continue

            val alarmId = key.removePrefix("alarm_")
            val metadata = value as? String ?: continue
            val parts = metadata.split("|")
            if (parts.size < 3) continue

            val triggerTime = parts[0].toLongOrNull() ?: continue
            val title = parts[1]
            val body = parts[2]

            checkedCount++

            // Clean up stale metadata for alarms that already fired
            if (triggerTime < now - 60_000) {
                Log.d(TAG, "🗑️ Removing stale metadata for: $alarmId")
                prefs.edit().remove(key).apply()
                continue
            }

            // Check if the alarm PendingIntent still exists in AlarmManager
            val exists = isAlarmStillScheduled(alarmId)

            if (!exists) {
                missingCount++
                Log.e(TAG, "🚨 ALARM MISSING: $alarmId")
                Log.e(TAG, "   Fires in: ${(triggerTime - now) / 60_000} min")
                Log.e(TAG, "   Was deleted by Android (Doze/battery optimization)")

                // Reschedule immediately using setAlarmClock (highest priority)
                val rescheduled = rescheduleAlarm(alarmId, triggerTime, title, body)
                if (rescheduled) {
                    rescheduledCount++
                    Log.i(TAG, "✅ Auto-rescheduled: $alarmId")
                } else {
                    Log.e(TAG, "❌ Failed to reschedule: $alarmId")
                }
            }
        }

        if (checkedCount == 0) {
            Log.i(TAG, "✅ No alarms to check")
        } else if (missingCount > 0) {
            Log.e(TAG, "🚨 Guard complete: $missingCount/$checkedCount alarms were MISSING, rescheduled $rescheduledCount")
        } else {
            Log.i(TAG, "✅ Guard complete: All $checkedCount alarms OK")
        }

        return Result.success()
    }

    /**
     * Check if a PendingIntent for this alarm still exists in AlarmManager.
     */
    private fun isAlarmStillScheduled(alarmId: String): Boolean {
        val intent = Intent(context, PersistentAlarmReceiver::class.java).apply {
            action = "com.qybrix.silentzone.ALARM_TRIGGERED"
            putExtra("alarmId", alarmId)
        }

        val pendingIntent = PendingIntent.getBroadcast(
            context,
            alarmId.hashCode(),
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )

        return pendingIntent != null
    }

    /**
     * Reschedule a deleted alarm using setAlarmClock.
     */
    private fun rescheduleAlarm(
        alarmId: String,
        triggerTime: Long,
        title: String,
        body: String
    ): Boolean {
        return try {
            val intent = Intent(context, PersistentAlarmReceiver::class.java).apply {
                action = "com.qybrix.silentzone.ALARM_TRIGGERED"
                putExtra("alarmId", alarmId)
                putExtra("title", title)
                putExtra("body", body)
            }

            val pendingIntent = PendingIntent.getBroadcast(
                context,
                alarmId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )

            val alarmClockInfo = AlarmManager.AlarmClockInfo(triggerTime, pendingIntent)
            alarmManager.setAlarmClock(alarmClockInfo, pendingIntent)

            true
        } catch (e: Exception) {
            Log.e(TAG, "Reschedule failed: ${e.message}", e)
            false
        }
    }

    companion object {
        private const val TAG = "AlarmGuardWorker"
        private const val WORK_NAME = "AlarmGuardPeriodicWork"

        fun schedule(context: Context) {
            try {
                val constraints = Constraints.Builder()
                    .build()

                val workRequest = PeriodicWorkRequestBuilder<AlarmGuardWorker>(
                    15, TimeUnit.MINUTES
                )
                    .setConstraints(constraints)
                    .setBackoffCriteria(
                        BackoffPolicy.LINEAR,
                        10, TimeUnit.MINUTES
                    )
                    .build()

                WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                    WORK_NAME,
                    ExistingPeriodicWorkPolicy.KEEP,
                    workRequest
                )

                Log.i(TAG, "🛡️ AlarmGuard scheduled (15min periodic)")
            } catch (e: IllegalStateException) {
                Log.e(TAG, "AlarmGuardWorker.schedule() failed: ${e.message}", e)
            } catch (e: Exception) {
                Log.e(TAG, "AlarmGuardWorker.schedule() unexpected error: ${e.message}", e)
            }
        }

        /**
         * Cancel the guard.
         */
        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
            Log.i(TAG, "AlarmGuard cancelled")
        }
    }
}
