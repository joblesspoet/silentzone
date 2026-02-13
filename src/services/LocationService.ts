import Geofencing from '@rn-org/react-native-geofencing';
import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import { Preferences, PreferencesService } from '../database/services/PreferencesService';
import { CheckInService } from '../database/services/CheckInService';
import { Platform } from 'react-native';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { Logger } from './Logger';
import { ScheduleManager, UpcomingSchedule } from './ScheduleManager';
import { LocationValidator } from './LocationValidator';
import { alarmService, ALARM_ACTIONS } from './AlarmService';
import { notificationManager } from './NotificationManager';
import { CONFIG } from '../config/config';
import { GPSManager, gpsManager } from './GPSManager';
import { SilentZoneManager, silentZoneManager } from './SilentZoneManager';

/**
 * LocationService - The "Brain" of Silent Zone.
 * 
 * Implements a "Self-Perpetuating Chain" logic (Native Alarm Style).
 * Each alarm trigger performs its task and immediately schedules the NEXT one.
 */
class LocationService {
  private realm: Realm | null = null;
  private isReady = false;
  private isInitializing = false;
  private isSyncing = false;
  private geofencesActive = false;
  private lastTriggerTime: { [key: string]: number } = {};

  /**
   * Initialize the service with the active database instance.
   * Restores the engine state and seeds initial alarms.
   * 
   * @param realmInstance The active Realm database instance
   */
  async initialize(realmInstance: Realm) {
    if (this.isReady && this.realm === realmInstance) return;
    if (this.isInitializing) return;

    this.isInitializing = true;
    
    try {
      console.log('[LocationService] Engine initialization started...');
      this.realm = realmInstance;
      
      try {
        silentZoneManager.setRealm(realmInstance);
      } catch (e) {
        Logger.error('[LocationService] Failed to set realm on manager:', e);
      }
      
      if (Platform.OS === 'android') {
        try {
            await notificationManager.createNotificationChannels();
        } catch (e) {
            Logger.error('[LocationService] Channel creation failed:', e);
        }
      }

      await this.syncGeofences();
      this.isReady = true;
      
      Logger.info('[LocationService] Engine Initialized Successfully ✅');
    } catch (error) {
      console.error('[LocationService] CRITICAL INITIALIZATION FAILURE:', error);
    } finally {
      this.isInitializing = false;
    }
  }

/**
 * Set the realm reference without triggering a full initialization.
 * Used during first-time onboarding when there are no places to sync yet.
 */
setRealmReference(realmInstance: Realm) {
  this.realm = realmInstance;
  try {
    silentZoneManager.setRealm(realmInstance);
  } catch (e) {
    Logger.error('[LocationService] Failed to set realm on manager:', e);
  }
  console.log('[LocationService] Realm reference set (deferred init).');
}

  /**
   * Emergency cleanup called during JS crashes to restore phone state
   */
  async cleanupOnCrash() {
    try {
      console.log('[LocationService] EMERGENCY CLEANUP INITIATED');

      // FIX #6: Set realm only once, via the top-level import (not a duplicate require).
      // Also guard against null before passing it in.
      if (this.realm && !this.realm.isClosed) {
        silentZoneManager.setRealm(this.realm);
        CheckInService.closeAllCheckIns(this.realm);
      }

      const { notificationManager: nm } = require('./NotificationManager');
      await nm.stopForegroundService();
    } catch (e) {
      console.error('[LocationService] Emergency cleanup failed', e);
    }
  }

  /**
   * Non-destructive initialization for background events.
   * Validates Realm is open and not closed before proceeding.
   */
  async initializeLight(realmInstance: Realm) {
    // FIX #3: Guard the spin-wait with a 5-second timeout so we can never
    // loop forever if isInitializing gets stuck (e.g. after a hard process kill).
    if (this.isInitializing) {
      const MAX_WAIT_MS = 5000;
      const start = Date.now();
      while (this.isInitializing) {
        if (Date.now() - start > MAX_WAIT_MS) {
          Logger.warn('[LocationService] initializeLight timed out waiting for init — forcing clear');
          this.isInitializing = false;
          break;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 100));
      }
    }

