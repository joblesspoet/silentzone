/**
 * SZSensorModule — TypeScript Bridge
 * Wraps the native Android SensorModule for use in JS/TS.
 *
 * All methods are one-shot reads — safe for HeadlessJS alarm tasks.
 */
import { NativeModules } from 'react-native';

const { SZSensorModule } = NativeModules;

export interface StepCountResult {
  steps: number;       // Total steps since last device reboot
  timestamp: number;
}

export interface MagneticHeadingResult {
  heading: number;     // 0° = North, 90° = East, 180° = South, 270° = West
  x: number;           // Raw magnetometer X (microtesla)
  y: number;           // Raw magnetometer Y (microtesla)
  z: number;           // Raw magnetometer Z (microtesla)
  timestamp: number;
}

export interface BarometricPressureResult {
  pressureHPa: number; // Atmospheric pressure in hectopascals
  altitudeM: number;   // Estimated altitude above sea level in metres
  timestamp: number;
}

export interface AccelerationResult {
  x: number;           // m/s² (includes gravity)
  y: number;
  z: number;
  magnitude: number;   // ~9.8 when still, >12 when moving
  timestamp: number;
}

export type SensorType = 'step_counter' | 'magnetometer' | 'barometer' | 'accelerometer';

/**
 * Read the hardware step counter.
 * Returns total steps since last device reboot.
 * Store baseline on check-in; use delta for dead reckoning.
 *
 * Requires: ACTIVITY_RECOGNITION permission (Android 10+)
 */
export function getStepCount(): Promise<StepCountResult> {
  return SZSensorModule.getStepCount();
}

/**
 * Read the compass heading once.
 * 0° = North, 90° = East, 180° = South, 270° = West.
 * Used for determining direction of travel in dead reckoning.
 */
export function getMagneticHeading(): Promise<MagneticHeadingResult> {
  return SZSensorModule.getMagneticHeading();
}

/**
 * Read atmospheric pressure from barometer.
 * Use pressureHPa to fingerprint a floor level (saves ~1.2 hPa per 10m altitude change).
 * Use altitudeM for rough elevation.
 */
export function getBarometricPressure(): Promise<BarometricPressureResult> {
  return SZSensorModule.getBarometricPressure();
}

/**
 * Read accelerometer values once.
 * magnitude ≈ 9.8 = stationary (gravity only)
 * magnitude > 12  = user is moving
 * Used by MotionClassifier to detect walk/vehicle/stationary.
 */
export function getAcceleration(): Promise<AccelerationResult> {
  return SZSensorModule.getAcceleration();
}

/**
 * Check if a specific sensor is physically present on the device.
 * Always call this before relying on a sensor (cheap devices may lack some).
 */
export function isSensorAvailable(sensorType: SensorType): Promise<boolean> {
  return SZSensorModule.isSensorAvailable(sensorType);
}

/**
 * Convenience: check all 4 SFPE sensors at once.
 * Returns an object showing which sensors are available on this device.
 */
export async function checkAllSensors(): Promise<Record<SensorType, boolean>> {
  const [stepCounter, magnetometer, barometer, accelerometer] = await Promise.all([
    isSensorAvailable('step_counter'),
    isSensorAvailable('magnetometer'),
    isSensorAvailable('barometer'),
    isSensorAvailable('accelerometer'),
  ]);
  return { step_counter: stepCounter, magnetometer, barometer, accelerometer };
}

export default {
  getStepCount,
  getMagneticHeading,
  getBarometricPressure,
  getAcceleration,
  isSensorAvailable,
  checkAllSensors,
};
