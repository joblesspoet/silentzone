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

  // 1. EXTRACT ACTION FROM ID (If missing from data)
  // This must happen BEFORE the isAlarmAction check
  const isTriggerNotification = notification?.id?.includes('place-') && 
                                 (notification?.id?.includes('-type-monitor') || 
                                  notification?.id?.includes('-type-start') || 
                                  notification?.id?.includes('-type-end'));
  
  if (isTriggerNotification && (!notification?.data?.action) && notification?.id) {
      const idParts = notification.id.split('-');
      const typeIndex = idParts.indexOf('type');
      if (typeIndex !== -1 && idParts[typeIndex + 1]) {
          const actionType = idParts[typeIndex + 1];
          const data = notification.data || {};
          if (actionType === 'monitor') notification.data = { ...data, action: 'START_MONITORING' };
          if (actionType === 'start') notification.data = { ...data, action: 'START_SILENCE' };
          if (actionType === 'end') notification.data = { ...data, action: 'STOP_SILENCE' };
          console.log(`[Background] 🧩 Extracted action from ID: ${notification.data.action}`);
      }
  }

  // 2. QUICK CHECKS
  const isAlarmAction = notification?.data?.action === 'START_MONITORING' || 
                        notification?.data?.action === 'START_SILENCE' || 
                        notification?.data?.action === 'STOP_SILENCE';

  // Log raw events for debugging
  console.log(`[Background] Event: type=${type}, id=${notification?.id || 'none'}, action=${notification?.data?.action || 'none'}`);

  // 3. FILTER RELEVANT EVENTS
  // Skip creation events (Type 7) to avoid redundant processing logic
  if (type === EventType.TRIGGER_NOTIFICATION_CREATED) {
    return;
  }

  // Only proceed if this is an explicit alarm action we handle
  if (!isAlarmAction) {
    return;
  }

  // Final check after extraction
  const alarmType = notification.data.action;
  const placeId = notification.data?.placeId || 'unknown';
  const alarmId = notification.id || `fallback-${placeId}-${alarmType}`;

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

      // STEP 5: Initialize LocationService (LIGHT initialization for background)
      console.log('[Background] Initializing LocationService (Light)...');
      await locationService.initializeLight(realm);
      console.log('[Background] ✅ LocationService ready (Targeted context)');

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
              await locationService.initializeLight(realm);
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

/**
 * Register foreground service task.
 * The promise returned must remain PENDING to keep the native service alive.
 */
notifee.registerForegroundService((notification) => {
  return new Promise((resolve) => {
    console.log(`[ForegroundService] Service task started (id=${notification.id})`);
    // Default - let it resolve to avoid sticking if not needed
    resolve();
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