import AsyncStorage from '@react-native-async-storage/async-storage';
import Realm from 'realm';
import { ONBOARDING_COMPLETED_KEY } from '../constants/storageKeys';
import { PreferencesService } from './services/PreferencesService';

export const migrateFromAsyncStorage = async (realm: Realm) => {
  try {
    // Check if migration has already run to avoid unnecessary reads
    const migrationComplete = await AsyncStorage.getItem('REALM_MIGRATION_COMPLETED');
    if (migrationComplete === 'true') {
      return;
    }

    console.log('Starting migration from AsyncStorage to Realm...');

    // Read old value
    const onboardingValue = await AsyncStorage.getItem(ONBOARDING_COMPLETED_KEY);
    const isOnboardingCompleted = onboardingValue === 'true';

    // If previously completed, update Realm
    if (isOnboardingCompleted) {
      PreferencesService.updatePreferences(realm, { onboardingCompleted: true });
      console.log('Migrated onboarding status: COMPLETED');
    }

    // Mark migration as complete
    await AsyncStorage.setItem('REALM_MIGRATION_COMPLETED', 'true');
    
    // Optional: Clean up old key
    await AsyncStorage.removeItem(ONBOARDING_COMPLETED_KEY);
    
    console.log('Migration finished successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
  }
};
