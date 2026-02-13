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
import Geolocation from 'react-native-geolocation-service';

const { BatteryOptimization, ExactAlarmModule } = NativeModules;

// Android 12+ Exact Alarm Permission
// Use REQUEST_SCHEDULE_EXACT_ALARM for apps that need user approval
// SCHEDULE_EXACT_ALARM is for alarm/calendar apps only (auto-granted)
const EXACT_ALARM_OVERRIDE_KEY = 'EXACT_ALARM_OVERRIDE';

export const PermissionsManager = {

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
        // Dual check for Android 16 compatibility
        const rnpStatus = await check(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);

        if (rnpStatus !== RESULTS.GRANTED && rnpStatus !== RESULTS.LIMITED) {
          try {
            const coreStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
            if (coreStatus) {
              console.log('[PermissionsManager] RNP reported', rnpStatus, 'but Core reported GRANTED for FINE_LOCATION');
              return RESULTS.GRANTED;
            }
          } catch (coreError) {
            console.error('[PermissionsManager] Core check failed for FINE_LOCATION:', coreError);
          }
        }
        return rnpStatus;
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
        const rnpStatus = await check(PERMISSIONS.ANDROID.ACCESS_BACKGROUND_LOCATION);

        // Dual check for Android 16 compatibility
        if (rnpStatus !== RESULTS.GRANTED && rnpStatus !== RESULTS.LIMITED) {
          try {
            const coreStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION);
            if (coreStatus) {
              console.log('[PermissionsManager] RNP reported', rnpStatus, 'but Core reported GRANTED for BACKGROUND_LOCATION');
              return RESULTS.GRANTED;
            }
          } catch (coreError) {
            console.error('[PermissionsManager] Core check failed for BACKGROUND_LOCATION:', coreError);
          }
        }

        return rnpStatus;
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
      if (Platform.OS === 'android') {
        console.log('Falling back to settings for background location...');
        Linking.openSettings();
      }
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
        // Native method opens settings — AppState listener in PermissionsContext handles the return.
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
          if (error.code === 2) {
            resolve(false);
          } else {
            resolve(true);
          }
        },
        { enableHighAccuracy: false, timeout: 5000, maximumAge: 10000 }
      );
    });
  },

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

  hasCriticalPermissions: async (): Promise<boolean> => {
    const loc = await PermissionsManager.getLocationStatus();
    const bg = await PermissionsManager.getBackgroundLocationStatus();
    const notif = await PermissionsManager.getNotificationStatus();
    const exactAlarm = await PermissionsManager.checkExactAlarmPermission();

    console.log(`[PermissionsManager] Check - Loc: ${loc}, Bg: ${bg}, Notif: ${notif}, Alarm: ${exactAlarm}`);

    return (
      (loc === RESULTS.GRANTED || loc === RESULTS.LIMITED) &&
      (bg === RESULTS.GRANTED || bg === RESULTS.LIMITED) &&
      (notif === RESULTS.GRANTED) &&
      exactAlarm
    );
  },

  checkExactAlarmPermission: async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    let hasPermission = false;

    // 1. Check via Native Module (Preferred)
    if (ExactAlarmModule?.canScheduleExactAlarms) {
      try {
        hasPermission = await ExactAlarmModule.canScheduleExactAlarms();
        console.log('[PermissionsManager] Native checkExactAlarm:', hasPermission);
      } catch (error) {
        console.error('Error using ExactAlarmModule:', error);
      }
    } else if (Platform.Version < 31) {
      // Pre-Android 12: exact alarms are always available
      hasPermission = true;
    } else {
      // FIX #3: ExactAlarmModule is null on Android 12+ (native module not linked or
      // failed to load). Previously this left `hasPermission = false` with no fallback,
      // permanently blocking the user even if they had granted the permission.
      // Read the manual override that setExactAlarmManuallyGranted() writes.
      // Without this read, that entire function was dead code — it wrote a value
      // that was NEVER read back, making the override feature silently broken.
      try {
        const override = await AsyncStorage.getItem(EXACT_ALARM_OVERRIDE_KEY);
        if (override === 'true') {
          console.log('[PermissionsManager] ExactAlarmModule unavailable, using stored override: granted');
          hasPermission = true;
        } else if (override === 'false') {
          console.log('[PermissionsManager] ExactAlarmModule unavailable, using stored override: denied');
          hasPermission = false;
        } else {
          // No override set and no native module — assume true to avoid
          // permanently blocking users on devices where the module fails to load.
          console.warn('[PermissionsManager] ExactAlarmModule null and no override set — defaulting to true');
          hasPermission = true;
        }
      } catch (e) {
        console.warn('[PermissionsManager] Could not read alarm override:', e);
        hasPermission = true; // safe fallback
      }
    }

    // 2. Cross-check with Notifee only when we think we have permission
    if (hasPermission && Platform.Version >= 31) {
      try {
        const notifee = require('@notifee/react-native').default;
        const settings = await notifee.getNotificationSettings();
        const notifeeAgrees = settings.android.alarm === 1; // 1 = ENABLED
        console.log('[PermissionsManager] Notifee agrees on ExactAlarm:', notifeeAgrees);
        return notifeeAgrees;
      } catch (error) {
        console.warn('[PermissionsManager] Notifee check failed:', error);
      }
    }

    return hasPermission;
  },

  requestExactAlarmPermission: async (): Promise<PermissionStatus> => {
    if (Platform.OS !== 'android' || Platform.Version < 31) return RESULTS.GRANTED;

    try {
      if (ExactAlarmModule?.openExactAlarmSettings) {
        await ExactAlarmModule.openExactAlarmSettings();
        return RESULTS.DENIED; // waiting for user to return from settings
      }
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
      await AsyncStorage.setItem(EXACT_ALARM_OVERRIDE_KEY, granted ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to set alarm override', e);
    }
  }
};