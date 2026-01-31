/**
 * @format
 * PRODUCTION VERSION - Handles alarm race conditions and deduplication
 */

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';
import { crashHandler } from './src/utils/CrashHandler';

// Initialize safety net
crashHandler.initialize();

const { locationService } = require('./src/services/LocationService');

// ============================================================================
// BUSINESS LOGIC: Alarm Processing State Management
// ============================================================================

/**
 * Tracks recently processed alarms to prevent duplicate processing
 * Key: alarmId, Value: timestamp when processed
 */
const processedAlarms = new Map();
const ALARM_DEBOUNCE_MS = 5000; // 5 seconds

/**
 * Tracks currently processing alarms to prevent concurrent processing
 */
const processingAlarms = new Set();

/**
 * Check if alarm was recently processed (deduplication)
 */
const wasRecentlyProcessed = (alarmId) => {
  const lastProcessed = processedAlarms.get(alarmId);
  if (!lastProcessed) return false;
  
  const timeSince = Date.now() - lastProcessed;
  return timeSince < ALARM_DEBOUNCE_MS;
};

/**
 * Check if alarm is currently being processed (concurrency control)
 */
const isCurrentlyProcessing = (alarmId) => {
  return processingAlarms.has(alarmId);
};

/**
 * Mark alarm as processed and cleanup old entries
 */
const markAlarmProcessed = (alarmId) => {
  processedAlarms.set(alarmId, Date.now());
  processingAlarms.delete(alarmId); // Remove from processing set
  
  // Cleanup old entries to prevent memory leak
  if (processedAlarms.size > 100) {
    const cutoff = Date.now() - ALARM_DEBOUNCE_MS * 2;
    for (const [id, timestamp] of processedAlarms.entries()) {
      if (timestamp < cutoff) {
        processedAlarms.delete(id);
      }
    }
  }
};

/**
 * Mark alarm as currently processing
 */
const markAlarmProcessing = (alarmId) => {
  processingAlarms.add(alarmId);
};

// ============================================================================
// BUSINESS LOGIC: Realm Instance Management
// ============================================================================

let cachedRealm = null;
let realmOpenPromise = null;

/**
 * Get Realm instance with caching to prevent multiple opens
 * Uses singleton pattern with promise caching
 */
const getRealm = async () => {
    // If we already have a cached instance, return it
    if (cachedRealm && !cachedRealm.isClosed) {
        console.log('[Realm] Using cached instance');
        return cachedRealm;
    }
    
    // If opening is in progress, wait for it
    if (realmOpenPromise) {
        console.log('[Realm] Waiting for in-progress open...');
        return await realmOpenPromise;
    }
    
    // Open new instance
    console.log('[Realm] Opening new instance...');
    realmOpenPromise = (async () => {
        const Realm = require('realm');
        const { schemas, SCHEMA_VERSION } = require('./src/database/schemas');
        const realm = await Realm.open({
            schema: schemas,
            schemaVersion: SCHEMA_VERSION,
        });
        cachedRealm = realm;
        realmOpenPromise = null;
        return realm;
    })();
    
    return await realmOpenPromise;
};

// ============================================================================
// BUSINESS LOGIC: Error Notification
// ============================================================================

