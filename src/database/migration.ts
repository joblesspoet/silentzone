import AsyncStorage from '@react-native-async-storage/async-storage';
import Realm from 'realm';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { PreferencesService } from './services/PreferencesService';

export const migrateFromAsyncStorage = async (realm: Realm) => {
  try {
    console.log('[Migration] Starting migration check...');
    console.log('[Migration] Realm schema version:', realm.schemaVersion);
    console.log('[Migration] Realm has tables:', realm.schema.map(s => s.name).join(', '));
    
    // STEP 1: Ensure Preferences exist (idempotent - safe to call multiple times)
    let prefs = realm.objectForPrimaryKey<any>('Preferences', 'USER_PREFS');
    if (!prefs) {
      console.log('[Migration] Creating default Preferences...');
      realm.write(() => {
        prefs = realm.create('Preferences', {
          id: 'USER_PREFS',
          onboardingCompleted: false,
          trackingEnabled: true,
          notificationsEnabled: true,
          maxPlaces: 3,
          databaseSeeded: false,
        });
      });
      console.log('[Migration] Default Preferences created ✅');
    } else {
      console.log('[Migration] Preferences already exist ✅');
    }
    
    // Verify Preferences are accessible
    const verifyPrefs = realm.objectForPrimaryKey<any>('Preferences', 'USER_PREFS');
    if (!verifyPrefs) {
      throw new Error('CRITICAL: Preferences not found after creation!');
    }
    console.log('[Migration] Preferences verified:', JSON.stringify({
      id: verifyPrefs.id,
      onboardingCompleted: verifyPrefs.onboardingCompleted,
      trackingEnabled: verifyPrefs.trackingEnabled,
    }));

    // STEP 2: Check if we've already migrated from AsyncStorage
    const migrationComplete = await AsyncStorage.getItem('REALM_MIGRATION_COMPLETED');
    if (migrationComplete === 'true') {
      console.log('[Migration] AsyncStorage migration already complete.');
      return;
    }

    // STEP 3: Migrate onboarding status from AsyncStorage if it exists
    console.log('[Migration] Checking for old AsyncStorage data...');
    const onboardingValue = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETED);
    
    if (onboardingValue === 'true') {
      console.log('[Migration] Migrating onboarding status...');
      realm.write(() => {
        prefs!.onboardingCompleted = true;
      });
      console.log('[Migration] Onboarding status migrated ✅');
    }

    // STEP 4: Mark migration as complete and cleanup
    await AsyncStorage.setItem('REALM_MIGRATION_COMPLETED', 'true');
    await AsyncStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETED);
    
    console.log('[Migration] Migration complete ✅');
  } catch (error) {
    console.error('[Migration] Migration failed:', error);
    throw error; // Re-throw to prevent app from continuing with broken state
  }
};
