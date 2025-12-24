import { Platform, Linking, Alert } from 'react-native';
import { 
  check, 
  request, 
  PERMISSIONS, 
  RESULTS, 
  PermissionStatus 
} from 'react-native-permissions';

export const PermissionsManager = {
  // Check strict type for status to avoid string mismatch issues
  getLocationStatus: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'ios') {
        return await check(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
      } else {
        return await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
      }
    } catch (error) {
      console.error('Error checking location status:', error);
      return RESULTS.DENIED;
    }
  },

  getBackgroundLocationStatus: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'ios') {
        return await check(PERMISSIONS.IOS.LOCATION_ALWAYS);
      } else {
        return await check(PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION);
      }
    } catch (error) {
      console.error('Error checking background location status:', error);
      return RESULTS.DENIED;
    }
  },

  getNotificationStatus: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'ios') {
        // iOS handled differently often, check for notifications specifically
        // But react-native-permissions 3.0+ supports PERMISSIONS.IOS.NOTIFICATIONS? 
        // No, usually use checkNotifications() from the library or PERMISSIONS
        // Let's use check(PERMISSIONS.IOS.APP_TRACKING_TRANSPARENCY) etc? 
        // Actually react-native-permissions handles notifications slightly differently
        return await check(PERMISSIONS.IOS.NOTIFICATIONS) as PermissionStatus || RESULTS.DENIED; 
        // Note: Make sure to include proper pod updates for Notifications
      } else {
        if (Platform.Version >= 33) {
          return await check(PERMISSIONS.ANDROID.POST_NOTIFICATIONS);
        }
        return RESULTS.GRANTED; // Explicit permission not needed below Android 13 usually
      }
    } catch (error) {
      console.error('Error checking notification status:', error);
      return RESULTS.DENIED;
    }
  },

  requestLocationWhenInUse: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'ios') {
        return await request(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
      } else {
        return await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
      }
    } catch (error) {
      console.error('Error requesting location:', error);
      return RESULTS.DENIED;
    }
  },

  requestLocationAlways: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'ios') {
        return await request(PERMISSIONS.IOS.LOCATION_ALWAYS);
      } else {
        return await request(PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION);
      }
    } catch (error) {
      console.error('Error requesting background location:', error);
      return RESULTS.DENIED;
    }
  },

  requestNotifications: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'ios') {
        return await request(PERMISSIONS.IOS.NOTIFICATIONS);
      } else {
        if (Platform.Version >= 33) {
          return await request(PERMISSIONS.ANDROID.POST_NOTIFICATIONS);
        }
        return RESULTS.GRANTED;
      }
    } catch (error) {
      console.error('Error requesting notifications:', error);
      return RESULTS.DENIED;
    }
  },

  openSettings: () => {
    Linking.openSettings().catch(() => {
      Alert.alert('Unable to open settings');
    });
  },

  // Helper to check if we have enough to proceed
  hasScanningPermissions: async (): Promise<boolean> => {
    const loc = await PermissionsManager.getLocationStatus();
    // For basic functionality, when-in-use is strictly minimum, but scanning needs background often
    // We'll consider granted if we have basic location for MVP
    return loc === RESULTS.GRANTED || loc === RESULTS.LIMITED;
  }
};