const showBackgroundErrorNotification = async (errorMessage) => {
    try {
        await notifee.createChannel({
            id: 'background-errors',
            name: 'Background Service Errors',
            importance: 4,
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
                importance: 4,
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

// ============================================================================
// BUSINESS LOGIC: Alarm Event Handler
// ============================================================================

notifee.onBackgroundEvent(async ({ type, detail }) => {
  const { notification, pressAction } = detail;

  // Quick checks for alarm actions
  const isAlarmAction = notification?.data?.action === 'START_MONITORING' || 
                        notification?.data?.action === 'START_SILENCE' || 
                        notification?.data?.action === 'STOP_SILENCE';

  // Log raw events for debugging
  console.log(`[Background] Event: type=${type}, hasNotification=${!!notification}, action=${notification?.data?.action || 'none'}`);

  // Filter out irrelevant events early
  // CRITICAL: Only process DELIVERED and ACTION_PRESS to avoid duplicate processing
  const isRelevantEvent = type === EventType.DELIVERED || 
                          type === EventType.ACTION_PRESS;

  if (!isRelevantEvent || !isAlarmAction) {
    // Silently ignore (Type=7, PRESS without action, etc.)
    return;
  }

  // Extract alarm from ID if data.action is missing
  const isTriggerNotification = notification?.id?.includes('place-') && 
                                 (notification?.id?.includes('-type-monitor') || 
                                  notification?.id?.includes('-type-start') || 
                                  notification?.id?.includes('-type-end'));
  
  if (isTriggerNotification && !notification?.data?.action && notification?.id) {
      const idParts = notification.id.split('-');
      const typeIndex = idParts.indexOf('type');
      if (typeIndex !== -1 && idParts[typeIndex + 1]) {
          const actionType = idParts[typeIndex + 1];
          if (actionType === 'monitor') notification.data = { ...notification.data, action: 'START_MONITORING' };
          if (actionType === 'start') notification.data = { ...notification.data, action: 'START_SILENCE' };
          if (actionType === 'end') notification.data = { ...notification.data, action: 'STOP_SILENCE' };
          console.log(`[Background] Extracted action from ID: ${notification.data.action}`);
      }
  }

  // Final check after extraction
  const finalIsAlarmAction = notification?.data?.action === 'START_MONITORING' || 
                             notification?.data?.action === 'START_SILENCE' || 
                             notification?.data?.action === 'STOP_SILENCE';

  if (!finalIsAlarmAction) {
    return;
  }

  // ============================================================================
  // BUSINESS LOGIC: Process Alarm with Deduplication & Concurrency Control
  // ============================================================================

  const alarmId = notification.id || 'unknown';
  const alarmType = notification.data.action;
  const placeId = notification.data?.placeId || 'unknown';

  // STEP 1: Check if recently processed (deduplication)
  if (wasRecentlyProcessed(alarmId)) {
    console.log(`[Background] ⏭️ SKIPPED: Alarm ${alarmId} processed ${Math.round((Date.now() - processedAlarms.get(alarmId)) / 1000)}s ago`);
    return;
  }

  // STEP 2: Check if currently processing (concurrency control)
  if (isCurrentlyProcessing(alarmId)) {
    console.log(`[Background] ⏭️ SKIPPED: Alarm ${alarmId} already processing`);
    return;
  }

  // STEP 3: Mark as processing
  markAlarmProcessing(alarmId);
  console.log(`[Background] ⏰ PROCESSING: ${alarmType} for place ${placeId} (type=${type})`);

  let realm = null;

  try {
      // STEP 4: Get Realm (cached for performance)
      console.log('[Background] Opening Realm...');
      realm = await getRealm();
      console.log('[Background] ✅ Realm ready');

      // STEP 5: Initialize LocationService (will restore state & reschedule)
      console.log('[Background] Initializing LocationService...');
      await locationService.initialize(realm);
      console.log('[Background] ✅ LocationService initialized');

      // STEP 6: Handle the specific alarm
      console.log('[Background] Handling alarm...');
      await locationService.handleAlarmFired({
          notification: {
              id: notification.id,
              data: notification.data,
          },
      });
      console.log('[Background] ✅ Alarm handled successfully');

      // STEP 7: Mark as processed (deduplication + cleanup)
      markAlarmProcessed(alarmId);

  } catch (err) {
      console.error('[Background] ❌ FAILED:', err);
      console.error('[Background] Stack:', err.stack);

      // Mark as processed even on error to prevent retry loops
      markAlarmProcessed(alarmId);

      // Retry once on Realm errors
      if (err.message?.includes('Realm')) {
          console.log('[Background] Retrying after Realm error...');
          await new Promise(r => setTimeout(r, 2000));
          try {
              realm = await getRealm();
              await locationService.initialize(realm);
              await locationService.handleAlarmFired({
                notification: { id: notification.id, data: notification.data },
              });
              console.log('[Background] ✅ Retry successful');
          } catch (reErr) {
              console.error('[Background] ❌ Retry failed:', reErr);
              await showBackgroundErrorNotification(
                  `Failed to activate ${alarmType}. Please open Silent Zone.`
              );
          }
      } else {
          await showBackgroundErrorNotification(
              `Failed to activate ${alarmType}. Please open Silent Zone.`
          );
      }
  }
});

// ============================================================================
// Geofencing Handler
// ============================================================================

AppRegistry.registerHeadlessTask('GeofenceTask', () => async (taskData) => {
  console.log('[Headless] 🌎 Geofence event:', taskData);
  
  try {
    const realm = await getRealm();
    await locationService.initialize(realm);
    
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
    console.error('[Headless] Failed:', error);
  }
});

// ============================================================================
// Foreground Service
// ============================================================================

notifee.registerForegroundService((notification) => {
  return new Promise(() => {
    console.log('[ForegroundService] Running');
  });
});

// ============================================================================
// Boot Handler
// ============================================================================

AppRegistry.registerHeadlessTask('BootRescheduleTask', () => async (taskData) => {
  console.log('[BootReschedule] Device rebooted...');
  
  try {
    const realm = await getRealm();
    await locationService.initialize(realm);
    console.log('[BootReschedule] ✅ Alarms rescheduled');
    
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
    console.error('[BootReschedule] ❌ Failed:', error);
    
    await notifee.displayNotification({
      id: 'boot-reschedule-error',
      title: '⚠️ Silent Zone',
      body: 'Failed to resume. Please open the app.',
      android: {
        channelId: 'background-errors',
        smallIcon: 'ic_launcher',
        color: '#FF6B6B',
      },
    });
  }
});

AppRegistry.registerComponent(appName, () => App);