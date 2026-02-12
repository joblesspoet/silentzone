/**
 * Silent Zone - Background Entry Point
 * 
 * This file handles OS-level events (Alarms, Geofences, Boot) and dispatches 
 * them to the appropriate services. It mirrors the Android 'BroadcastReceiver' pattern.
 */

import { AppRegistry } from 'react-native';
import notifee, { EventType } from '@notifee/react-native';
import App from './App';
import { name as appName } from './app.json';
import { crashHandler } from './src/utils/CrashHandler';

// Initialize safety net
crashHandler.initialize();

const { locationService } = require('./src/services/LocationService');
const { Logger } = require('./src/services/Logger');
const { SettingsService } = require('./src/services/SettingsService');

// ============================================================================
// STATE: Event Deduplication
// ============================================================================

/**
 * Tracks recently processed alarms to prevent double-execution 
 * if Android re-delivers an intent during high system load.
 */
const processedAlarms = new Set();
const DEBOUNCE_TIME = 30000; // 30 seconds is enough for immediate re-delivery

const isDuplicate = (id) => {
  if (processedAlarms.has(id)) return true;
  processedAlarms.add(id);
  // Cleanup after a delay
  setTimeout(() => processedAlarms.delete(id), DEBOUNCE_TIME);
  return false;
};

// ============================================================================
// DATABASE: Realm Singleton Management
// ============================================================================

let cachedRealm = null;

/**
 * Ensures we only have one Realm instance active in the background process.
 */
const getRealm = async () => {
    if (cachedRealm && !cachedRealm.isClosed) return cachedRealm;
    
    const Realm = require('realm');
    const { schemas, SCHEMA_VERSION } = require('./src/database/schemas');
    const realm = await Realm.open({
        schema: schemas,
        schemaVersion: SCHEMA_VERSION,
    });
    
    // Wire up services with the active realm instance
    Logger.setRealm(realm);
    const loggingEnabled = await SettingsService.getLoggingEnabled();
    Logger.setEnabled(loggingEnabled);

    cachedRealm = realm;
    return realm;
};

// ============================================================================
// HANDLER: Alarm Events
// ============================================================================

/**
 * Global handler for trigger notifications fired by AlarmService.
 */
const handleAlarmEvent = async ({ type, detail }) => {
  const { notification } = detail;

  // We only care about our internal trigger alarms
  const isAlarmAction = notification?.data?.action && notification?.id?.startsWith('place-');
  
  if (type === EventType.TRIGGER_NOTIFICATION_CREATED || !isAlarmAction) return;

  const alarmId = notification.id;
  if (isDuplicate(alarmId)) {
    console.log(`[Dispatcher] Skipping duplicate: ${alarmId}`);
    return;
  }

  try {
      console.log(`[Dispatcher] ⏰ TRIGGERED: ${notification.data.action} for ${alarmId}`);
      
      const realm = await getRealm();
      
      // Pass the event directly to the LocationService (The Brain)
      await locationService.initializeLight(realm);
      await locationService.handleAlarmFired({
          notification: { id: alarmId, data: notification.data },
      });
      
      console.log(`[Dispatcher] ✅ Handled: ${alarmId}`);
  } catch (err) {
      console.error(`[Dispatcher] ❌ Error handling ${alarmId}:`, err);
  }
};

// Register Notifee listeners
notifee.onBackgroundEvent(handleAlarmEvent);
notifee.onForegroundEvent(handleAlarmEvent);

// ============================================================================
// HANDLER: Geofence Events (Native Android API)
// ============================================================================

AppRegistry.registerHeadlessTask('GeofenceTask', () => async (taskData) => {
  console.log('[Dispatcher] 🌎 Geofence Event:', taskData.event, taskData.ids);
  
  try {
    const realm = await getRealm();
    await locationService.initialize(realm);
    
    // Handle entries and exits
    if (taskData.event === 'ENTER') {
      for (const id of taskData.ids) await locationService.handleGeofenceEntry(id);
    } else if (taskData.event === 'EXIT') {
      for (const id of taskData.ids) await locationService.handleGeofenceExit(id);
    }
  } catch (error) {
    console.error('[Dispatcher] Geofence Failure:', error);
  }
});

// ============================================================================
// HANDLER: Boot / Restart
// ============================================================================

AppRegistry.registerHeadlessTask('BootRescheduleTask', () => async () => {
  console.log('[Dispatcher] 🔄 System Rebooted. Restoring engine...');
  
  try {
    const realm = await getRealm();
    const { notificationManager } = require('./src/services/NotificationManager');
    
    await locationService.initialize(realm);
    await locationService.syncGeofences(); // Re-seed the initial 'Next' alarms
    
    await notificationManager.showResumedAlert();
    console.log('[Dispatcher] ✅ Engine Resumed');
  } catch (error) {
    console.error('[Dispatcher] Boot Restore Failed:', error);
  }
});

// ============================================================================
// SERVICE: Sticky Foreground Task
// ============================================================================

notifee.registerForegroundService(() => {
  return new Promise(() => {
    console.log('[Dispatcher] 🚀 Sticky service keeping process alive');
  });
});

AppRegistry.registerComponent(appName, () => App);