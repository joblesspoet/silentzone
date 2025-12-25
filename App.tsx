import React, { useEffect } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppNavigator } from './src/navigation/AppNavigator';
import { theme } from './src/theme';
import { RealmProvider, useRealm } from './src/database/RealmProvider';
import { locationService } from './src/services/LocationService';

const AppContent = () => {
    const realm = useRealm();

    useEffect(() => {
        // Initialize Background Location Service
        locationService.initialize(realm);
    }, [realm]);

    return (
      <NavigationContainer theme={{
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
        <AppContent />
      </RealmProvider>
    </SafeAreaProvider>
  );
};

export default App;
