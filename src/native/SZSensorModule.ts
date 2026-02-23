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

export type SensorType = 'step_counter' | 'step_detector' | 'magnetometer' | 'barometer' | 'accelerometer';

/**
 * Read the hardware step counter.
 * Returns total steps since last device reboot.
 */
export function getStepCount(): Promise<StepCountResult> {
  return SZSensorModule.getStepCount();
}

/**
 * Read the physical step detector.
 * Returns { detected: 1.0 } when a single step occurs.
 * Unlike counter, this is a real-time event.
 */
export function getStepDetector(): Promise<{ detected: number; timestamp: number }> {
  return SZSensorModule.getStepDetector();
}

/**
 * Get hardware-level metadata about a sensor (Name, Vendor, Power usage).
 */
export interface SensorInfo {
  name: string;
  vendor: string;
  version: number;
  power: number;
}
export function getSensorInfo(sensorType: SensorType): Promise<SensorInfo> {
  return SZSensorModule.getSensorInfo(sensorType);
}

/**
 * Check if the app HAS the native activity recognition permission granted.
 */
export function checkActivityPermission(): Promise<boolean> {
  return SZSensorModule.checkActivityPermission();
}

/**
 * Read the compass heading once.
 */
export function getMagneticHeading(): Promise<MagneticHeadingResult> {
  return SZSensorModule.getMagneticHeading();
}

/**
 * Read atmospheric pressure from barometer.
 */
export function getBarometricPressure(): Promise<BarometricPressureResult> {
  return SZSensorModule.getBarometricPressure();
}

/**
 * Read accelerometer values once.
 */
export function getAcceleration(): Promise<AccelerationResult> {
  return SZSensorModule.getAcceleration();
}

/**
 * Check if a specific sensor is physically present on the device.
 */
export function isSensorAvailable(sensorType: SensorType): Promise<boolean> {
  return SZSensorModule.isSensorAvailable(sensorType);
}

/**
 * Convenience: check all 5 SFPE sensors at once.
 */
export async function checkAllSensors(): Promise<Record<SensorType, boolean>> {
  const [stepCounter, stepDetector, magnetometer, barometer, accelerometer] = await Promise.all([
    isSensorAvailable('step_counter'),
    isSensorAvailable('step_detector'),
    isSensorAvailable('magnetometer'),
    isSensorAvailable('barometer'),
    isSensorAvailable('accelerometer'),
  ]);
  return { step_counter: stepCounter, step_detector: stepDetector, magnetometer, barometer, accelerometer };
}

/**
 * Start a persistent native listener for steps.
 * Use with DeviceEventEmitter.addListener('onStepUpdate', ...)
 */
export function startStepWatching(): Promise<boolean> {
  return SZSensorModule.startStepWatching();
}

/**
 * Stop the persistent native step listener.
 */
export function stopStepWatching(): Promise<boolean> {
  return SZSensorModule.stopStepWatching();
}

export default {
  getStepCount,
  getStepDetector,
  getSensorInfo,
  checkActivityPermission,
  getMagneticHeading,
  getBarometricPressure,
  getAcceleration,
  isSensorAvailable,
  checkAllSensors,
  startStepWatching,
  stopStepWatching,
};
