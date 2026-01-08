import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  LOGGING_ENABLED: 'SETTINGS_LOGGING_ENABLED',
};

export class SettingsService {
  /**
   * Check if persistent logging is enabled
   */
  static async getLoggingEnabled(): Promise<boolean> {
    try {
      const value = await AsyncStorage.getItem(KEYS.LOGGING_ENABLED);
      return value === 'true'; // Default is false if null
    } catch (e) {
      console.error('[SettingsService] Failed to read logging setting', e);
      return false;
    }
  }

  /**
   * Set persistent logging preference
   */
  static async setLoggingEnabled(enabled: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem(KEYS.LOGGING_ENABLED, String(enabled));
    } catch (e) {
      console.error('[SettingsService] Failed to save logging setting', e);
    }
  }
}
