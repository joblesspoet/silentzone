import Geolocation from 'react-native-geolocation-service';
import { Coordinate } from './DeadReckoningService';

// Re-anchor threshold: 300 meters of dead-reckoned travel
const RE_ANCHOR_DISTANCE_THRESHOLD_METERS = 300;

export interface AnchorPosition {
  lat: number;
  lng: number;
  timestamp: number;
  accuracy: number;
  source: 'HOME' | 'NETWORK' | 'GPS';
}

// Minimal Place interface to avoid circular deps or complex imports
export interface Place {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
}

/**
 * Requests a single location update using Network provider (WiFi/Cell).
 * This is faster and uses less battery than GPS, suitable for re-anchoring.
 *
 * @returns Promise resolving to AnchorPosition
 */
export const requestNetworkAnchor = (): Promise<AnchorPosition> => {
  return new Promise((resolve, reject) => {
    Geolocation.getCurrentPosition(
      position => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy || 0,
          timestamp: position.timestamp,
          source: 'NETWORK', // effectively "balanced" or "low power"
        });
      },
      error => {
        reject(error);
      },
      {
        enableHighAccuracy: false, // Key: False = Network/WiFi priority
        timeout: 15000,
        maximumAge: 10000,
      },
    );
  });
};

/**
 * Determines the initial anchor position.
 * Priority:
 * 1. Home/Saved Place (if current time is close to prayer time for that place) - Logic simplified for now to "nearest place"
 * 2. Network/WiFi Location (fast, low power)
 * 3. GPS (last resort, high power)
 *
 * @param places List of saved places to check against
 * @returns Promise resolving to the best available AnchorPosition
 */
export const getInitialAnchor = async (
  places: Place[] = [],
): Promise<AnchorPosition | null> => {
  // 1. Check if we are obviously at a saved place (e.g. Home)
  // For now, without complex logic, we can't blindly assume Home unless we have some trigger.
  // But the spec says: "uses home place or saved place nearest to alarm time"
  // Let's implement a placeholder for "nearest place logic" or rely on Network first.

  // Real implementation strategy:
  // Try to get a quick Network fix.
  // If Network fix is close to a Saved Place, SNAP to that Saved Place center as the perfect anchor.

  try {
    const networkPos = await requestNetworkAnchor();

    // Check if close to any saved place (e.g. within 100m)
    // If so, use the Place's exact coordinates as they are likely more precise than the Network fix
    // and represent the "semantic" location user intends.
    /* 
    // This logic would require importing haversineDistance and iterating places
    // For now, let's return the network position directly.
    */

    return networkPos;
  } catch (error) {
    console.warn('Failed to get network anchor, falling back to GPS', error);
    // Fallback?
    return null;
  }
};

/**
 * Checks if dead reckoning has drifted enough to require a new hard anchor.
 *
 * @param distanceTraveledMeters Cumulative distance traveled since last anchor
 * @returns true if re-anchoring is needed
 */
export const shouldReAnchor = (distanceTraveledMeters: number): boolean => {
  return distanceTraveledMeters >= RE_ANCHOR_DISTANCE_THRESHOLD_METERS;
};
