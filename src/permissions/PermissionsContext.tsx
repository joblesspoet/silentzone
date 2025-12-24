import React, { createContext, useContext, useEffect, useState, AppState, ReactNode } from 'react';
import { PermissionStatus, RESULTS } from 'react-native-permissions';
import { PermissionsManager } from './PermissionsManager';

interface PermissionsContextType {
  locationStatus: PermissionStatus;
  backgroundLocationStatus: PermissionStatus;
  notificationStatus: PermissionStatus;
  refreshPermissions: () => Promise<void>;
  requestLocationFlow: () => Promise<boolean>; // Returns true if sufficient permission granted
  requestNotificationFlow: () => Promise<boolean>;
  isLoading: boolean;
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
  const [isLoading, setIsLoading] = useState(true);

  const refreshPermissions = async () => {
    const loc = await PermissionsManager.getLocationStatus();
    const bg = await PermissionsManager.getBackgroundLocationStatus();
    const notif = await PermissionsManager.getNotificationStatus();

    setLocationStatus(loc);
    setBgLocationStatus(bg);
    setNotificationStatus(notif);
    setIsLoading(false);
  };

  useEffect(() => {
    refreshPermissions();

    // Re-check permissions when app comes to foreground (e.g. back from Settings)
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
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
    return status === RESULTS.GRANTED || status === RESULTS.LIMITED;
  };

  const requestNotificationFlow = async (): Promise<boolean> => {
    const status = await PermissionsManager.requestNotifications();
    setNotificationStatus(status);
    return status === RESULTS.GRANTED;
  };

  return (
    <PermissionsContext.Provider
      value={{
        locationStatus,
        backgroundLocationStatus,
        notificationStatus,
        refreshPermissions,
        requestLocationFlow,
        requestNotificationFlow,
        isLoading,
      }}
    >
      {children}
    </PermissionsContext.Provider>
  );
};
