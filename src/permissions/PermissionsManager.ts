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

const EXACT_ALARM_OVERRIDE_KEY = 'EXACT_ALARM_OVERRIDE';

// Your app package name — used for direct intent navigation
const APP_PACKAGE = 'com.qybrix.silentzone';

export const PermissionsManager = {

  // ============================================================================
  // BATTERY — Fixed for Android 14/15 "Unrestricted" mode
  // ============================================================================

  isBatteryOptimizationEnabled: async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      return await BatteryOptimization.isIgnoringBatteryOptimizations();
    } catch (error) {
      console.error('Error checking battery optimization:', error);
      return false;
    }
  },

  /**
   * FIX: Previously always returned `true` immediately after calling the native
   * module — even if the user tapped "Cancel" on the system dialog.
   *
   * Now: fires the dialog, waits briefly, then re-checks the ACTUAL system state.
   * If the native module throws (missing AndroidManifest permission, OEM block),
   * returns false so the caller can fall back to App Info settings.
   */
  requestBatteryOptimization: async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;
    try {
      // Short-circuit: already granted
      const alreadyGranted = await BatteryOptimization.isIgnoringBatteryOptimizations();
      if (alreadyGranted) {
        console.log('[PermissionsManager] Battery: already unrestricted');
        return true;
      }

      // Fire ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS system dialog
      if (BatteryOptimization?.requestIgnoreBatteryOptimizations) {
        await BatteryOptimization.requestIgnoreBatteryOptimizations();
      }

      // Wait for the system to process the user's tap (Allow / Deny)
      await new Promise<void>(resolve => setTimeout(resolve, 800));

      // Re-check the ACTUAL result — don't assume the user tapped Allow
      const granted = await BatteryOptimization.isIgnoringBatteryOptimizations();
      console.log('[PermissionsManager] Battery after dialog:', granted);
      return granted;

    } catch (error) {
      // Native module failed (missing AndroidManifest declaration, OEM block, etc.)
      // Return false — context will open App Info Battery page as fallback.
      console.error('[PermissionsManager] Battery dialog failed, will open App Info:', error);
      return false;
    }
  },

  // ============================================================================
  // LOCATION
  // ============================================================================

  getLocationStatus: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'ios') {
        return await check(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
      } else {
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
        console.log('Falling back to app details for background location...');
        PermissionsManager.openPermissionSettings('LOCATION');
      }
      return RESULTS.DENIED;
    }
  },

  requestNotifications: async (): Promise<PermissionStatus> => {
    try {
      const { status } = await requestNotifications(['alert', 'sound', 'badge']);
      if (Platform.OS === 'android' && status === RESULTS.BLOCKED) {
         PermissionsManager.openPermissionSettings('NOTIFICATION');
      }
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
      return RESULTS.GRANTED;
    } catch (error) {
      console.error('Error checking DND status:', error);
      return RESULTS.DENIED;
    }
  },

  requestDndPermission: async (): Promise<PermissionStatus> => {
    try {
      if (Platform.OS === 'android') {
        await RingerMode.requestDndPermission();
        return RESULTS.DENIED; // AppState listener handles return
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
    const battery = await PermissionsManager.isBatteryOptimizationEnabled();

    return (
      (loc === RESULTS.GRANTED || loc === RESULTS.LIMITED) &&
      (bg === RESULTS.GRANTED || bg === RESULTS.LIMITED) &&
      (dnd === RESULTS.GRANTED) &&
      (notif === RESULTS.GRANTED) &&
      exactAlarm &&
      battery
    );
  },

  hasCriticalPermissions: async (): Promise<boolean> => {
    const loc = await PermissionsManager.getLocationStatus();
    const bg = await PermissionsManager.getBackgroundLocationStatus();
    const notif = await PermissionsManager.getNotificationStatus();
    const exactAlarm = await PermissionsManager.checkExactAlarmPermission();
    const battery = await PermissionsManager.isBatteryOptimizationEnabled();

    console.log(`[PermissionsManager] Check - Loc: ${loc}, Bg: ${bg}, Notif: ${notif}, Alarm: ${exactAlarm}, Battery: ${battery}`);

    return (
      (loc === RESULTS.GRANTED || loc === RESULTS.LIMITED) &&
      (bg === RESULTS.GRANTED || bg === RESULTS.LIMITED) &&
      (notif === RESULTS.GRANTED) &&
      exactAlarm &&
      battery
    );
  },

  checkExactAlarmPermission: async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    let hasPermission = false;

    if (ExactAlarmModule?.canScheduleExactAlarms) {
      try {
        hasPermission = await ExactAlarmModule.canScheduleExactAlarms();
        console.log('[PermissionsManager] Native checkExactAlarm:', hasPermission);
      } catch (error) {
        console.error('Error using ExactAlarmModule:', error);
      }
    } else if (Platform.Version < 31) {
      hasPermission = true;
    } else {
      try {
        const override = await AsyncStorage.getItem(EXACT_ALARM_OVERRIDE_KEY);
        if (override === 'true') {
          console.log('[PermissionsManager] ExactAlarmModule unavailable, using stored override: granted');
          hasPermission = true;
        } else if (override === 'false') {
          console.log('[PermissionsManager] ExactAlarmModule unavailable, using stored override: denied');
          hasPermission = false;
        } else {
          console.warn('[PermissionsManager] ExactAlarmModule null and no override set — defaulting to true');
          hasPermission = true;
        }
      } catch (e) {
        console.warn('[PermissionsManager] Could not read alarm override:', e);
        hasPermission = true;
      }
    }

    if (hasPermission && Platform.Version >= 31) {
      try {
        const notifee = require('@notifee/react-native').default;
        const settings = await notifee.getNotificationSettings();
        const notifeeAgrees = settings.android.alarm === 1;
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
        return RESULTS.DENIED;
      }
      PermissionsManager.openPermissionSettings('ALARM');
      return RESULTS.DENIED;
    } catch (error) {
      console.error('Error requesting exact alarm permission:', error);
      PermissionsManager.openPermissionSettings('ALARM');
      return RESULTS.DENIED;
    }
  },

  setExactAlarmManuallyGranted: async (granted: boolean): Promise<void> => {
    try {
      await AsyncStorage.setItem(EXACT_ALARM_OVERRIDE_KEY, granted ? 'true' : 'false');
    } catch (e) {
      console.error('Failed to set alarm override', e);
    }
  },

  /**
   * Opens the specific settings page for a given permission type.
   *
   * BATTERY FIX:
   * OLD: ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
   *      → Dumps user on a list of EVERY app. They must scroll and find yours.
   *
   * NEW: Three-tier strategy for Android 14/15 "Unrestricted" mode:
   *   1. OEM-specific battery page (Samsung, Xiaomi, Huawei) — most direct path
   *   2. App Info → Battery (Settings → Apps → [App] → Battery → Unrestricted)
   *      One tap away from "Unrestricted". Works on all stock Android 8+.
   *   3. Generic list — absolute last resort fallback only
   */
  openPermissionSettings: async (type: 'NOTIFICATION' | 'ALARM' | 'BATTERY' | 'LOCATION' | 'DND') => {
    if (Platform.OS !== 'android') {
      Linking.openSettings();
      return;
    }

    try {
      switch (type) {
        case 'NOTIFICATION':
          await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
            { key: 'android.provider.extra.APP_PACKAGE', value: APP_PACKAGE }
          ]);
          return;

        case 'ALARM':
          await Linking.sendIntent('android.settings.REQUEST_SCHEDULE_EXACT_ALARM', [
            { key: 'android.provider.extra.APP_PACKAGE', value: APP_PACKAGE }
          ]);
          return;

        case 'BATTERY': {
          const manufacturer = (
            (Platform as any).constants?.Manufacturer ||
            (Platform as any).constants?.Brand ||
            ''
          ).toLowerCase();

          console.log(`[PermissionsManager] Battery settings — OEM: "${manufacturer}"`);

          // ── Tier 1: Samsung ─────────────────────────────────────────────────
          // Samsung adds its own Device Care battery layer on top of Android.
          // isIgnoringBatteryOptimizations() can return true but Samsung still
          // kills the app unless it's whitelisted in Device Care too.
          if (manufacturer.includes('samsung')) {
            try {
              await Linking.sendIntent(
                'com.samsung.android.lool.ManuallyManagedAppsActivity'
              );
              console.log('[PermissionsManager] Opened Samsung Device Care battery page');
              return;
            } catch {
              // Samsung intent missing on this firmware, fall through
            }
          }

          // ── Tier 1: Xiaomi / MIUI ───────────────────────────────────────────
          // MIUI has AutoStart + Background Activity controls that override AOSP.
          if (
            manufacturer.includes('xiaomi') ||
            manufacturer.includes('redmi') ||
            manufacturer.includes('poco')
          ) {
            try {
              await Linking.sendIntent('miui.intent.action.APP_PERM_EDITOR', [
                { key: 'extra_pkgname', value: APP_PACKAGE },
              ]);
              console.log('[PermissionsManager] Opened Xiaomi App Permissions page');
              return;
            } catch {
              // Fall through
            }
          }

          // ── Tier 1: Huawei / EMUI ───────────────────────────────────────────
          if (manufacturer.includes('huawei') || manufacturer.includes('honor')) {
            try {
              await Linking.sendIntent(
                'com.huawei.systemmanager/.optimize.process.ProtectActivity'
              );
              console.log('[PermissionsManager] Opened Huawei battery settings');
              return;
            } catch {
              // Fall through
            }
          }

          // ── Tier 2: Standard App Info → Battery (all AOSP Android 8+) ───────
          // Settings → Apps → Silent Zone → Battery → [Unrestricted / Optimized / Restricted]
          // User is one tap from "Unrestricted". Far better than the generic list.
          try {
            await Linking.sendIntent('android.settings.APPLICATION_DETAILS_SETTINGS', [
              { key: 'package', value: APP_PACKAGE }
            ]);
            console.log('[PermissionsManager] Opened App Info (tap Battery → Unrestricted)');
            return;
          } catch {
            // Fall through to last resort
          }

          // ── Tier 3: Generic list — last resort only ──────────────────────────
          console.warn('[PermissionsManager] All battery intents failed, opening generic list');
          await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
          return;
        }

        case 'LOCATION':
          await Linking.sendIntent('android.settings.APPLICATION_DETAILS_SETTINGS', [
            { key: 'package', value: APP_PACKAGE }
          ]);
          return;

        case 'DND':
          await Linking.sendIntent('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS');
          return;

        default:
          await Linking.openSettings();
          return;
      }
    } catch (error) {
      console.warn(`[PermissionsManager] Failed to launch intent for ${type}, falling back.`, error);
      Linking.openSettings();
    }
  }
};