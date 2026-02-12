// database/services/PreferencesService.ts

import Realm from 'realm';
import { RealmWriteHelper } from '../helpers/RealmWriteHelper';

const PREFS_ID = 'USER_PREFS';

export interface Preferences {
  id: string;
  onboardingCompleted: boolean;
  trackingEnabled: boolean;
  notificationsEnabled: boolean;
  maxPlaces: number;
  databaseSeeded: boolean;
}

export interface PreferencesData {
  onboardingCompleted?: boolean;
  trackingEnabled?: boolean;
  notificationsEnabled?: boolean;
  maxPlaces?: number;
  databaseSeeded?: boolean;
}

export const PreferencesService = {
  /**
   * Get preferences - READ ONLY (with auto-creation)
   * Creates default preferences if they don't exist
   */
  getPreferences: (realm: Realm): Preferences | null => {
    console.log(`[PreferencesService] Fetching preferences (ID: ${PREFS_ID})...`);
    let prefs = realm.objectForPrimaryKey<Preferences>('Preferences', PREFS_ID);

    if (!prefs) {
      console.log('[PreferencesService] No preferences found. Creating defaults...');
      const created = RealmWriteHelper.safeWrite(
        realm,
        () => {
          return realm.create<Preferences>('Preferences', {
            id: PREFS_ID,
            onboardingCompleted: false,
            trackingEnabled: true,
            notificationsEnabled: true,
            maxPlaces: 3,
            databaseSeeded: false,
          });
        },
        'createDefaultPreferences'
      );

      if (created) {
        console.log('[PreferencesService] Default preferences created ✅');
      } else {
        console.error('[PreferencesService] CRITICAL: Failed to create default preferences! ❌');
      }
      prefs = created;
    }

    return prefs;
  },

  /**
   * Update preferences - THREAD SAFE
   */
  updatePreferences: (realm: Realm, data: PreferencesData): boolean => {
    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        let prefs = realm.objectForPrimaryKey<Preferences>('Preferences', PREFS_ID);

        if (!prefs) {
          // Create with provided data + defaults
          prefs = realm.create<Preferences>('Preferences', {
            id: PREFS_ID,
            onboardingCompleted: data.onboardingCompleted ?? false,
            trackingEnabled: data.trackingEnabled ?? true,
            notificationsEnabled: data.notificationsEnabled ?? true,
            maxPlaces: data.maxPlaces ?? 3,
            databaseSeeded: data.databaseSeeded ?? false,
          });
          console.log('[PreferencesService] Created preferences with updates');
          return true;
        }

        // Update existing preferences
        if (data.onboardingCompleted !== undefined)
          prefs.onboardingCompleted = data.onboardingCompleted;
        if (data.trackingEnabled !== undefined)
          prefs.trackingEnabled = data.trackingEnabled;
        if (data.notificationsEnabled !== undefined)
          prefs.notificationsEnabled = data.notificationsEnabled;
        if (data.maxPlaces !== undefined) prefs.maxPlaces = data.maxPlaces;
        if (data.databaseSeeded !== undefined)
          prefs.databaseSeeded = data.databaseSeeded;

        console.log('[PreferencesService] Updated preferences:', data);
        return true;
      },
      'updatePreferences'
    ) ?? false;
  },

  /**
   * Deferred update - for use in listeners
   * Waits for current transaction to complete
   */
  deferredUpdatePreferences: async (
    realm: Realm,
    data: PreferencesData
  ): Promise<boolean> => {
    const result = await RealmWriteHelper.deferredWrite(
      realm,
      () => {
        let prefs = realm.objectForPrimaryKey<Preferences>('Preferences', PREFS_ID);

        if (!prefs) {
          prefs = realm.create<Preferences>('Preferences', {
            id: PREFS_ID,
            onboardingCompleted: data.onboardingCompleted ?? false,
            trackingEnabled: data.trackingEnabled ?? true,
            notificationsEnabled: data.notificationsEnabled ?? true,
            maxPlaces: data.maxPlaces ?? 3,
            databaseSeeded: data.databaseSeeded ?? false,
          });
          return true;
        }

        // Update fields
        if (data.onboardingCompleted !== undefined)
          prefs.onboardingCompleted = data.onboardingCompleted;
        if (data.trackingEnabled !== undefined)
          prefs.trackingEnabled = data.trackingEnabled;
        if (data.notificationsEnabled !== undefined)
          prefs.notificationsEnabled = data.notificationsEnabled;
        if (data.maxPlaces !== undefined) prefs.maxPlaces = data.maxPlaces;
        if (data.databaseSeeded !== undefined)
          prefs.databaseSeeded = data.databaseSeeded;

        console.log('[PreferencesService] Deferred update:', data);
        return true;
      },
      'deferredUpdatePreferences'
    );

    return result ?? false;
  },

  /**
   * Set onboarding complete - THREAD SAFE
   */
  setOnboardingComplete: (realm: Realm): boolean => {
    return PreferencesService.updatePreferences(realm, {
      onboardingCompleted: true,
    });
  },

  /**
   * Check if tracking is enabled - READ ONLY
   */
  isTrackingEnabled: (realm: Realm): boolean => {
    const prefs = PreferencesService.getPreferences(realm);
    return prefs?.trackingEnabled ?? true;
  },

  /**
   * Toggle tracking - THREAD SAFE
   */
  toggleTracking: (realm: Realm): boolean => {
    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        let prefs = realm.objectForPrimaryKey<Preferences>('Preferences', PREFS_ID);

        if (!prefs) {
          prefs = realm.create<Preferences>('Preferences', {
            id: PREFS_ID,
            onboardingCompleted: false,
            trackingEnabled: false, // Start with false since we're toggling
            notificationsEnabled: true,
            maxPlaces: 3,
            databaseSeeded: false,
          });
        }

        const newState = !prefs.trackingEnabled;
        prefs.trackingEnabled = newState;

        console.log(`[PreferencesService] Tracking toggled: ${newState}`);
        return newState;
      },
      'toggleTracking'
    ) ?? false;
  },

  /**
   * Check if database is seeded - READ ONLY
   */
  isDatabaseSeeded: (realm: Realm): boolean => {
    const prefs = PreferencesService.getPreferences(realm);
    return prefs?.databaseSeeded ?? false;
  },

  /**
   * Mark database as seeded - THREAD SAFE
   */
  setDatabaseSeeded: (realm: Realm): boolean => {
    return PreferencesService.updatePreferences(realm, { databaseSeeded: true });
  },

  /**
   * Get max places limit - READ ONLY
   */
  getMaxPlaces: (realm: Realm): number => {
    const prefs = PreferencesService.getPreferences(realm);
    return prefs?.maxPlaces ?? 3;
  },

  /**
   * Check if onboarding is complete - READ ONLY
   */
  isOnboardingComplete: (realm: Realm): boolean => {
    const prefs = PreferencesService.getPreferences(realm);
    return prefs?.onboardingCompleted ?? false;
  },
};