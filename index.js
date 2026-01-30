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

// Helper to show error notification when background processing fails
const showBackgroundErrorNotification = async (errorMessage) => {
    try {
        // Create alerts channel if not exists
        await notifee.createChannel({
            id: 'background-errors',
            name: 'Background Service Errors',
            importance: 4, // HIGH
            vibration: true,
        });

        await notifee.displayNotification({
            id: 'background-error',
            title: '⚠️ Silent Zone Alert',
            body: errorMessage || 'Background service failed. Please open the app to ensure silent zones work.',
            android: {
                channelId: 'background-errors',
                smallIcon: 'ic_launcher',
                color: '#FF6B6B',
                importance: 4, // HIGH
                pressAction: {
                    id: 'default',
                    launchActivity: 'default',
                },
            },
        });
    } catch (e) {
        console.error('[Background] Failed to show error notification:', e);
    }
};

// Handle background events (required for Foreground Service)
notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;

  // CRITICAL FIX: Handle ALL event types that could contain alarm actions
  // Notifee may deliver alarms via different event types depending on Android version/manufacturer
  const isAlarmAction = notification?.data?.action === 'START_MONITORING' || 
                        notification?.data?.action === 'START_SILENCE' || 
                        notification?.data?.action === 'STOP_SILENCE';

  // Log ALL background events for debugging (helps identify what events are received)
  if (notification?.data?.action) {
      console.log(`[Background] Event received: type=${type}, action=${notification.data.action}`);
  }

  // CRITICAL FIX: Accept multiple event types for alarm delivery
  // EventType.DELIVERED (1) - Standard delivery
  // EventType.TRIGGER_NOTIFICATION_CREATED (7) - Alarm trigger created
  // EventType.PRESS (2) - User pressed notification (could also trigger alarm handling)
  const isRelevantEvent = type === EventType.DELIVERED || 
                          type === EventType.TRIGGER_NOTIFICATION_CREATED ||
                          (type === EventType.PRESS && isAlarmAction);

  if (isRelevantEvent && isAlarmAction) {
      const alarmType = notification.data.action;
      const placeId = notification.data?.placeId || 'unknown';
      
      console.log(`[Background] ⏰ Alarm received: ${alarmType} for place ${placeId}, eventType=${type}`);
      
      let realm = null;
      
      try {
          // Step 1: Open Realm
          console.log('[Background] Step 1: Opening Realm...');
          realm = await getRealm();
          console.log('[Background] ✅ Realm opened successfully');
          
          // Step 2: Initialize LocationService
          console.log('[Background] Step 2: Initializing LocationService...');
          await locationService.initialize(realm);
          console.log('[Background] ✅ LocationService initialized');
          
          // Step 3: Handle the alarm
          console.log('[Background] Step 3: Handling alarm...');
          await locationService.handleAlarmFired({
              notification: {
                  id: notification.id,
                  data: notification.data,
              },
          });
          console.log('[Background] ✅ Alarm handled successfully');
          
      } catch (err) {
          console.error('[Background] ❌ CRITICAL FAILURE:', err);
          console.error('[Background] Error stack:', err.stack);
          
          // Notify user of failure so they know to open the app
          await showBackgroundErrorNotification(
              `Failed to activate ${alarmType}. Please open Silent Zone to ensure your phone silences correctly.`
          );
      }
  }

  // Handle user pressing notification (separate from alarm handling)
  if (type === EventType.PRESS && pressAction?.id === 'default') {
    console.log('[Background] User pressed notification', notification?.id);
  }
});

// Register background handler for Geofencing (Headless JS)
AppRegistry.registerHeadlessTask('GeofenceTask', () => async (taskData) => {
  console.log('[Headless] 🌎 Geofence event received:', taskData);
  
  try {
    const realm = await getRealm();
    await locationService.initialize(realm);
    
    // The library passes { event: 'ENTER'|'EXIT', ids: ['place-id'] }
    if (taskData.event === 'ENTER') {
      for (const id of taskData.ids) {
        await locationService.handleGeofenceEntry(id);
      }
    } else if (taskData.event === 'EXIT') {
      for (const id of taskData.ids) {
        await locationService.handleGeofenceExit(id);
      }
    }
  } catch (error) {
    console.error('[Headless] Failed to process geofence event:', error);
  }
});

// Register foreground service (Required for Android 14+)
notifee.registerForegroundService((notification) => {
  return new Promise(() => {
    // Long running task - keep service alive
    // This promise never resolves to keep the foreground service running
    console.log('[ForegroundService] Service started and running');
  });
});

// Register headless task for boot rescheduling
AppRegistry.registerHeadlessTask('BootRescheduleTask', () => async (taskData) => {
  console.log('[BootReschedule] Device rebooted - Rescheduling alarms...', taskData);
  
  try {
    // Open Realm
    const realm = await getRealm();
    
    // Initialize LocationService which will restore state and reschedule alarms
    await locationService.initialize(realm);
    
    console.log('[BootReschedule] ✅ Alarms rescheduled successfully after reboot');
    
    // Show notification to user
    await notifee.displayNotification({
      id: 'boot-reschedule-complete',
      title: 'Silent Zone',
      body: 'Monitoring resumed after device restart',
      android: {
        channelId: 'alerts',
        smallIcon: 'ic_launcher',
        color: '#8B5CF6',
        autoCancel: true,
      },
    });
  } catch (error) {
    console.error('[BootReschedule] ❌ Failed to reschedule alarms:', error);
    
    // Notify user of failure
    await notifee.displayNotification({
      id: 'boot-reschedule-error',
      title: '⚠️ Silent Zone',
      body: 'Failed to resume monitoring after restart. Please open the app.',
      android: {
        channelId: 'background-errors',
        smallIcon: 'ic_launcher',
        color: '#FF6B6B',
      },
    });
  }
});

AppRegistry.registerComponent(appName, () => App);
