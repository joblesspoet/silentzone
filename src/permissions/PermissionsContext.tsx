import React, { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { PermissionStatus, RESULTS } from 'react-native-permissions';
import { PermissionsManager } from './PermissionsManager';
import { locationService } from '../services/LocationService';
import { navigate } from '../navigation/NavigationService';
import { useRealm } from '../database/RealmProvider';
import { PreferencesService } from '../database/services/PreferencesService';

interface PermissionsContextType {
  locationStatus: PermissionStatus;
  backgroundLocationStatus: PermissionStatus;
  notificationStatus: PermissionStatus;
  dndStatus: PermissionStatus;
  refreshPermissions: () => Promise<void>;
  requestLocationFlow: () => Promise<boolean>;
  requestBackgroundLocationFlow: () => Promise<boolean>;
  requestNotificationFlow: () => Promise<boolean>;
  requestDndFlow: () => Promise<boolean>;
  requestBatteryExemption: () => Promise<boolean>;
  requestExactAlarmFlow: () => Promise<boolean>;
  isLoading: boolean;
  hasAllPermissions: boolean;
  isBatteryOptimized: boolean;
  exactAlarmStatus: boolean;
  getFirstMissingPermission: () => string | null;
}

const PermissionsContext = createContext<PermissionsContextType | undefined>(undefined);

export const usePermissions = () => {
  const context = useContext(PermissionsContext);
  if (!context) {
    throw new Error('usePermissions must be used within a PermissionsProvider');
  }
  return context;
};

export const PermissionsProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const realm = useRealm();
  const [locationStatus, setLocationStatus] = useState<PermissionStatus>(RESULTS.DENIED);
  const [backgroundLocationStatus, setBgLocationStatus] = useState<PermissionStatus>(RESULTS.DENIED);
  const [notificationStatus, setNotificationStatus] = useState<PermissionStatus>(RESULTS.DENIED);
  const [dndStatus, setDndStatus] = useState<PermissionStatus>(RESULTS.DENIED);
  const [isBatteryOptimized, setIsBatteryOptimized] = useState(false);
  const [exactAlarmStatus, setExactAlarmStatus] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  const isRefreshing = useRef(false);

  // FIX #1: Use a ref instead of state for previousPermissionState.
  //
  // The AppState listener is registered once inside useEffect([]) and permanently
  // closes over the INITIAL version of `refreshPermissions`. That initial version
  // closes over `previousPermissionState` at its first-render value of ''.
  // An empty string is falsy, so `if (previousPermissionState && ...)` ALWAYS
  // evaluates to false from the listener — the revoke→navigate and grant→initialize
  // blocks NEVER ran when the user returned from Android Settings.
  //
  // A ref is always read at call-time, never captured into a stale closure.
  const previousPermissionStateRef = useRef<string>('');

  const hasAllPermissions = (
    (locationStatus === RESULTS.GRANTED || locationStatus === RESULTS.LIMITED) &&
    (backgroundLocationStatus === RESULTS.GRANTED || backgroundLocationStatus === RESULTS.LIMITED) &&
    dndStatus === RESULTS.GRANTED &&
    notificationStatus === RESULTS.GRANTED &&
    isBatteryOptimized &&
    exactAlarmStatus
  );

  // FIX #1 (cont): Wrap in useCallback so the AppState listener always calls a
  // stable function reference. Combined with the ref above, all values read inside
  // refreshPermissions are either stable (setState functions, module singletons,
  // the realm ref from RealmProvider) or read from refs at invocation time.
  const refreshPermissions = useCallback(async () => {
    if (isRefreshing.current) {
      console.log('[PermissionsContext] Refresh already in progress, skipping...');
      return;
    }

    isRefreshing.current = true;
    try {
      console.log('[PermissionsContext] Starting permission refresh...');
      if (Platform.OS === 'android') {
        await new Promise<void>(resolve => setTimeout(resolve, 800));
      }

      const loc = await PermissionsManager.getLocationStatus();
      const bg = await PermissionsManager.getBackgroundLocationStatus();
      const notif = await PermissionsManager.getNotificationStatus();
      const dnd = await PermissionsManager.getDndStatus();
      const battery = await PermissionsManager.isBatteryOptimizationEnabled();
      const exactAlarm = await PermissionsManager.checkExactAlarmPermission();

      console.log('[PermissionsContext] Refreshed permissions:', {
        location: loc, background: bg, notification: notif,
        dnd, battery, exactAlarm
      });

      setLocationStatus(loc);
      setBgLocationStatus(bg);
      setNotificationStatus(notif);
      setDndStatus(dnd);
      setIsBatteryOptimized(battery);
      setExactAlarmStatus(exactAlarm);
      setIsLoading(false);

      const currentState = `${loc}-${bg}-${notif}-${dnd}-${battery}-${exactAlarm}`;
      const previousState = previousPermissionStateRef.current; // FIX #1: read ref, never stale

      if (previousState && previousState !== currentState) {
        console.log('[PermissionsContext] Permission state changed:', {
          previous: previousState,
          current: currentState
        });

        const prevParts = previousState.split('-');
        const hadAllPermissions = (
          (prevParts[0] === RESULTS.GRANTED || prevParts[0] === RESULTS.LIMITED) &&
          (prevParts[1] === RESULTS.GRANTED || prevParts[1] === RESULTS.LIMITED) &&
          prevParts[2] === RESULTS.GRANTED &&
          prevParts[3] === RESULTS.GRANTED &&
          prevParts[4] === 'true' &&
          prevParts[5] === 'true'
        );

        const hasAllNow = (
          (loc === RESULTS.GRANTED || loc === RESULTS.LIMITED) &&
          (bg === RESULTS.GRANTED || bg === RESULTS.LIMITED) &&
          notif === RESULTS.GRANTED &&
          dnd === RESULTS.GRANTED &&
          battery &&
          exactAlarm
        );

        if (hadAllPermissions && !hasAllNow) {
          console.log('[PermissionsContext] Critical permissions revoked! Stopping geofencing.');
          locationService.purgeAllAlarms();
          navigate('PermissionRequired' as any);

        } else if (!hadAllPermissions && hasAllNow) {
          if (!realm || realm.isClosed) {
            console.log('[PermissionsContext] All permissions granted, but Realm is closed.');
            return;
          }
          const isComplete = PreferencesService.isOnboardingComplete(realm);
          if (isComplete) {
            console.log('[PermissionsContext] All permissions granted with onboarding complete.');
          } else {
            console.log('[PermissionsContext] All permissions granted, onboarding not complete.');
          }
        }
      }

      previousPermissionStateRef.current = currentState; // FIX #1: write ref, not state
    } catch (err) {
      console.error('[PermissionsContext] Refresh error:', err);
    } finally {
      isRefreshing.current = false;
    }
  }, [realm]);

  useEffect(() => {
    refreshPermissions();

    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('[PermissionsContext] App became active, refreshing permissions...');
        refreshPermissions();
      }
    });

    return () => {
      subscription.remove();
    };
  }, [refreshPermissions]);

  const requestLocationFlow = async (): Promise<boolean> => {
    let status = await PermissionsManager.requestLocationWhenInUse();

    if (Platform.OS === 'android' && status === RESULTS.BLOCKED) {
        PermissionsManager.openPermissionSettings('LOCATION');
    }

    setLocationStatus(status);
    await refreshPermissions();
    return status === RESULTS.GRANTED || status === RESULTS.LIMITED;
  };

  const requestBackgroundLocationFlow = async (): Promise<boolean> => {
    const bgStatus = await PermissionsManager.requestLocationAlways();
    setBgLocationStatus(bgStatus);
    await refreshPermissions();
    return bgStatus === RESULTS.GRANTED;
  };

  const requestNotificationFlow = async (): Promise<boolean> => {
    const status = await PermissionsManager.requestNotifications();
    setNotificationStatus(status);
    await refreshPermissions();
    return status === RESULTS.GRANTED;
  };

  const requestDndFlow = async (): Promise<boolean> => {
    const status = await PermissionsManager.requestDndPermission();
    setDndStatus(status);
    await refreshPermissions();
    return status === RESULTS.GRANTED;
  };

  /**
   * BATTERY EXEMPTION FLOW — Fixed for Android 14/15 "Unrestricted" mode.
   *
   * OLD PROBLEMS:
   *   1. requestBatteryOptimization() in PermissionsManager always returned `true`
   *      immediately — even if the user tapped Cancel on the dialog.
   *   2. setIsBatteryOptimized(granted) was called with the always-true value,
   *      making the UI think battery was granted when it wasn't.
   *   3. The fallback openPermissionSettings('BATTERY') opened a list of ALL apps
   *      on the phone — user had to scroll to find yours.
   *
   * NEW FLOW:
   *   Step 1 — Fire the system dialog (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
   *            PermissionsManager now re-checks the actual result after the dialog closes.
   *   Step 2 — If still not granted (user tapped Cancel OR native module failed):
   *            Open App Info → Battery page for THIS app specifically.
   *            On Android 14/15 they see: Unrestricted / Optimized / Restricted.
   *            One tap to "Unrestricted".
   *   Step 3 — Don't update state optimistically. Set false and let the AppState
   *            listener re-check when the user returns from Settings.
   *            This is the same pattern used by requestExactAlarmFlow.
   */
  const requestBatteryExemption = async (): Promise<boolean> => {
    // Step 1: Try the system dialog first
    const grantedViaDialog = await PermissionsManager.requestBatteryOptimization();

    if (grantedViaDialog) {
      // User tapped Allow — confirmed by actual system check
      console.log('[PermissionsContext] Battery granted via dialog ✅');
      setIsBatteryOptimized(true);
      return true;
    }

    // Step 2: Dialog was cancelled or native module failed.
    // Open App Info → Battery so user can manually set "Unrestricted".
    // This is the reliable fallback for Android 14/15.
    console.log('[PermissionsContext] Battery not granted via dialog. Opening App Info → Battery...');
    await PermissionsManager.openPermissionSettings('BATTERY');

    // Step 3: Wait for user to toggle and return from Settings.
    // Same pattern as requestExactAlarmFlow — don't assume they granted it.
    if (Platform.OS === 'android') {
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }

    // Step 4: Re-check the actual system state after returning
    const grantedViaSettings = await PermissionsManager.isBatteryOptimizationEnabled();
    console.log('[PermissionsContext] Battery after App Info settings:', grantedViaSettings);

    setIsBatteryOptimized(grantedViaSettings);
    return grantedViaSettings;
  };

  const requestExactAlarmFlow = async (): Promise<boolean> => {
    // 1. Request (opens settings on Android 12+)
    await PermissionsManager.requestExactAlarmPermission();

    // 2. Wait for user to toggle and return
    if (Platform.OS === 'android') {
      await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }

    // 3. Refresh state
    const granted = await PermissionsManager.checkExactAlarmPermission();
    setExactAlarmStatus(granted);
    return granted;
  };

  return (
    <PermissionsContext.Provider
      value={{
        locationStatus,
        backgroundLocationStatus,
        notificationStatus,
        dndStatus,
        refreshPermissions,
        requestLocationFlow,
        requestBackgroundLocationFlow,
        requestNotificationFlow,
        requestDndFlow,
        requestBatteryExemption,
        requestExactAlarmFlow,
        isLoading,
        hasAllPermissions,
        isBatteryOptimized,
        exactAlarmStatus,
        getFirstMissingPermission: () => {
          const locGranted = (locationStatus === RESULTS.GRANTED || locationStatus === RESULTS.LIMITED);
          const bgGranted = (backgroundLocationStatus === RESULTS.GRANTED || backgroundLocationStatus === RESULTS.LIMITED);
          if (!locGranted) return 'LOCATION';
          if (!bgGranted) return 'BACKGROUND_LOCATION';
          if (notificationStatus !== RESULTS.GRANTED) return 'NOTIFICATION';
          if (dndStatus !== RESULTS.GRANTED) return 'DND';
          if (!isBatteryOptimized) return 'BATTERY';
          if (!exactAlarmStatus) return 'ALARM';
          return null;
        },
      }}
    >
      {children}
    </PermissionsContext.Provider>
  );
};
