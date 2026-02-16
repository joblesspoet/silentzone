import React, { useEffect, useRef } from 'react';
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
import { PreferencesService } from './src/database/services/PreferencesService';
import { PersistentAlarmService } from './src/services/PersistentAlarmService';

const AppContent = () => {
    const realm = useRealm();
  const hasInitialized = useRef(false);          // ✅ run once per mount

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    // Initialize persistent alarm system
    PersistentAlarmService.initialize();

    const initializeApp = async () => {
      try {
        if (realm) {
          Logger.setRealm(realm);
          const enabled = await SettingsService.getLoggingEnabled();
          Logger.setEnabled(enabled);
        }
        const prefs = PreferencesService.getPreferences(realm);
        if (prefs?.onboardingCompleted) {
          await locationService.initialize(realm);
        } else {
          console.log('[App] Onboarding not complete, deferring LocationService init.');
          locationService.setRealmReference(realm);
        }
      } catch (error: any) {
        console.error('[App] 🔥 Initialization Error:', error);
      }
    };

    initializeApp();
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

import { GestureHandlerRootView } from 'react-native-gesture-handler';

function App(): React.JSX.Element {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="dark-content" backgroundColor={theme.colors.background.light} />
        <RealmProvider>
          <PermissionsProvider>
            <AppContent />
          </PermissionsProvider>
        </RealmProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

export default App;
