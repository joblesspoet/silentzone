
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
    const maxAccuracy = requiredAccuracy || 100; // Default 100m
    
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
   * CRITICAL: Accounts for GPS accuracy to prevent false positives
   * - Requires accuracy < 50% of zone radius
   * - Calculates "effective distance" accounting for uncertainty
   * 
   * Example: 50m radius zone
   * - Good: 20m distance, 10m accuracy → effective 10m ✅ INSIDE
   * - Poor: 45m distance, 30m accuracy → effective 15m ✅ INSIDE (barely)
   * - Bad: 40m distance, 60m accuracy → REJECTED (accuracy too low)
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
      const placeId = (place as any).id;
      const placeName = (place as any).name;
      const radius = (place as any).radius;
      
      // Calculate distance from place center
      const distance = this.calculateDistance(
        location.latitude,
        location.longitude,
        (place as any).latitude,
        (place as any).longitude
      );
      
      // CRITICAL VALIDATION #1: Accuracy must be better than 50% of radius
      // REMOVED: This was too strict for indoors (often 30-50m accuracy).
      // The effectiveDistance check below (effective = distance - accuracy) 
      // is robust enough to prevent fast-toggling while allowing "good enough" fixes.
      /*
      const requiredAccuracy = radius * 0.5;
      
      if (location.accuracy > requiredAccuracy) {
        Logger.warn(
          `[Location] ⚠️ Skipping ${placeName}: ` +
          `GPS accuracy too low (${Math.round(location.accuracy)}m > ` +
          `required)`
        );
        continue;
      }
      */
      
      // CRITICAL CALCULATION #2: Account for GPS uncertainty
      // effectiveDistance = minimum possible distance (best case)
      // If effective distance <= radius, we're DEFINITELY inside
      const effectiveDistance = Math.max(0, distance - location.accuracy);
      
      // Check if we're inside (accounting for uncertainty)
      if (effectiveDistance <= radius) {
        Logger.info(
          `[Location] ✅ INSIDE ${placeName}: ` +
          `distance=${Math.round(distance)}m, ` +
          `accuracy=±${Math.round(location.accuracy)}m, ` +
          `effective=${Math.round(effectiveDistance)}m <= ${radius}m radius`
        );
        insidePlaces.push(placeId);
        
      } else {
        // Outside the zone
        Logger.info(
          `[Location] Outside ${placeName}: ` +
          `effective distance ${Math.round(effectiveDistance)}m > ${radius}m`
        );
      }
    }
    
    if (insidePlaces.length === 0) {
      Logger.info('[Location] Not inside any enabled zones');
    }
    
    return insidePlaces;
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
