import React, { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { navigationRef } from './src/navigation/NavigationService';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { theme } from './src/theme';
import { RealmProvider, useRealm } from './src/database/RealmProvider';
import {
  PermissionsProvider,
  usePermissions,
} from './src/permissions/PermissionsContext';
import { locationService } from './src/services/LocationService';
import { Logger } from './src/services/Logger';
import { SettingsService } from './src/services/SettingsService';
import { PreferencesService } from './src/database/services/PreferencesService';
import { PersistentAlarmService } from './src/services/PersistentAlarmService';

const AppContent = () => {
  const realm = useRealm();
  const { hasAllPermissions } = usePermissions();
  const hasInitialized = useRef(false);
  const engineBooted = useRef(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

  useEffect(() => {
    if (!realm) return;

    if (!hasInitialized.current) {
      hasInitialized.current = true;
      PersistentAlarmService.initialize();
      const wireLogging = async () => {
        try {
          Logger.setRealm(realm);
          const enabled = await SettingsService.getLoggingEnabled();
          Logger.setEnabled(enabled);
          locationService.setRealmReference(realm);
        } catch (error: any) {
          console.error('[App] Logging initialization error:', error);
        }
      };
      wireLogging();
    }

    const prefs = PreferencesService.getPreferences(realm);
    setOnboardingCompleted(!!prefs?.onboardingCompleted);

    if (prefs && typeof (prefs as any).addListener === 'function') {
      const listener = (p: any) => {
        if (p && p.isValid && p.isValid()) {
          setOnboardingCompleted(!!p.onboardingCompleted);
        }
      };
      (prefs as any).addListener(listener);
      return () => {
        (prefs as any).removeListener(listener);
      };
    }
  }, [realm]);

  useEffect(() => {
    if (!realm) return;
    if (!onboardingCompleted || !hasAllPermissions) return;
    if (engineBooted.current) return;
    engineBooted.current = true;

    const bootEngine = async () => {
      try {
        await locationService.initialize(realm);
      } catch (error: any) {
        console.error('[App] Engine initialization error:', error);
        engineBooted.current = false;
      }
    };

    bootEngine();
  }, [realm, onboardingCompleted, hasAllPermissions]);

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={{
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
      }}
    >
      <AppNavigator />
    </NavigationContainer>
  );
};

import { GestureHandlerRootView } from 'react-native-gesture-handler';

function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar
          barStyle="dark-content"
          backgroundColor={theme.colors.background.light}
        />
        <RealmProvider>
          <PermissionsProvider>
            <AppContent />
          </PermissionsProvider>
        </RealmProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;
