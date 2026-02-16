package com.qybrix.silentzone

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.util.Log
import com.facebook.react.bridge.*
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.*
import android.app.NotificationChannel
import android.app.NotificationManager as AndroidNotificationManager

/**
 * PersistentAlarmModule - Ultra-reliable alarm scheduling with Doze protection
 * 
 * FEATURES:
 * 1. Uses setAlarmClock() - highest priority, bypasses all Doze restrictions
 * 2. Persistent storage - tracks alarms in SharedPreferences
 * 3. Self-healing - checks every 15 minutes if alarms still exist
 * 4. Wake locks - ensures CPU stays awake when alarm fires
 * 5. Boot recovery - automatically reschedules after device restart
 * 
 * This solves your overnight alarm deletion problem.
 */
class PersistentAlarmModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    private val alarmManager: AlarmManager = reactContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    private val prefs = reactContext.getSharedPreferences("persistent_alarms", Context.MODE_PRIVATE)
    private var verificationJob: Job? = null
    
    override fun getName(): String = "PersistentAlarmModule"
    
    /**
     * Schedule an alarm with maximum persistence and priority
     * 
     * @param alarmId Unique identifier (e.g., "place-123-start")
     * @param triggerTimeMs Unix timestamp when alarm should fire
     * @param title Notification title
     * @param body Notification body
     * @param data Extra data to pass when alarm fires
     */
    @ReactMethod
    fun scheduleAlarm(
        alarmId: String,
        triggerTimeMs: Double,
        title: String,
        body: String,
        data: ReadableMap,
        promise: Promise
    ) {
        try {
            val triggerTime = triggerTimeMs.toLong()
            val now = System.currentTimeMillis()
            
            if (triggerTime <= now) {
                promise.reject("INVALID_TIME", "Alarm time must be in the future")
                return
            }
            
            Log.d(TAG, "Scheduling alarm: $alarmId for ${java.util.Date(triggerTime)}")
            
            // Create intent for alarm receiver
            val intent = Intent(reactApplicationContext, PersistentAlarmReceiver::class.java).apply {
                action = ACTION_ALARM_TRIGGERED
                putExtra(EXTRA_ALARM_ID, alarmId)
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_BODY, body)
                putExtra(EXTRA_DATA, Arguments.toBundle(data))
            }
            
            val pendingIntent = PendingIntent.getBroadcast(
                reactApplicationContext,
                alarmId.hashCode(),
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // 🔥 CRITICAL: Use setAlarmClock() - the ONLY type that survives Doze
            // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            // This is what Google Clock app uses. It:
            // - Bypasses ALL Doze restrictions
            // - Bypasses battery optimization
            // - Shows clock icon on lock screen
            // - Guarantees exact timing
            // - Survives overnight deep sleep
            
            val alarmClockInfo = AlarmManager.AlarmClockInfo(triggerTime, pendingIntent)
            alarmManager.setAlarmClock(alarmClockInfo, pendingIntent)
            
            // Store alarm metadata for verification and boot recovery
            saveAlarmMetadata(alarmId, triggerTime, title, body, data)
            
            // Start verification timer if not already running
            startAlarmVerification()
            
            Log.i(TAG, "✅ Alarm scheduled successfully: $alarmId")
            Log.i(TAG, "   Type: setAlarmClock (highest priority)")
            Log.i(TAG, "   Fires in: ${(triggerTime - now) / 60000} minutes")
            
            promise.resolve(true)
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to schedule alarm: ${e.message}", e)
            promise.reject("SCHEDULE_ERROR", e.message, e)
        }
    }
    
    /**
     * Cancel a specific alarm
     */
    @ReactMethod
    fun cancelAlarm(alarmId: String, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, PersistentAlarmReceiver::class.java).apply {
                action = ACTION_ALARM_TRIGGERED
            }
            
            val pendingIntent = PendingIntent.getBroadcast(
                reactApplicationContext,
                alarmId.hashCode(),
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            
            if (pendingIntent != null) {
                alarmManager.cancel(pendingIntent)
                pendingIntent.cancel()
            }
            
            removeAlarmMetadata(alarmId)
            
            Log.i(TAG, "✅ Alarm cancelled: $alarmId")
            promise.resolve(true)
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to cancel alarm: ${e.message}", e)
            promise.reject("CANCEL_ERROR", e.message, e)
        }
    }
    
    /**
     * Get diagnostic info about all scheduled alarms
     */
    @ReactMethod
    fun getAllAlarms(promise: Promise) {
        try {
            val allAlarms = prefs.all
            val result = Arguments.createArray()
            
            for ((key, value) in allAlarms) {
                if (key.startsWith("alarm_")) {
                    val alarmId = key.removePrefix("alarm_")
                    val metadata = value as? String ?: continue
                    val parts = metadata.split("|")
                    
                    if (parts.size >= 4) {
                        val triggerTime = parts[0].toLongOrNull() ?: continue
                        val title = parts[1]
                        val body = parts[2]
                        
                        val alarmMap = Arguments.createMap().apply {
                            putString("id", alarmId)
                            putDouble("triggerTime", triggerTime.toDouble())
                            putString("title", title)
                            putString("body", body)
                            putDouble("minutesUntilFire", ((triggerTime - System.currentTimeMillis()) / 60000.0))
                        }
                        
                        result.pushMap(alarmMap)
                    }
                }
            }
            
            promise.resolve(result)
            
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get alarms: ${e.message}", e)
            promise.reject("GET_ALARMS_ERROR", e.message, e)
        }
    }
    
    /**
     * Manually trigger alarm verification check
     */
    @ReactMethod
    fun verifyAlarms(promise: Promise) {
        try {
            CoroutineScope(Dispatchers.IO).launch {
                val result = performAlarmVerification()
                promise.resolve(result)
            }
        } catch (e: Exception) {
            promise.reject("VERIFY_ERROR", e.message, e)
        }
    }
    
    /**
     * Check if a specific alarm still exists in the system
     */
    @ReactMethod
    fun isAlarmScheduled(alarmId: String, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, PersistentAlarmReceiver::class.java).apply {
                action = ACTION_ALARM_TRIGGERED
            }
            
            val pendingIntent = PendingIntent.getBroadcast(
                reactApplicationContext,
                alarmId.hashCode(),
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            
            val exists = pendingIntent != null
            promise.resolve(exists)
            
        } catch (e: Exception) {
            promise.reject("CHECK_ERROR", e.message, e)
        }
    }
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ALARM PERSISTENCE & VERIFICATION (The Secret Sauce)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    /**
     * Save alarm metadata to SharedPreferences for persistence
     */
    private fun saveAlarmMetadata(
        alarmId: String,
        triggerTime: Long,
        title: String,
        body: String,
        data: ReadableMap
    ) {
        val metadata = "$triggerTime|$title|$body|${Arguments.toBundle(data)}"
        prefs.edit().putString("alarm_$alarmId", metadata).apply()
        Log.d(TAG, "💾 Saved alarm metadata: $alarmId")
    }
    
    /**
     * Remove alarm metadata from storage
     */
    private fun removeAlarmMetadata(alarmId: String) {
        prefs.edit().remove("alarm_$alarmId").apply()
        Log.d(TAG, "🗑️ Removed alarm metadata: $alarmId")
    }
    
    /**
     * Start background verification that checks alarms every 15 minutes
     * This detects if Android silently cancelled alarms during Doze
     */
    private fun startAlarmVerification() {
        if (verificationJob?.isActive == true) {
            Log.d(TAG, "Verification already running")
            return
        }
        
        verificationJob = CoroutineScope(Dispatchers.IO).launch {
            Log.i(TAG, "🛡️ Alarm Guardian started (15min checks)")
            
            while (isActive) {
                delay(15 * 60 * 1000) // Check every 15 minutes
                performAlarmVerification()
            }
        }
    }
    
    /**
     * Verify all scheduled alarms still exist, reschedule if missing
     * Returns: number of alarms that were missing and needed rescheduling
     */
    private fun performAlarmVerification(): Int {
        Log.d(TAG, "🔍 Starting alarm verification...")
        
        val allAlarms = prefs.all
        val now = System.currentTimeMillis()
        var missingCount = 0
        var rescheduledCount = 0
        
        for ((key, value) in allAlarms) {
            if (!key.startsWith("alarm_")) continue
            
            val alarmId = key.removePrefix("alarm_")
            val metadata = value as? String ?: continue
            val parts = metadata.split("|")
            
            if (parts.size < 3) continue
            
            val triggerTime = parts[0].toLongOrNull() ?: continue
            
            // Skip alarms that should have already fired
            if (triggerTime < now) {
                Log.d(TAG, "⏰ Alarm $alarmId is in the past, removing metadata")
                removeAlarmMetadata(alarmId)
                continue
            }
            
            // Check if alarm still exists in system
            val intent = Intent(reactApplicationContext, PersistentAlarmReceiver::class.java).apply {
                action = ACTION_ALARM_TRIGGERED
            }
            
            val pendingIntent = PendingIntent.getBroadcast(
                reactApplicationContext,
                alarmId.hashCode(),
                intent,
                PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
            )
            
            if (pendingIntent == null) {
                // 🚨 ALARM WAS DELETED BY ANDROID!
                missingCount++
                
                Log.e(TAG, "🚨 ALARM MISSING: $alarmId")
                Log.e(TAG, "   Should fire in: ${(triggerTime - now) / 60000} minutes")
                Log.e(TAG, "   Likely cause: Battery optimization enabled OR Doze mode")
                
                // Auto-reschedule the alarm
                try {
                    val title = parts[1]
                    val body = parts[2]
                    
                    val newIntent = Intent(reactApplicationContext, PersistentAlarmReceiver::class.java).apply {
                        action = ACTION_ALARM_TRIGGERED
                        putExtra(EXTRA_ALARM_ID, alarmId)
                        putExtra(EXTRA_TITLE, title)
                        putExtra(EXTRA_BODY, body)
                    }
                    
                    val newPendingIntent = PendingIntent.getBroadcast(
                        reactApplicationContext,
                        alarmId.hashCode(),
                        newIntent,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                    )
                    
                    val alarmClockInfo = AlarmManager.AlarmClockInfo(triggerTime, newPendingIntent)
                    alarmManager.setAlarmClock(alarmClockInfo, newPendingIntent)
                    
                    rescheduledCount++
                    Log.i(TAG, "✅ Auto-rescheduled: $alarmId")
                    
                    // Notify JS side
                    sendEventToJS("onAlarmRescheduled", Arguments.createMap().apply {
                        putString("alarmId", alarmId)
                        putDouble("triggerTime", triggerTime.toDouble())
                        putString("reason", "DETECTED_MISSING")
                    })
                    
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to reschedule alarm: ${e.message}", e)
                }
            }
        }
        
        if (missingCount > 0) {
            Log.e(TAG, "🚨 VERIFICATION COMPLETE: $missingCount alarms were MISSING")
            Log.e(TAG, "   Rescheduled: $rescheduledCount")
            Log.e(TAG, "   ⚠️ CHECK BATTERY OPTIMIZATION SETTINGS!")
        } else {
            Log.i(TAG, "✅ Verification complete: All alarms OK")
        }
        
        return missingCount
    }
    
    /**
     * Send event to JavaScript side
     */
    private fun sendEventToJS(eventName: String, data: WritableMap) {
        reactApplicationContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, data)
    }
    
    /**
     * Called when module is destroyed
     */
    override fun onCatalystInstanceDestroy() {
        verificationJob?.cancel()
        super.onCatalystInstanceDestroy()
    }
    
    companion object {
        internal const val TAG = "PersistentAlarm"
        internal const val ACTION_ALARM_TRIGGERED = "com.qybrix.silentzone.ALARM_TRIGGERED"
        internal const val EXTRA_ALARM_ID = "alarmId"
        internal const val EXTRA_TITLE = "title"
        internal const val EXTRA_BODY = "body"
        internal const val EXTRA_DATA = "data"
    }
}

