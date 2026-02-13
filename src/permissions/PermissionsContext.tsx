import React, { createContext, useContext, useEffect, useState, ReactNode, useRef } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import { PermissionStatus, RESULTS } from 'react-native-permissions';
import { PermissionsManager } from './PermissionsManager';
import { locationService } from '../services/LocationService';
import { navigate } from '../navigation/NavigationService';

interface PermissionsContextType {
  locationStatus: PermissionStatus;
  backgroundLocationStatus: PermissionStatus;
  notificationStatus: PermissionStatus;
  dndStatus: PermissionStatus;
  refreshPermissions: () => Promise<void>;
  requestLocationFlow: () => Promise<boolean>; // Returns true if sufficient permission granted
  requestBackgroundLocationFlow: () => Promise<boolean>;
  requestNotificationFlow: () => Promise<boolean>;
  requestDndFlow: () => Promise<boolean>;
  requestBatteryExemption: () => Promise<boolean>;
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
  const [locationStatus, setLocationStatus] = useState<PermissionStatus>(RESULTS.DENIED);
  const [backgroundLocationStatus, setBgLocationStatus] = useState<PermissionStatus>(RESULTS.DENIED);
  const [notificationStatus, setNotificationStatus] = useState<PermissionStatus>(RESULTS.DENIED);
  const [dndStatus, setDndStatus] = useState<PermissionStatus>(RESULTS.DENIED);
  const [isBatteryOptimized, setIsBatteryOptimized] = useState(false); // Default to false (safe)
  const [exactAlarmStatus, setExactAlarmStatus] = useState(true); // Default to true (safe assumption for old android)
  const [isLoading, setIsLoading] = useState(true);
  const [previousPermissionState, setPreviousPermissionState] = useState<string>('');
  const isRefreshing = useRef(false);

  const hasAllPermissions = (
    (locationStatus === RESULTS.GRANTED || locationStatus === RESULTS.LIMITED) &&
    (backgroundLocationStatus === RESULTS.GRANTED || backgroundLocationStatus === RESULTS.LIMITED) &&
    dndStatus === RESULTS.GRANTED &&
    notificationStatus === RESULTS.GRANTED &&
    isBatteryOptimized &&
    exactAlarmStatus
  );

