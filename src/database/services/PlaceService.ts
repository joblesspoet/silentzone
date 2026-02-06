// database/services/PlaceService.ts

import Realm from 'realm';
import { generateUUID } from '../../utils/uuid';
import { RealmWriteHelper } from '../helpers/RealmWriteHelper';
import { alarmService } from '../../services/AlarmService';

export interface PlaceData {
  name: string;
  latitude: number;
  longitude: number;
  radius?: number;
  category?: string;
  icon?: string;
  isEnabled?: boolean;
  schedules?: Array<{
    startTime: string;
    endTime: string;
    days: string[];
    label?: string;
  }>;
}

export const PlaceService = {
  /**
   * Get all places - READ ONLY
   */
  getAllPlaces: (realm: Realm) => {
    return realm.objects('Place').sorted('createdAt', true);
  },

  /**
   * Get enabled places - READ ONLY
   */
  getEnabledPlaces: (realm: Realm) => {
    return realm.objects('Place').filtered('isEnabled == true');
  },

  /**
   * Get place by ID - READ ONLY
   */
  getPlaceById: (realm: Realm, id: string) => {
    return realm.objectForPrimaryKey('Place', id);
  },

  /**
   * Create new place - THREAD SAFE
   */
  createPlace: (realm: Realm, data: PlaceData) => {
    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        const place = realm.create('Place', {
          id: generateUUID(),
          name: data.name,
          latitude: data.latitude,
          longitude: data.longitude,
          radius: data.radius || 50,
          category: data.category || 'other',
          icon: data.icon || 'place',
          createdAt: new Date(),
          updatedAt: new Date(),
          isEnabled: data.isEnabled !== undefined ? data.isEnabled : true,
          totalCheckIns: 0,
          schedules: [],
          isInside: false,
        });

        // Add schedules if provided
        if (data.schedules && data.schedules.length > 0) {
          data.schedules.forEach((s) => {
            const schedule = realm.create('Schedule', {
              id: generateUUID(),
              startTime: s.startTime,
              endTime: s.endTime,
              days: s.days,
              label: s.label || 'Active',
              createdAt: new Date(),
            });
            (place as any).schedules.push(schedule);
          });
        }

        console.log(`[PlaceService] Created place: ${data.name}`);
        return place;
      },
      `createPlace:${data.name}`
    );
  },

  /**
   * Update place - THREAD SAFE
   */
  updatePlace: (realm: Realm, id: string, data: Partial<PlaceData>): boolean => {
    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        const place = realm.objectForPrimaryKey('Place', id) as any;
        if (!place) {
          console.warn(`[PlaceService] Place not found: ${id}`);
          return false;
        }

        // Update basic fields
        if (data.name !== undefined) place.name = data.name;
        if (data.latitude !== undefined) place.latitude = data.latitude;
        if (data.longitude !== undefined) place.longitude = data.longitude;
        if (data.radius !== undefined) place.radius = data.radius;
        if (data.category !== undefined) place.category = data.category;
        if (data.icon !== undefined) place.icon = data.icon;
        if (data.isEnabled !== undefined) place.isEnabled = data.isEnabled;

        // Handle schedules update
        if (data.schedules) {
          // Delete old schedule objects
          realm.delete(place.schedules);
          
          // Create new schedules
          data.schedules.forEach((s) => {
            const schedule = realm.create('Schedule', {
              id: generateUUID(),
              startTime: s.startTime,
              endTime: s.endTime,
              days: s.days,
              label: s.label || 'Active',
              createdAt: new Date(),
            });
            place.schedules.push(schedule);
          });
        }

        place.updatedAt = new Date();
        console.log(`[PlaceService] Updated place: ${place.name}`);
        return true;
      },
      `updatePlace:${id}`
    ) ?? false;
  },

  /**
   * Delete place - THREAD SAFE
   */
  deletePlace: async (realm: Realm, id: string): Promise<boolean> => {
    // CRITICAL: Explicitly cancel and AWAIT cancellation before deleting data
    // This prevents orphaned alarms for a non-existent place
    await alarmService.cancelAlarmsForPlace(id);

    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        const place = realm.objectForPrimaryKey('Place', id);
        if (place) {
          realm.delete(place);
          console.log(`[PlaceService] Deleted place: ${id}`);
          return true;
        }
        return false;
      },
      `deletePlace:${id}`
    ) ?? false;
  },

  /**
   * Toggle place enabled state - THREAD SAFE
   */
  togglePlaceEnabled: (realm: Realm, id: string): boolean | null => {
    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        const place = realm.objectForPrimaryKey('Place', id) as any;
        if (!place) {
          console.warn(`[PlaceService] Place not found: ${id}`);
          return null;
        }

        const newState = !place.isEnabled;
        place.isEnabled = newState;
        place.updatedAt = new Date();

        console.log(`[PlaceService] Toggled ${place.name}: ${newState}`);
        
        return newState;
      },
      `togglePlace:${id}`
    );
  },

  /**
   * Get places count - READ ONLY
   */
  getPlacesCount: (realm: Realm): number => {
    return realm.objects('Place').length;
  },

  /**
   * Check if more places can be added - READ ONLY
   */
  canAddMorePlaces: (realm: Realm, maxPlaces: number = 3): boolean => {
    return realm.objects('Place').length < maxPlaces;
  },

  /**
   * Batch enable/disable multiple places - THREAD SAFE
   * More efficient than multiple individual toggles
   */
  batchTogglePlaces: (
    realm: Realm,
    placeIds: string[],
    enabled: boolean
  ): boolean => {
    if (placeIds.length === 0) return false;

    const operations = placeIds.map((id) => ({
      label: id,
      callback: () => {
        const place = realm.objectForPrimaryKey('Place', id) as any;
        if (place) {
          place.isEnabled = enabled;
          place.updatedAt = new Date();
          // Note: Full alarm sync should happen after batch operation via context/manager
        }
      },
    }));

    return RealmWriteHelper.batchWrite(
      realm,
      operations,
      `batchTogglePlaces:${enabled}`
    );
  },

  /**
   * Get places near a location - READ ONLY
   * Useful for proximity-based features
   */
  getPlacesNearLocation: (
    realm: Realm,
    latitude: number,
    longitude: number,
    maxDistanceMeters: number = 5000
  ) => {
    const allPlaces = realm.objects('Place');
    
    return Array.from(allPlaces).filter((place: any) => {
      const distance = calculateDistance(
        latitude,
        longitude,
        place.latitude,
        place.longitude
      );
      return distance <= maxDistanceMeters;
    });
  },
};

/**
 * Helper function to calculate distance between two coordinates
 * Uses Haversine formula
 */
function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}