/**
 * BroadcastReceiver that handles alarm firing with wake lock
 */
class PersistentAlarmReceiver : BroadcastReceiver() {
    
    override fun onReceive(context: Context, intent: Intent) {
        val alarmId = intent.getStringExtra(PersistentAlarmModule.EXTRA_ALARM_ID) ?: return
        
        Log.i(TAG, "⚡ Alarm FIRED: $alarmId")
        
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // 🔥 CRITICAL: Acquire wake lock IMMEDIATELY
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Without this, the CPU can go back to sleep before your JS code runs!
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "SilentZone::AlarmWakeLock"
        )
        
        // Hold wake lock for 60 seconds (enough time for JS to initialize)
        wakeLock.acquire(60000)
        
        try {
            // Trigger JavaScript alarm handler
            val title = intent.getStringExtra(PersistentAlarmModule.EXTRA_TITLE) ?: ""
            val body = intent.getStringExtra(PersistentAlarmModule.EXTRA_BODY) ?: ""
            val data = intent.getBundleExtra(PersistentAlarmModule.EXTRA_DATA)
            
            // Start headless JS task to handle alarm
            val serviceIntent = Intent(context, AlarmHandlerService::class.java).apply {
                putExtra(PersistentAlarmModule.EXTRA_ALARM_ID, alarmId)
                putExtra(PersistentAlarmModule.EXTRA_TITLE, title)
                putExtra(PersistentAlarmModule.EXTRA_BODY, body)
                putExtra(PersistentAlarmModule.EXTRA_DATA, data)
                putExtra("wakeLockId", wakeLock.hashCode())
            }
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
            
            Log.i(TAG, "✅ Alarm handler service started with wake lock")
            
        } catch (e: Exception) {
            Log.e(TAG, "Error handling alarm: ${e.message}", e)
            wakeLock.release()
        }
    }
    
    companion object {
        internal const val TAG = "AlarmReceiver"
    }
}

