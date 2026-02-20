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
    //  MAGNETIC HEADING (Compass)
    //  Returns heading in degrees (0° = North, 90° = East).
    //  Also returns raw x/y/z for sensor fusion if needed.
    // ─────────────────────────────────────────────
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

    // ─────────────────────────────────────────────
    //  BAROMETRIC PRESSURE
    //  Returns pressure in hPa.
    //  Use for floor detection: ~-1.2 hPa per 10m altitude gain.
    //  Standard sea level = 1013.25 hPa.
    // ─────────────────────────────────────────────
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

    // ─────────────────────────────────────────────
    //  ACCELEROMETER
    //  Returns x/y/z in m/s² and total magnitude.
    //  Magnitude ≈ 9.8 when still (gravity). > 12 = movement detected.
    // ─────────────────────────────────────────────
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

    // ─────────────────────────────────────────────
    //  CHECK SENSOR AVAILABILITY
    //  Call before relying on any sensor.
    //  sensorType: "step_counter" | "magnetometer" | "barometer" | "accelerometer"
    // ─────────────────────────────────────────────
    @ReactMethod
    fun isSensorAvailable(sensorType: String, promise: Promise) {
        val androidSensorType = when (sensorType) {
            "step_counter"  -> Sensor.TYPE_STEP_COUNTER
            "magnetometer"  -> Sensor.TYPE_MAGNETIC_FIELD
            "barometer"     -> Sensor.TYPE_PRESSURE
            "accelerometer" -> Sensor.TYPE_ACCELEROMETER
            else -> {
                promise.reject("UNKNOWN_SENSOR", "Unknown sensor type: $sensorType")
                return
            }
        }
        val available = sensorManager.getDefaultSensor(androidSensorType) != null
        promise.resolve(available)
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
        val latch = CountDownLatch(1)
        var resultMap: WritableMap? = null
        var errorMessage: String? = null

        val listener = object : SensorEventListener {
            override fun onSensorChanged(event: SensorEvent) {
                if (event.sensor.type == sensor.type && resultMap == null) {
                    try {
                        resultMap = transform(event)
                    } catch (e: Exception) {
                        errorMessage = "Failed to read sensor value: ${e.message}"
                    } finally {
                        latch.countDown()
                    }
                }
            }
            override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
        }

        sensorManager.registerListener(listener, sensor, SensorManager.SENSOR_DELAY_FASTEST)

        val completed = latch.await(timeoutSeconds, TimeUnit.SECONDS)
        sensorManager.unregisterListener(listener)

        if (!completed && resultMap == null) {
            errorMessage = "Sensor timed out after ${timeoutSeconds}s — sensor may be unavailable or warming up"
        }

        return Pair(resultMap, errorMessage)
    }
}
