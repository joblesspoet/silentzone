import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AppState, AppStateStatus } from 'react-native';
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
  requestNotificationFlow: () => Promise<boolean>;
  requestDndFlow: () => Promise<boolean>;
  requestBatteryExemption: () => Promise<boolean>;
  isLoading: boolean;
  hasAllPermissions: boolean;
  isBatteryOptimized: boolean;
  exactAlarmStatus: boolean;
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

  const hasAllPermissions = (
    (locationStatus === RESULTS.GRANTED || locationStatus === RESULTS.LIMITED) &&
    (backgroundLocationStatus === RESULTS.GRANTED || backgroundLocationStatus === RESULTS.LIMITED) &&
    dndStatus === RESULTS.GRANTED &&
    notificationStatus === RESULTS.GRANTED &&
    isBatteryOptimized &&
    exactAlarmStatus
  );

  const refreshPermissions = async () => {
    const loc = await PermissionsManager.getLocationStatus();
    const bg = await PermissionsManager.getBackgroundLocationStatus();
    const notif = await PermissionsManager.getNotificationStatus();
    const dnd = await PermissionsManager.getDndStatus();
    const battery = await PermissionsManager.isBatteryOptimizationEnabled();
    const exactAlarm = await PermissionsManager.checkExactAlarmPermission();

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
      
      console.log('[PermissionsContext] Permission check:', {
        hadAllPermissions,
        hasAllNow
      });
      
      if (hadAllPermissions && !hasAllNow) {
        console.log('[PermissionsContext] Critical permissions revoked! Stopping geofencing and redirecting to permission screen...');
        
        // Stop background services/geofencing immediately
        locationService.destroy();

        // Determine which permission is missing and navigate to that screen
        const getFirstMissingScreen = () => {
          const locationOk = (loc === RESULTS.GRANTED || loc === RESULTS.LIMITED) && (bg === RESULTS.GRANTED || bg === RESULTS.LIMITED);
          if (!locationOk) return 'PermissionLocation';
          if (notif !== RESULTS.GRANTED) return 'PermissionNotification';
          if (dnd !== RESULTS.GRANTED) return 'PermissionDnd';
          if (!battery) return 'PermissionBattery'; // You might need to creation this screen or handle it
          return 'PermissionLocation';
        };

        const target = getFirstMissingScreen();
        navigate(target);
      } else if (!hadAllPermissions && hasAllNow) {
        console.log('[PermissionsContext] All permissions granted! Geofencing can resume.');
        // Explicitly resync geofences to ensure monitoring restarts immediately
        try {
          await locationService.syncGeofences();
        } catch (e) {
          console.warn('[PermissionsContext] Failed to resync geofences after permissions restored:', e);
        }
      }
    }
    
    setPreviousPermissionState(currentState);
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
    // 1. Request When In Use
    let status = await PermissionsManager.requestLocationWhenInUse();
    
    // 2. If granted, try to upgrade to Always (if needed/desired immediately)
    // Note: iOS often requires two steps or shows "Keep Only While Using" initially.
    // For this flow, we'll request Always if InUse is granted.
    if (status === RESULTS.GRANTED || status === RESULTS.LIMITED) {
      const bgStatus = await PermissionsManager.requestLocationAlways();
      setBgLocationStatus(bgStatus);
    }
    
    setLocationStatus(status);
    await refreshPermissions(); // Refresh to update state
    return status === RESULTS.GRANTED || status === RESULTS.LIMITED;
  };

  const requestNotificationFlow = async (): Promise<boolean> => {
    const status = await PermissionsManager.requestNotifications();
    setNotificationStatus(status);
    await refreshPermissions(); // Refresh to update state
    return status === RESULTS.GRANTED;
  };

  const requestDndFlow = async (): Promise<boolean> => {
    const status = await PermissionsManager.requestDndPermission();
    // Since requestDndPermission opens settings, we can't reliably know the result immediately
    // Refresh will happen when app returns to foreground
    setDndStatus(status);
    await refreshPermissions(); // Refresh to update state
    return status === RESULTS.GRANTED;
  };
    
  const requestBatteryExemption = async (): Promise<boolean> => {
     const granted = await PermissionsManager.requestBatteryOptimization();
     setIsBatteryOptimized(granted);
     await refreshPermissions();
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
        requestNotificationFlow,
        requestDndFlow,
        requestBatteryExemption,
        isLoading,
        hasAllPermissions,
        isBatteryOptimized,
        exactAlarmStatus,
      }}
    >
      {children}
    </PermissionsContext.Provider>
  );
};
