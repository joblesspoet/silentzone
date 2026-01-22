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

// NEW: Helper to get realm in background
const getRealm = async () => {
    const Realm = require('realm');
    const { schemas, SCHEMA_VERSION } = require('./src/database/schemas');
    return await Realm.open({
        schema: schemas,
        schemaVersion: SCHEMA_VERSION,
    });
};

// Handle background events (required for Foreground Service)
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;

  // Handle AlarmManager Trigger
  const isAlarmAction = notification?.data?.action === 'START_MONITORING' || 
                        notification?.data?.action === 'START_SILENCE' || 
                        notification?.data?.action === 'STOP_SILENCE';

  if (type === EventType.DELIVERED && isAlarmAction) {
      const alarmType = notification.data.action;
      console.log(`[Background] ⏰ Alarm received via Notifee (${alarmType})`);
      
      try {
          // 1. Open Realm (required for LocationService)
          const realm = await getRealm();
          
          // 2. Initialize Service with the realm
          await locationService.initialize(realm);
          
          // 3. Handle the alarm
          await locationService.handleAlarmFired(notification.data);
      } catch (err) {
          console.error('[Background] Failed to init background components:', err);
      }
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
