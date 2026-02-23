package com.qybrix.silentzone

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.bridge.Arguments
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.atan2
import kotlin.math.sqrt

/**
 * SZSensorModule — SFPE Sensor Bridge
 *
 * Provides one-shot sensor reads safe for use in HeadlessJS alarm tasks.
 * Each method: subscribes → waits for 1 reading (max 2s) → unsubscribes → resolves promise.
 *
 * Android APIs learned from expo-sensors source:
 *  - Step counter : Sensor.TYPE_STEP_COUNTER  → values[0] = total steps since reboot
 *  - Magnetometer : Sensor.TYPE_MAGNETIC_FIELD → values[0,1,2] = x,y,z microtesla
 *  - Barometer    : Sensor.TYPE_PRESSURE       → values[0] = hPa
 *  - Accelerometer: Sensor.TYPE_ACCELEROMETER  → values[0,1,2] = x,y,z m/s²
 */
class SensorModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val sensorManager: SensorManager =
        reactContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager

    override fun getName(): String = "SZSensorModule"

    // ─────────────────────────────────────────────
    //  STEP COUNTER
    //  Returns total steps since last device reboot.
    //  Store baseline on check-in; delta = current - baseline.
    // ─────────────────────────────────────────────
    @ReactMethod
    fun getStepCount(promise: Promise) {
        if (!hasActivityPermission()) {
            promise.reject("PERMISSION_DENIED", "ACTIVITY_RECOGNITION permission required for step counter")
            return
        }
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        if (sensor == null) {
            promise.reject("SENSOR_UNAVAILABLE", "Step counter not available on this device")
            return
        }
        readOneSensorValue(sensor, timeoutSeconds = 3L) { event ->
            val map = Arguments.createMap()
            map.putDouble("steps", event.values[0].toDouble())
            map.putDouble("timestamp", System.currentTimeMillis().toDouble())
            map
        }.let { (result, error) ->
            if (error != null) promise.reject("READ_ERROR", error)
            else promise.resolve(result)
        }
    }

    // ─────────────────────────────────────────────
    //  STEP DETECTOR
    //  Fires once for every step taken. Returns 1.0.
    //  Used to verify hardware is reactive even if cumulative counter is sluggish.
    // ─────────────────────────────────────────────
    @ReactMethod
    fun getStepDetector(promise: Promise) {
        if (!hasActivityPermission()) {
            promise.reject("PERMISSION_DENIED", "ACTIVITY_RECOGNITION permission required for step detector")
            return
        }
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
        if (sensor == null) {
            promise.reject("SENSOR_UNAVAILABLE", "Step detector not available on this device")
            return
        }
        readOneSensorValue(sensor, timeoutSeconds = 5L) { event ->
            val map = Arguments.createMap()
            map.putDouble("detected", event.values[0].toDouble())
            map.putDouble("timestamp", System.currentTimeMillis().toDouble())
            map
        }.let { (result, error) ->
            if (error != null) promise.reject("READ_ERROR", error)
            else promise.resolve(result)
        }
    }

    // ─────────────────────────────────────────────
    //  SENSOR METADATA
    //  Returns name and vendor of the hardware sensor.
    // ─────────────────────────────────────────────
    @ReactMethod
    fun getSensorInfo(sensorType: String, promise: Promise) {
        val androidSensorType = getAndroidSensorType(sensorType)
        if (androidSensorType == -1) {
            promise.reject("UNKNOWN_SENSOR", "Unknown sensor type: $sensorType")
            return
        }
        val sensor = sensorManager.getDefaultSensor(androidSensorType)
        if (sensor == null) {
            promise.reject("SENSOR_UNAVAILABLE", "Sensor $sensorType not available")
            return
        }
        val map = Arguments.createMap()
        map.putString("name", sensor.name)
        map.putString("vendor", sensor.vendor)
        map.putInt("version", sensor.version)
        map.putDouble("power", sensor.power.toDouble())
        promise.resolve(map)
    }

    @ReactMethod
    fun getMagneticHeading(promise: Promise) {
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_MAGNETIC_FIELD)
        if (sensor == null) {
            promise.reject("SENSOR_UNAVAILABLE", "Magnetometer not available on this device")
            return
        }
        readOneSensorValue(sensor, timeoutSeconds = 2L) { event ->
            val x = event.values[0].toDouble()
            val y = event.values[1].toDouble()
            val z = event.values[2].toDouble()
            // Heading: 0° = North, increases clockwise
            var heading = Math.toDegrees(atan2(y, x)).toFloat()
            if (heading < 0) heading += 360f
            val map = Arguments.createMap()
            map.putDouble("heading", heading.toDouble())
            map.putDouble("x", x)
            map.putDouble("y", y)
            map.putDouble("z", z)
            map.putDouble("timestamp", System.currentTimeMillis().toDouble())
            map
        }.let { (result, error) ->
            if (error != null) promise.reject("READ_ERROR", error)
            else promise.resolve(result)
        }
    }

    @ReactMethod
    fun getBarometricPressure(promise: Promise) {
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_PRESSURE)
        if (sensor == null) {
            promise.reject("SENSOR_UNAVAILABLE", "Barometer not available on this device")
            return
        }
        readOneSensorValue(sensor, timeoutSeconds = 2L) { event ->
            val pressureHPa = event.values[0].toDouble()
            // Altitude estimate from pressure (relative to sea level)
            val altitudeM = SensorManager.getAltitude(SensorManager.PRESSURE_STANDARD_ATMOSPHERE, event.values[0])
            val map = Arguments.createMap()
            map.putDouble("pressureHPa", pressureHPa)
            map.putDouble("altitudeM", altitudeM.toDouble())
            map.putDouble("timestamp", System.currentTimeMillis().toDouble())
            map
        }.let { (result, error) ->
            if (error != null) promise.reject("READ_ERROR", error)
            else promise.resolve(result)
        }
    }

    @ReactMethod
    fun getAcceleration(promise: Promise) {
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        if (sensor == null) {
            promise.reject("SENSOR_UNAVAILABLE", "Accelerometer not available on this device")
            return
        }
        readOneSensorValue(sensor, timeoutSeconds = 2L) { event ->
            val x = event.values[0].toDouble()
            val y = event.values[1].toDouble()
            val z = event.values[2].toDouble()
            val magnitude = sqrt(x * x + y * y + z * z)
            val map = Arguments.createMap()
            map.putDouble("x", x)
            map.putDouble("y", y)
            map.putDouble("z", z)
            map.putDouble("magnitude", magnitude)
            map.putDouble("timestamp", System.currentTimeMillis().toDouble())
            map
        }.let { (result, error) ->
            if (error != null) promise.reject("READ_ERROR", error)
            else promise.resolve(result)
        }
    }

    @ReactMethod
    fun isSensorAvailable(sensorType: String, promise: Promise) {
        val androidSensorType = getAndroidSensorType(sensorType)
        val available = if (androidSensorType == -1) false else sensorManager.getDefaultSensor(androidSensorType) != null
        promise.resolve(available)
    }

    @ReactMethod
    fun checkActivityPermission(promise: Promise) {
        promise.resolve(hasActivityPermission())
    }

    private fun getAndroidSensorType(type: String): Int {
        return when (type) {
            "step_counter"  -> Sensor.TYPE_STEP_COUNTER
            "step_detector" -> Sensor.TYPE_STEP_DETECTOR
            "magnetometer"  -> Sensor.TYPE_MAGNETIC_FIELD
            "barometer"     -> Sensor.TYPE_PRESSURE
            "accelerometer" -> Sensor.TYPE_ACCELEROMETER
            else -> -1
        }
    }

    private var stepListener: SensorEventListener? = null
    private var lastEmittedStepCount: Float = -1f

    @ReactMethod
    fun startStepWatching(promise: Promise) {
        if (!hasActivityPermission()) {
            promise.reject("PERMISSION_DENIED", "ACTIVITY_RECOGNITION permission required")
            return
        }
        val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        if (sensor == null) {
            promise.reject("SENSOR_UNAVAILABLE", "Step counter not available")
            return
        }

        if (stepListener != null) {
            promise.resolve(true)
            return
        }

        stepListener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (event.sensor.type == Sensor.TYPE_STEP_COUNTER) {
                    val steps = event.values[0]
                    if (steps != lastEmittedStepCount) {
                        lastEmittedStepCount = steps
                        emitStepEvent(steps)
                    }
                }
            }
            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
        }

        val success = sensorManager.registerListener(stepListener, sensor, SensorManager.SENSOR_DELAY_NORMAL)
        if (success) {
            android.util.Log.d("SZSensorModule", "Started persistent step watching")
            promise.resolve(true)
        } else {
            stepListener = null
            promise.reject("REGISTRATION_FAILED", "Could not register step listener")
        }
    }

    @ReactMethod
    fun stopStepWatching(promise: Promise) {
        stepListener?.let {
            sensorManager.unregisterListener(it)
            stepListener = null
            android.util.Log.d("SZSensorModule", "Stopped persistent step watching")
        }
        promise.resolve(true)
    }

    private fun emitStepEvent(steps: Float) {
        val map = Arguments.createMap()
        map.putDouble("steps", steps.toDouble())
        map.putDouble("timestamp", System.currentTimeMillis().toDouble())
        
        reactApplicationContext
            .getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("onStepUpdate", map)
    }

    private fun hasActivityPermission(): Boolean {
        return if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            val permission = android.Manifest.permission.ACTIVITY_RECOGNITION
            val res = reactApplicationContext.checkSelfPermission(permission)
            res == android.content.pm.PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }


    // ─────────────────────────────────────────────
    //  INTERNAL: One-shot sensor read helper
    //  Subscribes → waits for 1 event → unsubscribes → returns value.
    //  Thread-safe via CountDownLatch.
    // ─────────────────────────────────────────────
    private fun readOneSensorValue(
        sensor: Sensor,
        timeoutSeconds: Long,
        transform: (SensorEvent) -> WritableMap
    ): Pair<WritableMap?, String?> {
        val TAG = "SZSensorModule"
        android.util.Log.d(TAG, "Registering one-shot for ${sensor.name} (Type: ${sensor.type})")
        
        val latch = CountDownLatch(1)
        var resultMap: WritableMap? = null
        var errorMessage: String? = null

        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (event.sensor.type == sensor.type && resultMap == null) {
                    android.util.Log.d(TAG, "Received event for ${sensor.name}: ${event.values[0]}")
                    try {
                        resultMap = transform(event)
                    } catch (e: Exception) {
                        errorMessage = "Failed to read sensor value: ${e.message}"
                        android.util.Log.e(TAG, "Transform error: ${e.message}")
                    } finally {
                        latch.countDown()
                    }
                }
            }
            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
                android.util.Log.d(TAG, "Accuracy changed for ${sensor.name}: $accuracy")
            }
        }

        // Use NORMAL for steps to satisfy low-power batching sensors
        val delay = if (sensor.type == Sensor.TYPE_STEP_COUNTER || sensor.type == Sensor.TYPE_STEP_DETECTOR) {
            SensorManager.SENSOR_DELAY_NORMAL
        } else {
            SensorManager.SENSOR_DELAY_FASTEST
        }

        val success = sensorManager.registerListener(listener, sensor, delay)
        if (!success) {
            android.util.Log.e(TAG, "Failed to register listener for ${sensor.name}")
            return Pair(null, "System failed to register sensor listener")
        }

        val completed = try {
            latch.await(timeoutSeconds, TimeUnit.SECONDS)
        } catch (e: InterruptedException) {
            false
        }
        
        sensorManager.unregisterListener(listener)

        if (!completed && resultMap == null) {
            android.util.Log.w(TAG, "Timeout waiting for ${sensor.name}")
            errorMessage = "Sensor timed out after ${timeoutSeconds}s — sensor may be asleep or blocked by OS"
        } else if (resultMap != null) {
            android.util.Log.d(TAG, "Successfully read ${sensor.name}")
        }

        return Pair(resultMap, errorMessage)
    }
}
