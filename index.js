/**
 * @format
 */

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';
import { crashHandler } from './src/utils/CrashHandler';

// Initialize safety net
crashHandler.initialize();

// Handle background events (required for Foreground Service)
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;

  // Check if the user has pressed the notification
  if (type === EventType.PRESS && pressAction?.id === 'default') {
    // Logic to open the app or handle action
    console.log('[Background] User pressed notification', notification?.id);
  }
});

AppRegistry.registerComponent(appName, () => App);
