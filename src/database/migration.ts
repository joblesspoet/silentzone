import AsyncStorage from '@react-native-async-storage/async-storage';
import Realm from 'realm';
import { STORAGE_KEYS } from '../constants/storageKeys';
import { PreferencesService } from './services/PreferencesService';

export const migrateFromAsyncStorage = async (realm: Realm) => {
  try {
    console.log('[Migration] Checking if migration complete...');
    const migrationComplete = await AsyncStorage.getItem('REALM_MIGRATION_COMPLETED');
    console.log('[Migration] migrationComplete status:', migrationComplete);
    
    if (migrationComplete === 'true') {
      console.log('[Migration] Migration already marked as complete.');
      return;
    }

    console.log('[Migration] Starting migration from AsyncStorage to Realm...');

    // Read old value
    console.log('[Migration] Reading onboarding value from AsyncStorage...');
    const onboardingValue = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETED);
    console.log('[Migration] onboardingValue read:', onboardingValue);
    
    const isOnboardingCompleted = onboardingValue === 'true';

    // If previously completed, update Realm
    if (isOnboardingCompleted) {
      console.log('[Migration] Updating Preferences in Realm...');
      PreferencesService.updatePreferences(realm, { onboardingCompleted: true });
      console.log('[Migration] Migrated onboarding status: COMPLETED');
    }

    // Mark migration as complete
    console.log('[Migration] Marking migration as complete in AsyncStorage...');
    await AsyncStorage.setItem('REALM_MIGRATION_COMPLETED', 'true');
    
    // Optional: Clean up old key
    console.log('[Migration] Removing old onboarding key from AsyncStorage...');
    await AsyncStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETED);
    
    console.log('[Migration] Migration finished successfully.');
  } catch (error) {
    console.error('[Migration] Migration failed with error:', error);
  }
};
