import Geolocation from 'react-native-geolocation-service';
import { Coordinate, haversineDistance } from './DeadReckoningService';

// Re-anchor threshold: 300 meters of dead-reckoned travel
const RE_ANCHOR_DISTANCE_THRESHOLD_METERS = 300;

// If network fix is within this distance of a saved place, snap to the place's exact coordinates
const PLACE_SNAP_DISTANCE_METERS = 100;

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
 * 1. Home/Saved Place — if network fix is within 100m of a saved place, snap to its exact coords
 * 2. Network/WiFi Location (fast, low power)
 * 3. GPS (last resort, high power)
 *
 * @param places List of saved places to check against
 * @returns Promise resolving to the best available AnchorPosition
 */
export const getInitialAnchor = async (
  places: Place[] = [],
): Promise<AnchorPosition | null> => {
  try {
    const networkPos = await requestNetworkAnchor();

    // Place-snapping: If close to a saved place, use that place's exact coordinates
    // as anchor instead of the noisy network fix (20-50m accuracy → near-perfect)
    if (places.length > 0) {
      let closestPlace: Place | null = null;
      let closestDistance = Infinity;

      for (const place of places) {
        const dist = haversineDistance(
          networkPos.lat,
          networkPos.lng,
          place.latitude,
          place.longitude,
        );
        if (dist < closestDistance) {
          closestDistance = dist;
          closestPlace = place;
        }
      }

      if (closestPlace && closestDistance <= PLACE_SNAP_DISTANCE_METERS) {
        console.log(
          `[AnchorManager] Snapping to saved place "${closestPlace.name}" (${Math.round(closestDistance)}m from network fix)`,
        );
        return {
          lat: closestPlace.latitude,
          lng: closestPlace.longitude,
          accuracy: 5, // Near-perfect accuracy since we're using exact saved coordinates
          timestamp: networkPos.timestamp,
          source: 'HOME',
        };
      }
    }

    return networkPos;
  } catch (error) {
    console.warn('Failed to get network anchor, falling back to GPS', error);
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