    if (this.realm && !this.realm.isClosed) {
      this.isReady = true;
      return;
    }

    if (!realmInstance || realmInstance.isClosed) {
      Logger.error('[LocationService] Cannot initialize task with closed Realm');
      return;
    }

    this.realm = realmInstance;

    try {
      silentZoneManager.setRealm(realmInstance);
      this.setupReactiveSync(); // ✅ Restore autonomous monitoring
    } catch (e) {
      Logger.warn('[LocationService] Manager setup failed:', e);
    }

    this.isReady = true;
  }

  /**
   * Main Sync: Ensures the "First Link" in the chain is set for all places.
   * Can be used for a global reset or for specific updated places.
   */
  async syncGeofences() {
    if (!this.realm || this.realm.isClosed) return;
    
    // Concurrency guard: Prevent multiple overlapping syncs (especially from listeners + manual calls)
    if (this.isSyncing) {
      Logger.info('[LocationService] Sync already in progress, skipping...');
      return;
    }

    this.isSyncing = true;
    try {
      const prefs = PreferencesService.getPreferences(this.realm);
      const trackingEnabled = prefs?.trackingEnabled ?? true;

      // Handle Global Disable
      if (!trackingEnabled) {
        Logger.info('[LocationService] Tracking disabled. Cleaning up.');
        await this.purgeAllAlarms();
        await this.stopMonitoring();
        return;
      }

      const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
      Logger.info(`[LocationService] Syncing ${enabledPlaces.length} enabled places...`);

      for (const place of enabledPlaces) {
        await this.seedNextAlarmForPlace(place);
      }

      await this.refreshMonitoringState();
    } catch (error) {
      Logger.error('[LocationService] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Set up autonomous observation of the database.
   * This is what made the "Earlier Build" feel so robust.
   */
  private setupReactiveSync() {
    if (!this.realm || this.realm.isClosed) return;

    try {
      // 1. Watch Places
      const places = this.realm.objects('Place');
      places.addListener((collection, changes) => {
        if (changes.insertions.length > 0 || changes.deletions.length > 0 || changes.newModifications.length > 0) {
          Logger.info('[LocationService] Reactive: Places modified, resyncing...');
          this.syncGeofences().catch(e => Logger.error('[LocationService] Reactive sync failed:', e));
        }
      });

      // 2. Watch Preferences (specifically trackingEnabled)
      const prefs = this.realm.objects('Preferences');
      prefs.addListener((collection, changes) => {
        if (changes.newModifications.length > 0) {
          Logger.info('[LocationService] Reactive: Preferences modified, resyncing...');
          this.syncGeofences().catch(e => Logger.error('[LocationService] Reactive sync failed:', e));
        }
      });

      Logger.info('[LocationService] Autonomous monitoring established ✅');
    } catch (error) {
      Logger.error('[LocationService] Failed to setup reactive sync:', error);
    }
  }

  /**
   * For a specific place, find the very next START and END alarms and set them.
   * This is the "Daisy Chain" engine.
   */
  private async seedNextAlarmForPlace(place: any) {
    const schedules = place.schedules || [];
    if (schedules.length === 0) return;

    // Get all upcoming schedule windows (Yesterday, Today, Tomorrow)
    const { upcomingSchedules } = ScheduleManager.categorizeBySchedule([place]);
    
    const startId = `place-${place.id}-start`;
    const endId = `place-${place.id}-end`;

    // 1. Find the first START trigger window
    const firstUpcoming = upcomingSchedules[0];
    if (firstUpcoming) {
      const startTime = firstUpcoming.startTime.getTime();
      const warmUpTime = startTime - (CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000);
      const lastChanceTime = startTime - 60000; // T-1 minute

      let finalTrigger: number | null = null;

      // Rule: If warmup is in future, use it. 
      // Else if last chance is in future, use that as backup.
      // Else if start is IMMINENT (less than 2 mins), schedule an ASAP alarm (now + 5s)
      // to bypass Android background service start restrictions.
      if (warmUpTime > Date.now() + 60000) {
        finalTrigger = warmUpTime;
        Logger.info(`[LocationService] Setting warmup alarm for ${place.name} at T-15`);
      } else if (lastChanceTime > Date.now() + 30000) {
        finalTrigger = lastChanceTime;
        Logger.info(`[LocationService] ${place.name} warmup passed, scheduling T-1 safety alarm`);
      } else if (startTime > Date.now() + 10000) {
        finalTrigger = Date.now() + 5000;
        Logger.info(`[LocationService] ${place.name} start imminent, scheduling immediate (T+5s) backup alarm`);
      }

      if (finalTrigger) {
        await alarmService.scheduleNativeAlarm(startId, finalTrigger, place.id, ALARM_ACTIONS.START_SILENCE);
      }
    }

    // 2. Find the first END trigger that is still in the FUTURE
    const nextTriggerableEnd = upcomingSchedules.find(s => {
      return s.endTime.getTime() > Date.now() + 60000;
    });

    if (nextTriggerableEnd) {
      const triggerEnd = nextTriggerableEnd.endTime.getTime();
      await alarmService.scheduleNativeAlarm(endId, triggerEnd, place.id, ALARM_ACTIONS.STOP_SILENCE);
    }
  }

  /**
   * Core logic for when an OS alarm fires.
   * Performs Phase 1 (Immediate Reschedule) and Phase 2 (Execution).
   * 
   * @param data The background event data containing notification details
   */
  async handleAlarmFired(data: any) {
    const alarmId = data?.notification?.id;
    const action = data?.notification?.data?.action;
    const placeId = data?.notification?.data?.placeId;

    if (!this.realm || !placeId) return;

    Logger.info(`[Engine] ⚡ Fire: ${action} for ${placeId}`);

    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !place.isEnabled) return;

    try {
      // PHASE 1: Immediate Reschedule (DAISY CHAIN)
      // We don't wait for GPS. We secure the future first.
      await this.seedNextAlarmForPlace(place);

      // PHASE 2: Execute Action
      if (action === ALARM_ACTIONS.START_SILENCE) {
        await this.handleStartAction(place);
      } else if (action === ALARM_ACTIONS.STOP_SILENCE) {
        await this.handleStopAction(placeId);
      }
    } catch (error) {
      Logger.error(`[Engine] Action failed for ${placeId}:`, error);
    }
  }

  /**
   * Handles the 'START_SILENCE' action: Activates GPS and verifies location.
   * 
   * @param place The Place object to monitor
   */
  private async handleStartAction(place: any) {
    Logger.info(`[Engine] 📍 Starting monitoring for ${place.name}`);
    
    // 1. Activate Foreground Service & GPS
    await this.startMonitoring();
    
    // 2. Immediate check: Are we already there?
    const deadline = this.calculateDeadlineForPlace(place.id);
    await gpsManager.forceLocationCheck(
      (loc) => this.processLocationUpdate(loc),
      (err) => Logger.error('[GPS] Start check failed:', err),
      1, 2, deadline
    );
  }

  /**
   * Handles the 'STOP_SILENCE' action: Restores sound and refreshes monitoring.
   * 
   * @param placeId ID of the place to stop
   */
  private async handleStopAction(placeId: string) {
    Logger.info(`[Engine] 扫 Cleaning up for ${placeId}`);
    
    // 1. Restore sound if checked in
    await silentZoneManager.handleExit(placeId, true);
    
    // 2. Refresh monitoring state (Stop GPS if no other active zones)
    await this.refreshMonitoringState();
  }

  /**
   * Decides whether to keep the background service and GPS active
   * based on current active sessions and upcoming schedules.
   */
  private async refreshMonitoringState() {
    if (!this.realm) return;

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    const { activePlaces, upcomingSchedules } = ScheduleManager.categorizeBySchedule(enabledPlaces);

    Logger.info(`[LocationService] Refresh: active=${activePlaces.length}, upcoming=${upcomingSchedules.length}`);
    if (activePlaces.length > 0) {
      Logger.info(`[LocationService] Active zones: ${activePlaces.map(p => p.name).join(', ')}`);
    }

    const needsMonitoring = activePlaces.length > 0 || 
      (upcomingSchedules.length > 0 && upcomingSchedules[0].minutesUntilStart <= CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES);

    if (needsMonitoring) {
      Logger.info('[LocationService] Monitoring needs active. Starting service...');
      await this.startMonitoring();
      
      // PROACTIVE: If we have active zones, force an immediate check to catch entries
      // This is critical if the app starts while ALREADY inside a zone.
      if (activePlaces.length > 0) {
        Logger.info('[LocationService] Proactive check initiated for active zones');
        this.forceLocationCheck().catch(err => {
          Logger.error('[LocationService] Proactive check failed:', err);
        });
      }
    } else {
      Logger.info('[LocationService] No active or imminent zones. Stopping service.');
      await this.stopMonitoring();
    }
  }

  /**
   * Activates the foreground service, GPS watcher, and native geofences.
   */
  private async startMonitoring() {
    if (this.geofencesActive) return;
    
    const hasPerms = await PermissionsManager.hasCriticalPermissions();
    if (!hasPerms) {
      Logger.error('[Service] Cannot start: Missing permissions');
      return;
    }

    // For Android 14+, we must be extremely careful starting from transition
    if (Platform.OS === 'android' && Platform.Version >= 34) {
      const { AppState } = require('react-native');
      if (AppState.currentState !== 'active' && AppState.currentState !== 'unknown') {
        Logger.info('[Service] Starting foreground service from background (triggered by alarm/system)');
      }
    }

    this.geofencesActive = true;
    try {
      await gpsManager.startWatching(
        (loc) => {
          // FIX #4: The GPS callback fires frequently. Wrap in .catch() so any
          // throw inside processLocationUpdate (Realm conflict, null ref, etc.)
          // never becomes a fatal unhandled promise rejection.
          this.processLocationUpdate(loc).catch(err =>
            Logger.error('[GPS] processLocationUpdate unhandled error:', err)
          );
        },
        (err) => Logger.error('[GPS] Watcher error:', err)
      );
      
      // Sync native geofences as a secondary layer
      await this.syncNativeGeofences();
      await this.updateForegroundService();
    } catch (e) {
      Logger.error('[LocationService] Failed to start monitoring:', e);
      this.geofencesActive = false;
    }
  }

  /**
   * Deactivates all background monitoring components.
   */
  private async stopMonitoring() {
    this.geofencesActive = false;
    gpsManager.stopWatching();
    await Geofencing.removeAllGeofence();
    await notificationManager.stopForegroundService();
  }

  /**
   * Synchronizes the native Android geofences with our database's enabled places.
   */
  private async syncNativeGeofences() {
    if (!this.realm) return;
    await Geofencing.removeAllGeofence();
    
    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    for (const place of enabledPlaces) {
      await Geofencing.addGeofence({
        id: (place as any).id,
        latitude: (place as any).latitude,
        longitude: (place as any).longitude,
        radius: (place as any).radius + CONFIG.GEOFENCE_RADIUS_BUFFER
      });
    }
  }

  /**
   * Processes a GPS location update. Handles zone entries and exits.
   * 
   * @param location The GPS coordinates and accuracy data
   */
  private async processLocationUpdate(location: any) {
    if (!this.realm) return;

    // 1. Determine which zones we are INSIDE
    const insideIds = LocationValidator.determineInsidePlaces(location, this.realm);

    // 2. Handle Entries
    for (const id of insideIds) {
      if (!CheckInService.isPlaceActive(this.realm, id)) {
        await this.handleGeofenceEntry(id);
      }
    }

    // 3. Handle Exits for active zones
    // FIX #5: Use .snapshot() instead of Array.from() to get a stable copy
    // without the overhead of Array.from on every GPS tick. snapshot() is the
    // Realm-idiomatic way to get a frozen-in-time copy of a Results collection.
    const activeLogs = CheckInService.getActiveCheckIns(this.realm).snapshot();
    for (const log of activeLogs) {
      const placeId = log.placeId as string;
      if (!insideIds.includes(placeId)) {
        // Double check distance with hysteresis
        const place = PlaceService.getPlaceById(this.realm, placeId);
        if (place) {
          const isDefinitelyOutside = LocationValidator.isOutsidePlace(
            location, 
            place, 
            CONFIG.EXIT_HYSTERESIS_METERS || 20
          );

          if (isDefinitelyOutside) {
            await silentZoneManager.handleExit(placeId);
          }
        }
      }
    }
  }

  /**
   * Handles a geofence entry event (either from GPS manager or native geofence).
   * Verifies if the entry is within a valid schedule window before activating silence.
   * 
   * @param placeId ID of the place entered
   */
  async handleGeofenceEntry(placeId: string) {
    if (!this.realm) return;
    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !place.isEnabled) return;

    // Check if we are within the schedule window for this place
    const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
    const now = Date.now();
    
    Logger.info(`[LocationService] Verifying entry for ${place.name}: ` +
                `schedule=${schedule ? schedule.startTime.toLocaleTimeString() : 'None'}`);

    // Allow activation slightly early for smooth flow (e.g. 1 minute before)
    const startBuffer = 60 * 1000; 
    if (schedule && now >= schedule.startTime.getTime() - startBuffer && now < schedule.endTime.getTime()) {
      Logger.info(`[LocationService] Window matched for ${place.name}. Activating silence.`);
      await silentZoneManager.activateSilentZone(place);
      await this.updateForegroundService();
    } else {
      if (schedule) {
        Logger.info(`[LocationService] Window NOT matched for ${place.name}: now=${new Date(now).toLocaleTimeString()}, ` +
                    `start=${schedule.startTime.toLocaleTimeString()}, end=${schedule.endTime.toLocaleTimeString()}`);
      } else {
        Logger.info(`[LocationService] No upcoming schedule found for ${place.name}`);
      }
    }
  }

  /**
   * Handles a geofence exit event: Restores sound and updates status.
   * 
   * @param placeId ID of the place exited
   */
  async handleGeofenceExit(placeId: string) {
    await silentZoneManager.handleExit(placeId);
    await this.updateForegroundService();
  }

  /**
   * Updates the foreground service notification text and icon
   * based on the number of enabled places and active sessions.
   */
  private async updateForegroundService() {
    if (!this.realm) return;
    const enabledCount = PlaceService.getEnabledPlaces(this.realm).length;
    const activeCheckIns = Array.from(CheckInService.getActiveCheckIns(this.realm));
    const activeName = activeCheckIns.length > 0 
      ? (PlaceService.getPlaceById(this.realm, activeCheckIns[0].placeId as string) as any)?.name 
      : null;

    await notificationManager.startForegroundService(
      enabledCount,
      [], // upcoming not needed for status
      activeName,
      activeCheckIns.length > 0
    );
  }

  /**
   * Public API: Purges all scheduled alarms for all places.
   * Used for global cleanup when tracking is disabled or permissions revoked.
   */
  async purgeAllAlarms() {
    if (!this.realm || this.realm.isClosed) return;
    const all = Array.from(PlaceService.getAllPlaces(this.realm));
    for (const p of all) await alarmService.cancelAlarmsForPlace((p as any).id);
  }


  /**
   * Public API: Force a location check immediately.
   * Useful for UI buttons or after manual place updates.
   */
  async forceLocationCheck(): Promise<void> {
    return gpsManager.forceLocationCheck(
      (location) => {
        // FIX #4 (applied here too): always catch the async callback promise
        this.processLocationUpdate(location).catch(err =>
          Logger.error('[GPS] forceLocationCheck processLocationUpdate failed:', err)
        );
      },
      (error) => Logger.error('[GPS] Force check failed:', error),
      1, 3
    );
  }

  /**
   * Helper to find the end time of the current or next schedule for a place.
   * Used as a timeout for GPS monitoring.
   * 
   * @param placeId ID of the place
   * @returns Timestamp of the schedule end, or undefined
   */
  private calculateDeadlineForPlace(placeId: string): number | undefined {
    if (!this.realm) return undefined;
    const place = PlaceService.getPlaceById(this.realm, placeId);
    const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
    return schedule?.endTime.getTime();
  }
}

export const locationService = new LocationService();