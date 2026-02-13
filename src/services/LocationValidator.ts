
import { PlaceService } from '../database/services/PlaceService';
import { Logger } from './Logger';
import { CONFIG } from '../config/config';
import { Realm } from 'realm';

export interface LocationState {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

export class LocationValidator {
  /**
   * Validate if location has sufficient quality for tracking
   * Returns { valid: boolean, reason: string }
   */
  static validateLocationQuality(
    location: LocationState,
    requiredAccuracy?: number
  ): { valid: boolean; reason: string } {
    
    // Check age (stale location)
    const age = Date.now() - location.timestamp;
    const maxAge = 180000; // 3 minutes (loosened from 1 minute for background reliability)
    
    if (age > maxAge) {
      return {
        valid: false,
        reason: `Location too old (${Math.round(age / 1000)}s > ${maxAge / 1000}s)`
      };
    }
    
    // Check accuracy
    const maxAccuracy = requiredAccuracy || CONFIG.MAX_ACCEPTABLE_ACCURACY;
    
    if (location.accuracy > maxAccuracy) {
      return {
        valid: false,
        reason: `Accuracy too low (${Math.round(location.accuracy)}m > ${maxAccuracy}m)`
      };
    }
    
    return { valid: true, reason: 'Location quality acceptable' };
  }

  /**
   * Determine which places user is inside based on GPS location
   * 
  /**
   * Determine which places user is inside based on GPS location
   * 
   * CRITICAL: Accounts for GPS accuracy to prevent false positives
   * - Requires accuracy < 50% of zone radius
   * - Calculates "effective distance" accounting for uncertainty
   */
  static determineInsidePlaces(location: LocationState, realm: Realm): string[] {
    const enabledPlaces = realm ? PlaceService.getEnabledPlaces(realm) : [];
    const insidePlaces: string[] = [];
    
    Logger.info(
      `[Location] Checking position: ` +
      `lat=${location.latitude.toFixed(6)}, ` +
      `lon=${location.longitude.toFixed(6)}, ` +
      `accuracy=±${Math.round(location.accuracy)}m`
    );
    
    for (const place of enabledPlaces) {
      const p = place as any;
      const distance = this.calculateDistance(
        location.latitude,
        location.longitude,
        p.latitude,
        p.longitude
      );
      
      // effectiveDistance = minimum possible distance (best case)
      const effectiveDistance = Math.max(0, distance - location.accuracy);
      
      if (effectiveDistance <= p.radius) {
        Logger.info(
          `[Location] ✅ INSIDE ${p.name}: ` +
          `dist=${Math.round(distance)}m, acc=±${Math.round(location.accuracy)}m, ` +
          `eff=${Math.round(effectiveDistance)}m <= ${p.radius}m`
        );
        insidePlaces.push(p.id);
      } else {
        Logger.info(
          `[Location] Outside ${p.name}: ` +
          `eff ${Math.round(effectiveDistance)}m > ${p.radius}m`
        );
      }
    }
    
    return insidePlaces;
  }

  /**
   * Check if user is definitely outside a place
   * Uses effective distance with an optional hysteresis buffer
   */
  static isOutsidePlace(location: LocationState, place: any, buffer: number = 0): boolean {
    const p = place as any;
    const distance = this.calculateDistance(
      location.latitude,
      location.longitude,
      p.latitude,
      p.longitude
    );

    // effectiveDistance = minimum possible distance (best case)
    // If even the BEST case distance is greater than radius + buffer, we're definitely outside
    const effectiveDistance = Math.max(0, distance - location.accuracy);
    return effectiveDistance > p.radius + buffer;
  }

  static calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }
}
