/**
 * Silent Zone - Background Entry Point (Production Safe)
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

const processedAlarms = new Set();
const DEBOUNCE_TIME = 30000; // 30 seconds

const isDuplicate = (id) => {
  if (processedAlarms.has(id)) return true;
  processedAlarms.add(id);
  setTimeout(() => processedAlarms.delete(id), DEBOUNCE_TIME);
  return false;
};

// ============================================================================
// DATABASE: Realm Singleton Management (Isolated for Dispatcher)
// ============================================================================

let cachedRealm = null;

/**
 * Gets the Realm instance for background tasks.
 *
 * FIX #2: First tries to reuse the shared instance that RealmProvider already
 * opened. This prevents two separate Realm instances writing to the same file
 * simultaneously (which causes write-conflict crashes).
 * Falls back to opening its own instance only when running truly headless
 * (i.e. the UI context is not alive).
 */
const getRealm = async () => {
  // ── Priority 1: Reuse the UI realm if the app process is alive ──────────
  try {
    const { getSharedRealm } = require('./src/database/RealmProvider');
    const shared = getSharedRealm();
    if (shared && !shared.isClosed) {
      cachedRealm = shared;
      return cachedRealm;
    }
  } catch (_) {
    // Module not yet loaded (pure headless start) — fall through
  }

  // ── Priority 2: Reuse our own previously-opened background realm ─────────
  if (cachedRealm && !cachedRealm.isClosed) return cachedRealm;

  // ── Priority 3: Open a fresh realm (truly headless / no UI context) ──────
  const Realm = require('realm');
  const { schemas, SCHEMA_VERSION } = require('./src/database/schemas');

  try {
    console.log('[Dispatcher] Opening background Realm...');
    cachedRealm = await Realm.open({
      schema: schemas,
      schemaVersion: SCHEMA_VERSION,
      path: Realm.defaultPath,
    });

    // Wire up shared services
    Logger.setRealm(cachedRealm);
    const loggingEnabled = await SettingsService.getLoggingEnabled();
    Logger.setEnabled(loggingEnabled);

    return cachedRealm;
  } catch (error) {
    console.error('[Dispatcher] CRITICAL REALM FAILURE:', error);
    throw error;
  }
};

/**
 * Background tasks should ideally not close the Realm if the app is alive,
 * but specifically for Headless tasks, we often must cleanup if we are the only ones.
 */
const closeRealmIfPossible = () => {
  // We keep it open for the duration of the JS context in this simplified version
  // React Native will eventually kill the process/context
};

// ============================================================================
// HANDLER: Alarm Events (With Full Error Boundaries)
// ============================================================================

const handleAlarmEvent = async ({ type, detail }) => {
  const { notification } = detail;
  const isAlarmAction = notification?.data?.action && notification?.id?.startsWith('place-');
  
  // Normal trigger fired OR notification delivered (as foreground service)
  const isTargetEvent = type === EventType.DELIVERED || 
                       type === EventType.PRESS ||
                       type === EventType.ACTION_PRESS;

  if (!isTargetEvent || !isAlarmAction) return;

  const alarmId = notification.id;
  if (isDuplicate(alarmId)) return;

  try {
    console.log(`[Dispatcher] ⏰ Trigger: Type=${type} Action=${notification.data.action} ID=${alarmId}`);
    const realm = await getRealm();
    
    // Non-destructive init
    await locationService.initializeLight(realm);
    
    await locationService.handleAlarmFired({
      notification: { id: alarmId, data: notification.data },
    });
    console.log(`[Dispatcher] ✅ Trigger Handled: ${alarmId}`);
  } catch (err) {
    console.error(`[Dispatcher] ❌ Alarm Error (${alarmId}):`, err);
  }
};

// Register listeners
notifee.onBackgroundEvent(handleAlarmEvent);
notifee.onForegroundEvent(handleAlarmEvent);

// ============================================================================
// HANDLER: Geofence Events (Native Android API)
// ============================================================================

AppRegistry.registerHeadlessTask('GeofenceTask', () => async (taskData) => {
  console.log('[Dispatcher] 🌎 Geofence Event:', taskData.event, taskData.ids);
  
  try {
    const realm = await getRealm();
    await locationService.initializeLight(realm);
    
    if (taskData.event === 'ENTER') {
      for (const id of taskData.ids) {
        try { await locationService.handleGeofenceEntry(id); } catch (e) {}
      }
    } else if (taskData.event === 'EXIT') {
      for (const id of taskData.ids) {
        try { await locationService.handleGeofenceExit(id); } catch (e) {}
      }
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
    
    await locationService.initializeLight(realm);
    await locationService.refreshAllWatchers();
    
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