import { Platform, Linking, Alert, NativeModules, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import RingerMode from '../modules/RingerMode';
import { 
  check, 
  request, 
  PERMISSIONS, 
  RESULTS, 
  PermissionStatus,
  checkNotifications,
  requestNotifications
} from 'react-native-permissions';
import Geolocation from '@react-native-community/geolocation';

const { BatteryOptimization, ExactAlarmModule } = NativeModules;

// ...

// Android 12+ Exact Alarm Permission
// Use REQUEST_SCHEDULE_EXACT_ALARM for apps that need user approval
// SCHEDULE_EXACT_ALARM is for alarm/calendar apps only (auto-granted)
const CHECK_EXACT_ALARM_PERMISSION = Platform.select({
  android: 'android.permission.REQUEST_SCHEDULE_EXACT_ALARM',
  default: undefined,
});

export const PermissionsManager = {
  // Check strict type for status to avoid string mismatch issues
  isBatteryOptimizationEnabled: async (): Promise<boolean> => {
     if (Platform.OS !== 'android') return true;
     try {
       return await BatteryOptimization.isIgnoringBatteryOptimizations();
     } catch (error) {
       console.error('Error checking battery optimization:', error);
       return false;
     }
  },

  requestBatteryOptimization: async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      await BatteryOptimization.requestIgnoreBatteryOptimizations();
      return true;
    } catch (error) {
      console.error('Error requesting battery optimization:', error);
      return false;
    }
  },

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
      const { status } = await checkNotifications();
      return status;
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
      const { status } = await requestNotifications(['alert', 'sound', 'badge']);
      return status;
    } catch (error) {
      console.error('Error requesting notifications:', error);
      return RESULTS.DENIED;
    }
  },

  getDndStatus: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'android') {
        const hasPermission = await RingerMode.checkDndPermission();
        return hasPermission ? RESULTS.GRANTED : RESULTS.DENIED;
      }
      return RESULTS.GRANTED; // iOS doesn't have DND permission via API
    } catch (error) {
      console.error('Error checking DND status:', error);
      return RESULTS.DENIED;
    }
  },

  requestDndPermission: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'android') {
        await RingerMode.requestDndPermission();
        // Native method opens settings, so we can't wait for result here.
        // The AppState listener in PermissionsContext will refresh the state.
        return RESULTS.DENIED; 
      }
      return RESULTS.GRANTED;
    } catch (error) {
      console.error('Error requesting DND permission:', error);
      return RESULTS.DENIED;
    }
  },

  openSettings: () => {
    Linking.openSettings().catch(() => {
      Alert.alert('Unable to open settings');
    });
  },

  isGpsEnabled: async (): Promise<boolean> => {
    return new Promise((resolve) => {
      Geolocation.getCurrentPosition(
        () => resolve(true),
        (error) => {
          console.log('[PermissionsManager] GPS Check Error:', error);
          // Error code 2 is POSITION_UNAVAILABLE (GPS disabled or Airplane mode)
          if (error.code === 2) {
            resolve(false);
          } else {
            // Timeout (3) or Permission (1) does not mean the SWITCH is off.
            // We assume true to avoid blocking the user, as the actual location fetch will retry.
            resolve(true); 
          }
        },
        // We use low accuracy for this check because we just want to know if 
        // ANY location provider is on, and it's faster.
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 10000 }
      );
    });
  },

  // Helper to check if we have enough to proceed
  hasScanningPermissions: async (): Promise<boolean> => {
    const loc = await PermissionsManager.getLocationStatus();
    const bg = await PermissionsManager.getBackgroundLocationStatus();
    const dnd = await PermissionsManager.getDndStatus();
    const notif = await PermissionsManager.getNotificationStatus();
    const exactAlarm = await PermissionsManager.checkExactAlarmPermission();
    
    return (
      (loc === RESULTS.GRANTED || loc === RESULTS.LIMITED) &&
      (bg === RESULTS.GRANTED || bg === RESULTS.LIMITED) &&
      (dnd === RESULTS.GRANTED) &&
      (notif === RESULTS.GRANTED) &&
      exactAlarm
    );
  },

  // Newer, more lenient check for starting the service active monitoring
  hasCriticalPermissions: async (): Promise<boolean> => {
    const loc = await PermissionsManager.getLocationStatus();
    const bg = await PermissionsManager.getBackgroundLocationStatus();
    const notif = await PermissionsManager.getNotificationStatus();
    const exactAlarm = await PermissionsManager.checkExactAlarmPermission();
    
    console.log(`[PermissionsManager] Check - Loc: ${loc}, Bg: ${bg}, Notif: ${notif}, Alarm: ${exactAlarm}`);

    // We allow DND to be missing (we just won't silence, but we WILL track)
    return (
      (loc === RESULTS.GRANTED || loc === RESULTS.LIMITED) &&
      (bg === RESULTS.GRANTED || bg === RESULTS.LIMITED) &&
      (notif === RESULTS.GRANTED) &&
      exactAlarm
    );
  },

  checkExactAlarmPermission: async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    
    // Use new native module if available
    if (ExactAlarmModule?.canScheduleExactAlarms) {
        try {
            const hasPermission = await ExactAlarmModule.canScheduleExactAlarms();
            return hasPermission;
        } catch (error) {
            console.error('Error using ExactAlarmModule:', error);
        }
    }

    if (Platform.Version < 31) return true;
    
    return false;
  },

  requestExactAlarmPermission: async (): Promise<PermissionStatus> => {
    if (Platform.OS !== 'android' || Platform.Version < 31) return RESULTS.GRANTED;
    
    try {
        if (ExactAlarmModule?.openExactAlarmSettings) {
             await ExactAlarmModule.openExactAlarmSettings();
             return RESULTS.DENIED; // waiting for user
        }
        
        // Fallback
        Linking.openSettings();
        return RESULTS.DENIED;
    } catch (error) {
       console.error('Error requesting exact alarm permission:', error);
       Linking.openSettings();
       return RESULTS.DENIED;
    }
  },

  setExactAlarmManuallyGranted: async (granted: boolean): Promise<void> => {
    try {
      await AsyncStorage.setItem('EXACT_ALARM_OVERRIDE', granted ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to set alarm override', e);
    }
  }
};