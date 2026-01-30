import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { navigationRef } from './src/navigation/NavigationService';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { theme } from './src/theme';
import { RealmProvider, useRealm } from './src/database/RealmProvider';
import { PermissionsProvider } from './src/permissions/PermissionsContext';
import { locationService } from './src/services/LocationService';
import { Logger } from './src/services/Logger';
import { SettingsService } from './src/services/SettingsService';

const AppContent = () => {
    const realm = useRealm();

    useEffect(() => {
        // Initialize Logger
        if (realm) {
            Logger.setRealm(realm);
            
            // Load logging preference
            SettingsService.getLoggingEnabled().then(enabled => {
                
                // Auto-enable in DEV if needed, or just let user toggle
                if (__DEV__) {
                  Logger.setEnabled(enabled);
                    console.log(`[App] Dev mode detected. Logging enabled: ${enabled}`);
                }
            });
        }

        // Initialize Background Location Service
        locationService.initialize(realm);
    }, [realm]);

    return (
      <NavigationContainer ref={navigationRef} theme={{
        ...DefaultTheme,
        dark: false,
        colors: { 
          ...DefaultTheme.colors,
          primary: theme.colors.primary,
          background: theme.colors.background.light,
          card: theme.colors.surface.light,
          text: theme.colors.text.primary.light,
          border: theme.colors.border.light,
          notification: theme.colors.error,
        },
      }}>
        <AppNavigator />
      </NavigationContainer>
    );
};

function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={theme.colors.background.light} />
      <RealmProvider>
        <PermissionsProvider>
          <AppContent />
        </PermissionsProvider>
      </RealmProvider>
    </SafeAreaProvider>
  );
};

export default App;