  const refreshPermissions = async () => {
    if (isRefreshing.current) {
      console.log('[PermissionsContext] Refresh already in progress, skipping...');
      return;
    }

    isRefreshing.current = true;
    try {
      console.log('[PermissionsContext] Starting permission refresh...');
      // Small delay to allow Android to properly apply permission changes when returning from settings
      if (Platform.OS === 'android') {
        await new Promise<void>(resolve => setTimeout(resolve, 800)); // Increased slightly for safety
      }
      
      const loc = await PermissionsManager.getLocationStatus();
      const bg = await PermissionsManager.getBackgroundLocationStatus();
      const notif = await PermissionsManager.getNotificationStatus();
      const dnd = await PermissionsManager.getDndStatus();
      const battery = await PermissionsManager.isBatteryOptimizationEnabled();
      const exactAlarm = await PermissionsManager.checkExactAlarmPermission();

      console.log('[PermissionsContext] Refreshed permissions:', {
        location: loc,
        background: bg,
        notification: notif,
        dnd: dnd,
        battery: battery,
        exactAlarm: exactAlarm
      });

      setLocationStatus(loc);
      setBgLocationStatus(bg);
      setNotificationStatus(notif);
      setDndStatus(dnd);
      setIsBatteryOptimized(battery);
      setExactAlarmStatus(exactAlarm);
      setIsLoading(false);

      // Create a permission state string for comparison
      const currentState = `${loc}-${bg}-${notif}-${dnd}-${battery}-${exactAlarm}`;
      
      // Check if permissions changed
      if (previousPermissionState && previousPermissionState !== currentState) {
        console.log('[PermissionsContext] Permission state changed:', {
          previous: previousPermissionState,
          current: currentState
        });
        
        // Calculate if we had all permissions before
        const prevParts = previousPermissionState.split('-');
        const hadAllPermissions = (
          (prevParts[0] === RESULTS.GRANTED || prevParts[0] === RESULTS.LIMITED) &&
          (prevParts[1] === RESULTS.GRANTED || prevParts[1] === RESULTS.LIMITED) &&
          prevParts[2] === RESULTS.GRANTED &&
          prevParts[3] === RESULTS.GRANTED &&
          prevParts[4] === 'true' &&
          prevParts[5] === 'true'
        );
        
        // Calculate if we have all permissions now
        const hasAllNow = (
          (loc === RESULTS.GRANTED || loc === RESULTS.LIMITED) &&
          (bg === RESULTS.GRANTED || bg === RESULTS.LIMITED) &&
          notif === RESULTS.GRANTED &&
          dnd === RESULTS.GRANTED &&
          battery &&
          exactAlarm
        );
        
        if (hadAllPermissions && !hasAllNow) {
          console.log(`[PermissionsContext] Critical permissions revoked! Stopping geofencing.`);
          locationService.purgeAllAlarms();
          
          const getFirstMissingScreen = () => {
            const locationOk = (loc === RESULTS.GRANTED || loc === RESULTS.LIMITED) && (bg === RESULTS.GRANTED || bg === RESULTS.LIMITED);
            if (!locationOk) return 'PermissionLocation';
            if (notif !== RESULTS.GRANTED) return 'PermissionNotification';
            if (dnd !== RESULTS.GRANTED) return 'PermissionDnd';
            if (!battery) return 'PermissionBattery'; 
            return 'PermissionLocation';
          };

          const target = getFirstMissingScreen();
          navigate(target);
        } else if (!hadAllPermissions && hasAllNow) {
          console.log('[PermissionsContext] All permissions granted! Geofencing can resume.');
          try {
            await locationService.syncGeofences();
          } catch (e) {
            console.warn('[PermissionsContext] Failed to resync geofences:', e);
          }
        }
      }
      
      setPreviousPermissionState(currentState);
    } catch (err) {
      console.error('[PermissionsContext] Refresh error:', err);
    } finally {
      isRefreshing.current = false;
    }
  };

  useEffect(() => {
    refreshPermissions();

    // Re-check permissions when app comes to foreground (e.g. back from Settings)
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        console.log('[PermissionsContext] App became active, refreshing permissions...');
        refreshPermissions();
      }
    });

    return () => {
      subscription.remove();
    };
  }, []);

  const requestLocationFlow = async (): Promise<boolean> => {
    // 1. Request When In Use (Foreground)
    let status = await PermissionsManager.requestLocationWhenInUse();
    setLocationStatus(status);
    
    // 2. Refresh immediately to update state
    await refreshPermissions(); 
    
    return status === RESULTS.GRANTED || status === RESULTS.LIMITED;
  };

  const requestBackgroundLocationFlow = async (): Promise<boolean> => {
    // Step 2: Request Always (Background)
    const bgStatus = await PermissionsManager.requestLocationAlways();
    setBgLocationStatus(bgStatus);
    
    await refreshPermissions();
    return bgStatus === RESULTS.GRANTED;
  };

  const requestNotificationFlow = async (): Promise<boolean> => {
    const status = await PermissionsManager.requestNotifications();
    setNotificationStatus(status);
    await refreshPermissions(); // Refresh to update state
    return status === RESULTS.GRANTED;
  };

  const requestDndFlow = async (): Promise<boolean> => {
    // Note: This opens external settings. AppState listener will catch the return.
    const status = await PermissionsManager.requestDndPermission();
    setDndStatus(status);
    return status === RESULTS.GRANTED;
  };
    
  const requestBatteryExemption = async (): Promise<boolean> => {
     // Note: This opens external settings. AppState listener will catch the return.
     const granted = await PermissionsManager.requestBatteryOptimization();
     setIsBatteryOptimized(granted);
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