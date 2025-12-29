import Realm from 'realm';

const PREFS_ID = 'USER_PREFS';

export interface PreferencesData {
  onboardingCompleted?: boolean;
  trackingEnabled?: boolean;
  notificationsEnabled?: boolean;
  maxPlaces?: number;
  databaseSeeded?: boolean;
}

export const PreferencesService = {
  getPreferences: (realm: Realm) => {
    let prefs = realm.objectForPrimaryKey('Preferences', PREFS_ID);
    
    if (!prefs) {
      // Create defaults if not exist
      realm.write(() => {
        prefs = realm.create('Preferences', {
          id: PREFS_ID,
          onboardingCompleted: false,
          trackingEnabled: true,
          notificationsEnabled: true,
          maxPlaces: 3,
          databaseSeeded: false,
        });
      });
    }
    
    return prefs;
  },

  updatePreferences: (realm: Realm, data: PreferencesData) => {
    const prefs = PreferencesService.getPreferences(realm);
    
    realm.write(() => {
      if (data.onboardingCompleted !== undefined) prefs.onboardingCompleted = data.onboardingCompleted;
      if (data.trackingEnabled !== undefined) prefs.trackingEnabled = data.trackingEnabled;
      if (data.notificationsEnabled !== undefined) prefs.notificationsEnabled = data.notificationsEnabled;
      if (data.maxPlaces !== undefined) prefs.maxPlaces = data.maxPlaces;
      if (data.databaseSeeded !== undefined) prefs.databaseSeeded = data.databaseSeeded;
    });
    
    return prefs;
  },

  setOnboardingComplete: (realm: Realm) => {
    return PreferencesService.updatePreferences(realm, { onboardingCompleted: true });
  },

  isTrackingEnabled: (realm: Realm) => {
    const prefs = PreferencesService.getPreferences(realm);
    return prefs.trackingEnabled;
  },

  toggleTracking: (realm: Realm) => {
    const prefs = PreferencesService.getPreferences(realm);
    realm.write(() => {
      prefs.trackingEnabled = !prefs.trackingEnabled;
    });
    return prefs.trackingEnabled;
  },

  isDatabaseSeeded: (realm: Realm) => {
    const prefs = PreferencesService.getPreferences(realm);
    return prefs.databaseSeeded;
  },

  setDatabaseSeeded: (realm: Realm) => {
    return PreferencesService.updatePreferences(realm, { databaseSeeded: true });
  }
};