/**
 * Headless JS task service for handling alarms in background
 */
class AlarmHandlerService : com.facebook.react.HeadlessJsTaskService() {
    
    override fun onCreate() {
        super.onCreate()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channelId = "com.qybrix.silentzone.service"
            val androidNm = getSystemService(Context.NOTIFICATION_SERVICE) as AndroidNotificationManager

            // Create channel if it doesn't exist yet (safe to call multiple times)
            if (androidNm.getNotificationChannel(channelId) == null) {
                val channel = NotificationChannel(
                    channelId,
                    "Silent Zone Engine",
                    AndroidNotificationManager.IMPORTANCE_LOW  // LOW = no sound, no popup
                ).apply {
                    description = "Keeps alarm processing alive in background"
                    setShowBadge(false)
                }
                androidNm.createNotificationChannel(channel)
                Log.i(TAG, "✅ Created notification channel: $channelId")
            }

            val notification = android.app.Notification.Builder(this, channelId)
                .setContentTitle("🛡️ Silent Zone Engine")
                .setContentText("Optimizing background sync...")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .build()

            startForeground(101, notification)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val result = super.onStartCommand(intent, flags, startId)
        
        // If the task finishes, super.onStartCommand will eventually stop the service.
        // We don't need to manually stopForeground here as we want to keep it
        // until the Headless JS task completes.
        
        return result
    }

    override fun getTaskConfig(intent: Intent?): com.facebook.react.jstasks.HeadlessJsTaskConfig? {
        val alarmId = intent?.getStringExtra(PersistentAlarmModule.EXTRA_ALARM_ID) ?: return null
        val dataBundle = intent.getBundleExtra(PersistentAlarmModule.EXTRA_DATA)
        
        return com.facebook.react.jstasks.HeadlessJsTaskConfig(
            "AlarmHandler",  // Task name to register in index.js
            Arguments.createMap().apply {
                putString("alarmId", alarmId)
                putString("title", intent.getStringExtra(PersistentAlarmModule.EXTRA_TITLE))
                putString("body", intent.getStringExtra(PersistentAlarmModule.EXTRA_BODY))
                putDouble("timestamp", System.currentTimeMillis().toDouble())
                
                // Add the extra data bundle if it exists
                if (dataBundle != null) {
                    putMap("data", Arguments.fromBundle(dataBundle))
                }
            },
            120000,  // Timeout: 2 minutes
            true     // Allow execution in foreground
        )
    }
    
    companion object {
        internal const val TAG = "AlarmHandler"
    }
}
