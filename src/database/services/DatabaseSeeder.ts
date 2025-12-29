import Realm from 'realm';
import { PlaceService } from './PlaceService';

export const DatabaseSeeder = {
  /**
   * Seeds the database with sample places for first-time users
   */
  seedSamplePlaces: (realm: Realm) => {
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
    
    samplePlaces.forEach((place) => {
      PlaceService.createPlace(realm, place);
    });

    console.log('[DatabaseSeeder] Successfully seeded', samplePlaces.length, 'sample places');
  },
};
