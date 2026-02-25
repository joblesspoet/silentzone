import { NativeModules } from 'react-native';

const { SZSensorModule } = NativeModules;

export interface PlaceFingerprint {
  placeId: string;
  avgPressure: number;
  altitude?: number;
  timestamp: number;
}

/**
 * Captures environmental data to "fingerprint" a place.
 * Currently uses Barometric Pressure (if available) to help distinguish floors
 * or provide additional validation beyond GPS/WiFi.
 *
 * @param placeId The UUID of the place being saved/updated
 * @returns Promise resolving to PlaceFingerprint or null if sensors unavailable
 */
export const captureFingerprint = async (
  placeId: string,
): Promise<PlaceFingerprint | null> => {
  try {
    // 1. Get Pressure / Altitude from Native Sensor Module
    const isAvailable = await SZSensorModule.isSensorAvailable('barometer');

    if (!isAvailable) {
      console.warn('Barometer not available on this device');
      return null;
    }

    const data = await SZSensorModule.getBarometricPressure();

    return {
      placeId,
      avgPressure: data.pressureHPa,
      altitude: data.altitudeM,
      timestamp: data.timestamp,
    };
  } catch (error) {
    console.warn('Failed to capture place fingerprint', error);
    return null;
  }
};

/**
 * Compares current environmental data against a saved fingerprint.
 *
 * @param savedFingerprint The fingerprint stored for the place
 * @returns Similarity score (0.0 to 1.0)
 */
export const matchFingerprint = async (
  savedFingerprint: PlaceFingerprint,
  toleranceHPa: number = 1.5,
): Promise<number> => {
  try {
    const isAvailable = await SZSensorModule.isSensorAvailable('barometer');
    if (!isAvailable) return 0.5; // Neutral score if sensor missing

    const current = await SZSensorModule.getBarometricPressure();

    // Calculate difference
    const diff = Math.abs(current.pressureHPa - savedFingerprint.avgPressure);

    if (diff <= toleranceHPa) {
      return 1.0; // Perfect match
    } else if (diff <= toleranceHPa * 2) {
      return 0.5; // Partial match
    } else {
      return 0.0; // Mismatch (different floor)
    }
  } catch (error) {
    console.warn('Failed to match fingerprint', error);
    return 0.0;
  }
};
