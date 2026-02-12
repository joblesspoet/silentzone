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

  // Persist references to Realm Results to prevent garbage collection of listeners
  private placeResults: Realm.Results<any> | null = null;
  private preferenceResults: Realm.Results<any> | null = null;
  private checkinResults: Realm.Results<any> | null = null;

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
      // 1. Core Realm Setup
      Logger.info('[LocationService] Engine initialization started...');
      this.realm = realmInstance;
      
      try {
        silentZoneManager.setRealm(realmInstance);
      } catch (e) {
        Logger.error('[LocationService] Failed to set realm on manager:', e);
      }
      
      // 2. Platform Channels (Non-fatal)
      if (Platform.OS === 'android') {
        try {
            Logger.info('[LocationService] Ensuring notification channels...');
            await notificationManager.createNotificationChannels();
        } catch (e) {
            Logger.error('[LocationService] Channel creation failed (continuing):', e);
        }
      }

      // 3. Initial Seed (Non-fatal)
      try {
        Logger.info('[LocationService] Syncing geofences for initial seed...');
        await this.syncGeofences();
      } catch (e) {
        Logger.error('[LocationService] Initial seed failed (continuing):', e);
      }
      
      this.isReady = true;
      
      // 4. Listeners
      try {
         this.setupReactiveSync();
      } catch (e) {
         Logger.error('[LocationService] Reactive sync setup failed:', e);
      }
      
      
      Logger.info('[LocationService] Engine Initialized Successfully ✅');
    } catch (error) {
      // Catch-all for unexpected failures (e.g. Realm access)
      console.error('[LocationService] CRITICAL INITIALIZATION FAILURE:', error);
      // We do NOT re-throw, to allow the UI to populate even if background engine fails
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Emergency cleanup called during JS crashes to restore phone state
   */
  async cleanupOnCrash() {
    try {
      console.log('[LocationService] EMERGENCY CLEANUP INITIATED');
      if (this.realm && !this.realm.isClosed) {
        silentZoneManager.setRealm(this.realm);
        CheckInService.closeAllCheckIns(this.realm);
      }
      
      const { silentZoneManager: manager } = require('./SilentZoneManager');
      manager.setRealm(this.realm);
      
      const { notificationManager: nm } = require('./NotificationManager');
      await nm.stopForegroundService();
    } catch (e) {
      console.error('[LocationService] Emergency cleanup failed', e);
    }
  }

  /**
   * Non-destructive initialization for background events.
   * Used when the app is woken up by the OS to handle an event.
   * 
   * @param realmInstance The active Realm database instance
   */
  async initializeLight(realmInstance: Realm) {
    if (this.isInitializing || (this.isReady && this.realm === realmInstance)) return;
    this.realm = realmInstance;
    silentZoneManager.setRealm(realmInstance);
    this.isReady = true;
  }

  /**
   * Main Sync: Ensures the "First Link" in the chain is set for all places.
   * Can be used for a global reset or for specific updated places.
   * 
   * @param forceAlarmSync Force a full re-schedule of all alarms
   * @param specificPlaceIds Optional list of IDs to sync specifically
   */
  async syncGeofences(forceAlarmSync: boolean = false, specificPlaceIds?: string[]) {
    if (!this.realm || this.realm.isClosed) return;
    
    // Concurrency guard: Prevent multiple overlapping syncs
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
      
      // Cleanup: If specific IDs are provided, ensure those that are now disabled have their alarms purged
      if (specificPlaceIds) {
        for (const id of specificPlaceIds) {
          const isStillEnabled = enabledPlaces.some(p => (p as any).id === id);
          if (!isStillEnabled) {
            Logger.info(`[LocationService] Place ${id} disabled or removed, purging alarms...`);
            await alarmService.cancelAlarmsForPlace(id);
          }
        }
      }

      for (const place of enabledPlaces) {
        // If specific IDs are provided, only sync those
        if (specificPlaceIds && !specificPlaceIds.includes((place as any).id)) {
          continue;
        }
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

    // 1. Find the first START trigger that is still in the FUTURE
    // triggerTime = startTime - (15 or 10 minutes)
    const nextTriggerableStart = upcomingSchedules.find(s => {
      const triggerTime = s.startTime.getTime() - (CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000);
      // We use a 1-minute buffer to avoid scheduling an alarm for "right now"
      return triggerTime > Date.now() + 60000;
    });

    if (nextTriggerableStart) {
      const triggerTime = nextTriggerableStart.startTime.getTime() - (CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000);
      await alarmService.scheduleNativeAlarm(startId, triggerTime, place.id, ALARM_ACTIONS.START_SILENCE);
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

    this.geofencesActive = true;
    await gpsManager.startWatching(
      (loc) => this.processLocationUpdate(loc),
      (err) => Logger.error('[GPS] Error:', err)
    );
    
    // Sync native geofences as a secondary layer
    await this.syncNativeGeofences();
    await this.updateForegroundService();
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
    const activeLogs = Array.from(CheckInService.getActiveCheckIns(this.realm));
    for (const log of activeLogs) {
      const placeId = log.placeId as string;
      if (!insideIds.includes(placeId)) {
        // Double check distance with hysteresis
        const place = PlaceService.getPlaceById(this.realm, placeId);
        if (place) {
          const distance = LocationValidator.calculateDistance(
            location.latitude, location.longitude, (place as any).latitude, (place as any).longitude
          );
          if (distance > (place as any).radius + 20) {
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

    // Allow activation 1 minute early for smooth flow
    if (schedule && now >= schedule.startTime.getTime() - 60000 && now < schedule.endTime.getTime()) {
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
   * Sets up reactive listeners on the Realm database.
   * Automatically triggers syncs or UI updates when data changes (CRUD operations).
   */
  private setupReactiveSync() {
    if (!this.realm || this.placeResults) return;
    
    //// 1. Places Listener
    //this.placeResults = this.realm.objects('Place');
    //this.placeResults.addListener(() => {
    //  if (!this.isReady) return;
    //  Logger.info('[LocationService] Places changed, re-syncing...');
    //  this.syncGeofences().catch(err => {
    //    Logger.error('[LocationService] Places reactive sync failed:', err);
    //  });
    //});

    //// 2. Preferences Listener
    //this.preferenceResults = this.realm.objects('Preferences');
    //this.preferenceResults.addListener(() => {
    //  if (!this.isReady) return;
    //  Logger.info('[LocationService] Preferences changed, re-syncing...');
    //  this.syncGeofences().catch(err => {
    //    Logger.error('[LocationService] Preferences reactive sync failed:', err);
    //  });
    //});

    //// 3. Check-in Logs Listener
    //this.checkinResults = this.realm.objects('CheckInLog');
    //this.checkinResults.addListener(() => {
    //  if (!this.isReady) return;
    //  this.updateForegroundService().catch(err => {
    //    Logger.error('[LocationService] Foreground service update failed:', err);
    //  });
    //});
  }

  /**
   * Public API: Force a location check immediately.
   * Useful for UI buttons or after manual place updates.
   */
  async forceLocationCheck(): Promise<void> {
    return gpsManager.forceLocationCheck(
      (location) => this.processLocationUpdate(location),
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