// database/services/DatabaseSeeder.ts

import Realm from 'realm';
import { generateUUID } from '../../utils/uuid';
import { RealmWriteHelper } from '../helpers/RealmWriteHelper';

export const DatabaseSeeder = {
  /**
   * Seeds the database with sample places for first-time users
   * THREAD SAFE - All places created in a single transaction
   */
  seedSamplePlaces: (realm: Realm): boolean => {
    const samplePlaces = [
      {
        name: 'Home',
        latitude: 37.7749, // San Francisco coordinates (example)
        longitude: -122.4194,
        radius: 100,
        category: 'home',
        icon: 'home',
        isEnabled: true,
      },
      {
        name: 'Office',
        latitude: 37.7849,
        longitude: -122.4094,
        radius: 150,
        category: 'work',
        icon: 'business',
        isEnabled: true,
      },
      {
        name: 'Library',
        latitude: 37.7649,
        longitude: -122.4294,
        radius: 75,
        category: 'education',
        icon: 'local-library',
        isEnabled: true,
      },
    ];

    console.log('[DatabaseSeeder] Seeding sample places...');

    // FIXED: Create all places in a single batch transaction
    const success = RealmWriteHelper.safeWrite(
      realm,
      () => {
        const createdPlaces: any[] = [];

        for (const placeData of samplePlaces) {
          const place = realm.create('Place', {
            id: generateUUID(),
            name: placeData.name,
            latitude: placeData.latitude,
            longitude: placeData.longitude,
            radius: placeData.radius || 50,
            category: placeData.category || 'other',
            icon: placeData.icon || 'place',
            createdAt: new Date(),
            updatedAt: new Date(),
            isEnabled: placeData.isEnabled !== undefined ? placeData.isEnabled : true,
            totalCheckIns: 0,
            schedules: [],
            isInside: false,
          });

          createdPlaces.push(place);
        }

        console.log(
          `[DatabaseSeeder] Successfully seeded ${createdPlaces.length} sample places`
        );
        return true;
      },
      'seedSamplePlaces'
    );

    return success ?? false;
  },

  /**
   * Check if database has been seeded
   * Useful to prevent duplicate seeding
   */
  isDatabaseSeeded: (realm: Realm): boolean => {
    const prefs = realm.objectForPrimaryKey('Preferences', 'USER_PREFS') as any;
    return prefs?.databaseSeeded ?? false;
  },

  /**
   * Mark database as seeded
   */
  markDatabaseSeeded: (realm: Realm): boolean => {
    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        let prefs = realm.objectForPrimaryKey('Preferences', 'USER_PREFS') as any;
        
        if (!prefs) {
          prefs = realm.create('Preferences', {
            id: 'USER_PREFS',
            onboardingCompleted: false,
            trackingEnabled: true,
            notificationsEnabled: true,
            maxPlaces: 3,
            databaseSeeded: false,
          });
        }

        prefs.databaseSeeded = true;
        return true;
      },
      'markDatabaseSeeded'
    ) ?? false;
  },

  /**
   * Seed database with custom places
   * Allows external configuration of sample data
   */
  seedCustomPlaces: (
    realm: Realm,
    places: Array<{
      name: string;
      latitude: number;
      longitude: number;
      radius?: number;
      category?: string;
      icon?: string;
      isEnabled?: boolean;
    }>
  ): boolean => {
    if (places.length === 0) {
      console.warn('[DatabaseSeeder] No places to seed');
      return false;
    }

    console.log(`[DatabaseSeeder] Seeding ${places.length} custom places...`);

    const success = RealmWriteHelper.safeWrite(
      realm,
      () => {
        for (const placeData of places) {
          realm.create('Place', {
            id: generateUUID(),
            name: placeData.name,
            latitude: placeData.latitude,
            longitude: placeData.longitude,
            radius: placeData.radius || 50,
            category: placeData.category || 'other',
            icon: placeData.icon || 'place',
            createdAt: new Date(),
            updatedAt: new Date(),
            isEnabled: placeData.isEnabled !== undefined ? placeData.isEnabled : true,
            totalCheckIns: 0,
            schedules: [],
            isInside: false,
          });
        }

        console.log('[DatabaseSeeder] Custom places seeded successfully');
        return true;
      },
      'seedCustomPlaces'
    );

    return success ?? false;
  },
};