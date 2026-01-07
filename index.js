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

const { locationService } = require('./src/services/LocationService');

// Handle background events (required for Foreground Service)
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;

  // Handle AlarmManager Trigger
  if (type === EventType.DELIVERED && notification?.data?.action === 'START_MONITORING') {
      const alarmType = notification.data.alarmType || 'unknown';
      console.log(`[Background] ⏰ Alarm received via Notifee (${alarmType})`);
      await locationService.handleAlarmFired();
  }

  // Check if the user has pressed the notification
  if (type === EventType.PRESS && pressAction?.id === 'default') {
    // Logic to open the app or handle action
    console.log('[Background] User pressed notification', notification?.id);
  }
});

// Register foreground service (Required for Android 14+)
notifee.registerForegroundService((notification) => {
  return new Promise(() => {
    // Long running task...
    console.log('[ForegroundService] Active');
  });
});

AppRegistry.registerComponent(appName, () => App);
