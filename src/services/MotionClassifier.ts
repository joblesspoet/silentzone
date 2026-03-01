
import { NativeModules } from 'react-native';

const { SZSensorModule } = NativeModules;

export type MotionState = 'WALKING' | 'VEHICLE_BIKE' | 'VEHICLE_CAR' | 'STATIONARY';

// Thresholds for motion classification
const STATIONARY_ACCEL_THRESHOLD = 0.5; // m/s^2 variance from gravity (approx)
const VEHICLE_ACCEL_THRESHOLD = 2.0;    // m/s^2 significant movement
const GRAVITY = 9.81;

// Stride lengths in meters
const STRIDE_LENGTH_WALKING = 0.76; // Average adult stride
const STRIDE_LENGTH_STATIONARY = 0;
const STRIDE_LENGTH_VEHICLE = 0;    // Vehicles don't have "steps" for dead reckoning

/**
 * Classifies the current motion state based on step count delta and accelerometer magnitude.
 * 
 * @param stepDelta Number of steps detected since last check
 * @param accelMagnitude Current accelerometer magnitude (including gravity)
 * @returns The classified MotionState
 */
export const classifyMotion = (
  stepDelta: number,
  accelMagnitude: number
): MotionState => {
  // 1. Check for walking
  // If we have steps, we are likely walking (or running)
  if (stepDelta > 0) {
    // Basic check: if steps are happening, it's walking.
    // False positives from vehicle vibration are possible but usually filtered by hardware step counter.
    return 'WALKING';
  }

  // 2. If no steps, check accelerometer for other motion
  // Calculate variance from gravity (approximate since we only have magnitude)
  const variance = Math.abs(accelMagnitude - GRAVITY);

  if (variance < STATIONARY_ACCEL_THRESHOLD) {
    return 'STATIONARY';
  }

  // 3. If significant movement but no steps, likely a vehicle
  // Distinguishing Bike vs Car is hard with just magnitude, 
  // but higher variance/vibration often implies rougher ride (Bike) or just fast Car?
  // For now, let's use a simple threshold or default to CAR if smooth, BIKE if rough?
  // Actually, without frequency analysis, it's a guess.
  // Let's assume CAR as default vehicle for now, unless variance is extremely high (bumpy/bike).
  
  if (variance > VEHICLE_ACCEL_THRESHOLD) {
     // Very rough movement might be a bike or running without step detection (unlikely)
     return 'VEHICLE_BIKE'; 
  }
  
  return 'VEHICLE_CAR';
};

/**
 * Returns the estimated stride length for a given motion state.
 * 
 * @param motionState The current motion state
 * @returns Stride length in meters
 */
export const getStrideLength = (motionState: MotionState): number => {
  switch (motionState) {
    case 'WALKING':
      return STRIDE_LENGTH_WALKING;
    case 'STATIONARY':
      return STRIDE_LENGTH_STATIONARY;
    case 'VEHICLE_BIKE':
    case 'VEHICLE_CAR':
      return STRIDE_LENGTH_VEHICLE;
    default:
      return STRIDE_LENGTH_STATIONARY;
  }
};

/**
 * Returns the estimated travel speed for vehicle motion states.
 * Used for time-based dead reckoning when step counter is inactive.
 *
 * @param motionState The current motion state
 * @returns Estimated speed in meters per second
 */
export const getEstimatedSpeed = (motionState: MotionState): number => {
  switch (motionState) {
    case 'VEHICLE_BIKE':
      return 4.0;   // ~15 km/h
    case 'VEHICLE_CAR':
      return 11.0;  // ~40 km/h
    default:
      return 0;
  }
};

/**
 * Helper to fetch sensor data from native module and classify motion.
 * 
 * @param lastStepCount The previous total step count (to calculate delta)
 * @returns Promise resolving to { state: MotionState, currentSteps: number }
 */
export const detectCurrentMotion = async (lastStepCount: number): Promise<{
  state: MotionState;
  currentSteps: number;
  stepDelta: number;
}> => {
  try {
    if (!SZSensorModule) {
      console.warn('SZSensorModule not found');
      return { state: 'STATIONARY', currentSteps: lastStepCount, stepDelta: 0 };
    }

    // Parallel fetch for speed
    const [stepData, accelData] = await Promise.all([
      SZSensorModule.getStepCount(),
      SZSensorModule.getAcceleration()
    ]);

    const currentSteps = stepData.steps;
    const stepDelta = Math.max(0, currentSteps - lastStepCount); // Handle reboot/reset
    const accelMagnitude = accelData.magnitude;

    const state = classifyMotion(stepDelta, accelMagnitude);

    return {
      state,
      currentSteps,
      stepDelta
    };
  } catch (error) {
    console.error('Error detecting motion:', error);
    // Fallback to stationary on error
    return { state: 'STATIONARY', currentSteps: lastStepCount, stepDelta: 0 };
  }
};
