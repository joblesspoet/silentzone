import Geofencing from '@rn-org/react-native-geofencing';
import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import {
  Preferences,
  PreferencesService,
} from '../database/services/PreferencesService';
import { CheckInService } from '../database/services/CheckInService';
import { Platform } from 'react-native';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { Logger } from './Logger';
import { ScheduleManager, UpcomingSchedule } from './ScheduleManager';
import { LocationValidator } from './LocationValidator';
import { ALARM_ACTIONS } from './AlarmService';
import { PersistentAlarmService } from './PersistentAlarmService';
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
  private geofencesActive = false;
  private lastTriggerTime: { [key: string]: number } = {};

  /**
   * Initialize the service with the active database instance.
   * Restores the engine state and seeds initial alarms.
   *
   * @param realmInstance The active Realm database instance
   */
  async initialize(realmInstance: Realm) {
    if (!realmInstance || realmInstance.isClosed) {
      Logger.warn(
        '[LocationService] Cannot initialize with null or closed Realm',
      );
      return;
    }

    if (this.isReady && this.realm === realmInstance) {
      console.log(
        '[LocationService] Already initialized and Realm instance matches.',
      );
      return;
    }

    if (this.isInitializing) {
      console.log(
        '[LocationService] Initialization already in progress, skipping redundant call.',
      );
      return;
    }

    this.isInitializing = true;

    try {
      console.log('[LocationService] Engine initialization started...');
      this.realm = realmInstance;

      // Ensure manager has the realm immediately
      silentZoneManager.setRealm(realmInstance);

      if (Platform.OS === 'android') {
        Logger.info('[LocationService] Setting up notification channels...');
        await notificationManager.createNotificationChannels();
      }

      const placesCount = PlaceService.getPlacesCount(realmInstance as any);
      if (placesCount === 0) {
        Logger.info(
          '[LocationService] No places found. Skipping watcher refresh during onboarding.',
        );
        this.isReady = true;
        return;
      }

      // Initial sanity check: Clear any STUCK sessions (past end time)
      await this.checkSessionExpiry();

      // Initial boot sync
      Logger.info('[LocationService] Performing initial dependency sync...');
      await this.refreshAllWatchers();

      this.isReady = true;
      Logger.info('[LocationService] Engine Initialized Successfully ✅');
    } catch (error) {
      this.isReady = false;
      console.error(
        '[LocationService] CRITICAL INITIALIZATION FAILURE:',
        error,
      );
      Logger.error('[LocationService] Init failed:', error);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Public check: Is the engine currently in the middle of initializing?
   * Used by PermissionsContext to avoid duplicate concurrent init calls.
   */
  isCurrentlyInitializing(): boolean {
    return this.isInitializing;
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
    if (this.isInitializing) {
      const MAX_WAIT_MS = 5000;
      const start = Date.now();
      while (this.isInitializing) {
        if (Date.now() - start > MAX_WAIT_MS) {
          Logger.warn(
            '[LocationService] initializeLight timed out waiting for init — forcing clear',
          );
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
      Logger.error(
        '[LocationService] Cannot initialize light with closed Realm',
      );
      return;
    }

    this.realm = realmInstance;
    try {
      silentZoneManager.setRealm(realmInstance);
    } catch (e) {
      Logger.warn('[LocationService] Manager setup failed:', e);
    }
    this.isReady = true;
  }

  /**
   * EVENT HANDLER: Place Added
   */
  async onPlaceAdded(place: any) {
    if (!this.realm || this.realm.isClosed) return;
    if (place.isValid && !place.isValid()) return;
    Logger.info(`[Event] Place Added: ${place.name}`);
    await this.seedNextAlarmForPlace(place);
    await this.refreshMonitoringState();
  }

  /**
   * EVENT HANDLER: Place Updated
   */
  async onPlaceUpdated(place: any) {
    if (!this.realm || this.realm.isClosed) return;
    if (place.isValid && !place.isValid()) return;
    Logger.info(`[Event] Place Updated: ${place.name}`);

    // 1. Always cancel existing alarms first (in case schedules were removed)
    await PersistentAlarmService.cancelAlarm(`place-${place.id}-start`);
    await PersistentAlarmService.cancelAlarm(`place-${place.id}-end`);

    // 2. Seed new alarms if applicable
    await this.seedNextAlarmForPlace(place);

    await this.refreshMonitoringState();
  }

  /**
   * EVENT HANDLER: Place Deleted
   */
  async onPlaceDeleted(placeId: string) {
    if (!this.realm || this.realm.isClosed) return;
    Logger.info(`[Event] Place Deleted: ${placeId}`);
    await PersistentAlarmService.cancelAlarm(`place-${placeId}-start`);
    await PersistentAlarmService.cancelAlarm(`place-${placeId}-end`);
    await this.refreshMonitoringState();
  }

  /**
   * EVENT HANDLER: Place Toggled
   */
  async onPlaceToggled(placeId: string, isEnabled: boolean) {
    if (!this.realm || this.realm.isClosed) return;
    Logger.info(`[Event] Place Toggled: ${placeId} -> ${isEnabled}`);

    if (isEnabled) {
      const place = PlaceService.getPlaceById(this.realm, placeId);
      if (place) await this.seedNextAlarmForPlace(place);
    } else {
      await PersistentAlarmService.cancelAlarm(`place-${placeId}-start`);
      await PersistentAlarmService.cancelAlarm(`place-${placeId}-end`);
      // If we were inside, handle exit
      if (CheckInService.isPlaceActive(this.realm, placeId)) {
        await silentZoneManager.handleExit(placeId);
      }
    }
    await this.refreshMonitoringState();
  }

  /**
   * EVENT HANDLER: Global Tracking Toggled
   */
  async onGlobalTrackingChanged(enabled: boolean) {
    if (!this.realm || this.realm.isClosed) return;
    Logger.info(`[Event] Global Tracking Changed -> ${enabled}`);

    if (!enabled) {
      await this.purgeAllAlarms();
      await this.stopMonitoring();
    } else {
      await this.refreshAllWatchers();
    }
  }

  /**
   * Refreshes all alarms and monitoring state from scratch.
   * Used ONLY during initial boot or global resume.
   */
  async refreshAllWatchers() {
    if (!this.realm || this.realm.isClosed) return;

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

      const enabledPlaces = Array.from(
        PlaceService.getEnabledPlaces(this.realm),
      );
      Logger.info(
        `[LocationService] Refreshing ${enabledPlaces.length} enabled places...`,
      );

      for (const place of enabledPlaces) {
        await this.seedNextAlarmForPlace(place);
      }

      await this.refreshMonitoringState();
    } catch (error) {
      Logger.error('[LocationService] Refresh failed:', error);
    }
  }

  /**
   * For a specific place, find the very next START and END alarms and set them.
   * This is the "Daisy Chain" engine.
   */
  private async seedNextAlarmForPlace(placeData: any) {
    if (!this.realm || this.realm.isClosed) return;
    if (placeData.isValid && !placeData.isValid()) return;

    // RE-FETCH: Always use a fresh reference in the current thread/context
    const place = PlaceService.getPlaceById(this.realm, placeData.id) as any;
    if (!place) return;

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
      const warmUpTime =
        startTime - CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000;
      const lastChanceTime = startTime - 60000; // T-1 minute

      let finalTrigger: number | null = null;

      if (warmUpTime > Date.now() + 60000) {
        finalTrigger = warmUpTime;
      } else if (lastChanceTime > Date.now() + 10000) {
        finalTrigger = lastChanceTime;
      }

      if (finalTrigger) {
        await PersistentAlarmService.scheduleAlarm(
          startId,
          finalTrigger,
          'Silent Zone Engine',
          'Optimizing background sync...',
          { placeId: place.id, action: ALARM_ACTIONS.START_SILENCE },
        );
      }
    }

    // 2. Find the first END trigger that is still in the FUTURE (relaxed to 10s)
    const nextTriggerableEnd = upcomingSchedules.find(s => {
      const timeToRoll = s.endTime.getTime() - Date.now();
      return timeToRoll > 10000; // 10 seconds minimum
    });

    if (nextTriggerableEnd) {
      const triggerEnd = nextTriggerableEnd.endTime.getTime();
      await PersistentAlarmService.scheduleAlarm(
        endId,
        triggerEnd,
        'Silent Zone Engine',
        'Finalizing session...',
        { placeId: place.id, action: ALARM_ACTIONS.STOP_SILENCE },
      );
    }
  }

  /**
   * Core logic for when an OS alarm fires.
   * Performs Phase 1 (Immediate Reschedule) and Phase 2 (Execution).
   *
   * CRITICAL FIX: For START_SILENCE alarms, we DON'T return immediately.
   * Instead, we keep the function alive to prevent React Native from killing
   * the headless task and terminating GPS. The foreground service needs the
   * process to stay alive to continue monitoring.
   */
  async handleAlarmFired(data: any) {
    const alarmId = data?.notification?.id;
    let action =
      data?.notification?.data?.action ||
      data?.notification?.data?.data?.action;
    let placeId =
      data?.notification?.data?.placeId ||
      data?.notification?.data?.data?.placeId;

    // Fallback: Parse from ID if data missing (place-UUID-start/end)
    if (!action || !placeId) {
      if (alarmId?.startsWith('place-')) {
        const parts = alarmId.split('-');
        // Format is place-UUID-start or place-UUID-end
        // UUID might have dashes, so we take the last part as action and middle as ID
        action =
          parts[parts.length - 1] === 'start'
            ? ALARM_ACTIONS.START_SILENCE
            : ALARM_ACTIONS.STOP_SILENCE;
        placeId = alarmId.replace('place-', '').replace(/-(start|end)$/, '');
        Logger.info(
          `[Engine] 🧩 Reconstructed action=${action}, placeId=${placeId} from ID=${alarmId}`,
        );
      }
    }

    if (!this.realm || this.realm.isClosed) {
      Logger.error(
        `[Engine] ❌ Cannot handle alarm: Realm is null or closed (Action: ${action})`,
      );
      return;
    }

    Logger.info(`[Engine] ⚡ Fire: ${action} for ${placeId}`);

    // FETCH FRESH: Always fetch a fresh object in the current execution context
    // This prevents "thread-isolation" crashes from stale/thawed objects.
    const place = PlaceService.getPlaceById(this.realm, placeId) as any;

    if (!place) {
      Logger.warn(
        `[Engine] ⚠️ Place ${placeId} not found in DB during alarm fire.`,
      );
      return;
    }

    if (!place.isEnabled) {
      Logger.info(`[Engine] ⏭️ Skipping disabled place: ${place.name}`);
      return;
    }

    try {
      // PHASE 2: Execute Action
      if (action === ALARM_ACTIONS.START_SILENCE) {
        await this.handleStartAction(place);
      } else if (action === ALARM_ACTIONS.STOP_SILENCE) {
        await this.handleStopAction(placeId);
      }

      // PHASE 1: Immediate Reschedule (DAISY CHAIN)
      // Moved to AFTER execution so the engine state (geofencesActive) is correctly set
      // before we decide if we need an immediate backup alarm.
      await this.seedNextAlarmForPlace(place);
    } catch (error) {
      Logger.error(`[Engine] Action failed for ${placeId}:`, error);
    }
  }

  /**
   * Handles the 'START_SILENCE' action: Activates GPS and verifies location.
   */
  private async handleStartAction(placeData: any) {
    if (!this.realm || this.realm.isClosed) return;

    // RE-FETCH: Ensure we have a "live" object for this specific method call
    const place = PlaceService.getPlaceById(this.realm, placeData.id) as any;
    if (!place) {
      Logger.error('[Engine] Failed to re-fetch place in handleStartAction');
      return;
    }

    Logger.info(`[Engine] 📍 Starting monitoring for ${place.name}`);

    // 1. Activate Foreground Service & GPS
    this.geofencesActive = true; // Set explicitly before starting monitoring
    await this.startMonitoring();

    // 2. Immediate check: Are we already there?
    const deadline = this.calculateDeadlineForPlace(place.id);

    // FIX: Wrap processLocationUpdate in .catch() so any throw inside it
    // (Realm conflict, null ref, etc.) is caught and logged instead of
    // silently swallowing the entire check-in on alarm fire.
    // This is the most critical GPS callback — it must never fail silently.
    await gpsManager.forceLocationCheck(
      async loc => {
        try {
          await this.processLocationUpdate(loc);
        } catch (err) {
          Logger.error(
            '[GPS] handleStartAction processLocationUpdate failed:',
            err,
          );
        }
      },
      err => Logger.error('[GPS] Start check failed:', err),
      1,
      2,
      deadline,
    );
  }

  /**
   * Handles the 'STOP_SILENCE' action: Restores sound and refreshes monitoring.
   */
  private async handleStopAction(placeId: string) {
    Logger.info(`[Engine] 🧹 Cleaning up for ${placeId}`);

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
    const { activePlaces, upcomingSchedules } =
      ScheduleManager.categorizeBySchedule(enabledPlaces);

    Logger.info(
      `[LocationService] Refresh: active=${activePlaces.length}, upcoming=${upcomingSchedules.length}`,
    );
    if (activePlaces.length > 0) {
      Logger.info(
        `[LocationService] Active zones: ${activePlaces
          .map(p => p.name)
          .join(', ')}`,
      );
    }

    const needsMonitoring =
      activePlaces.length > 0 ||
      (upcomingSchedules.length > 0 &&
        upcomingSchedules[0].minutesUntilStart <=
          CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES);

    if (needsMonitoring) {
      Logger.info(
        '[LocationService] Monitoring needs active. Starting service...',
      );
      await this.startMonitoring();

      // PROACTIVE: If we have active zones, force an immediate check to catch entries
      if (activePlaces.length > 0) {
        Logger.info(
          '[LocationService] Proactive check initiated for active zones',
        );
        this.forceLocationCheck().catch(err => {
          Logger.error('[LocationService] Proactive check failed:', err);
        });
      }
    } else {
      Logger.info(
        '[LocationService] No active or imminent zones. Stopping service.',
      );
      await this.stopMonitoring();
    }
  }

  /**
   * Activates the foreground service, GPS watcher, and native geofences.
   */
  private async startMonitoring() {
    const hasPerms = await PermissionsManager.hasCriticalPermissions();
    if (!hasPerms) {
      Logger.error('[Service] Cannot start: Missing permissions');
      return;
    }

    // SURGICAL SYNC: If already active, we don't restart GPS, but we still force sync geofences/notifications.
    const isAlreadyWatching = this.geofencesActive && gpsManager.isWatching();

    if (isAlreadyWatching) {
      Logger.info(
        '[Service] Surgical Sync: Refreshing geofences without restarting GPS',
      );
    } else {
      Logger.info('[Service] Full Start: Activating GPS and Monitoring');
    }

    this.geofencesActive = true;
    try {
      if (!isAlreadyWatching) {
        await gpsManager.startWatching(
          async loc => {
            // Wrap in .catch() so any throw inside processLocationUpdate
            // never becomes a fatal unhandled promise rejection.
            try {
              await this.processLocationUpdate(loc);
            } catch (err) {
              Logger.error('[GPS] processLocationUpdate unhandled error:', err);
            }
          },
          err => Logger.error('[GPS] Watcher error:', err),
        );
      }

      // Sync native geofences as a secondary layer
      await this.syncNativeGeofences();
      await this.updateForegroundService();
    } catch (e) {
      Logger.error('[LocationService] Failed to start or sync monitoring:', e);
      if (!isAlreadyWatching) {
        this.geofencesActive = false;
      }
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
        radius: (place as any).radius + CONFIG.GEOFENCE_RADIUS_BUFFER,
      });
    }
  }

  /**
   * Processes a GPS location update. Handles zone entries and exits.
   */
  private async processLocationUpdate(location: any) {
    if (!this.realm) return;

    // 1. Determine which zones we are INSIDE
    const insideIds = LocationValidator.determineInsidePlaces(
      location,
      this.realm,
    );

    // Time-Based Expiry Check: ensure we aren't stuck in a session that should have ended.
    await this.checkSessionExpiry();

    // 2. Handle Entries
    for (const id of insideIds) {
      if (!CheckInService.isPlaceActive(this.realm, id)) {
        await this.handleGeofenceEntry(id);
      }
    }

    // 3. Handle Exits for active zones
    const activeLogs = CheckInService.getActiveCheckIns(this.realm).snapshot();
    for (const log of activeLogs) {
      if (log.isValid && !log.isValid()) continue;
      const placeId = log.placeId as string;
      if (!insideIds.includes(placeId)) {
        // Double check distance with hysteresis
        const place = PlaceService.getPlaceById(this.realm, placeId) as any;
        if (place && place.isValid && !place.isValid()) continue;
        if (place) {
          const isDefinitelyOutside = LocationValidator.isOutsidePlace(
            location,
            place,
            CONFIG.EXIT_HYSTERESIS_METERS || 20,
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
   */
  async handleGeofenceEntry(placeId: string) {
    if (!this.realm) return;
    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !place.isEnabled) return;

    // Check if we are within the schedule window for this place
    const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
    const now = Date.now();

    // FIX: Removed the 15-minute PRE_ACTIVATION buffer from silence activation.
    // Monitoring starts 15m early (warm-up), but silence only triggers at the exact start time.
    // We add a tiny 5s grace for clock drift.
    const startBuffer = 5000;
    const isInsideWindow =
      schedule &&
      now >= schedule.startTime.getTime() - startBuffer &&
      now < schedule.endTime.getTime();

    Logger.info(
      `[LocationService] Verifying entry for ${place.name}: ` +
        `schedule=${
          schedule ? schedule.startTime.toLocaleTimeString() : 'None'
        }, ` +
        `isInsideWindow=${isInsideWindow}`,
    );

    if (isInsideWindow && schedule) {
      Logger.info(
        `[LocationService] Window matched for ${place.name}. Activating silence.`,
      );
      await silentZoneManager.activateSilentZone(place);
      await this.updateForegroundService();
    } else {
      if (schedule) {
        Logger.info(
          `[LocationService] Window NOT matched for ${
            place.name
          }: now=${new Date(now).toLocaleTimeString()}, ` +
            `start=${schedule.startTime.toLocaleTimeString()}, end=${schedule.endTime.toLocaleTimeString()}`,
        );
      } else {
        Logger.info(
          `[LocationService] No upcoming schedule found for ${place.name}`,
        );
      }
    }
  }

  /**
   * Handles a geofence exit event: Restores sound and updates status.
   */
  async handleGeofenceExit(placeId: string) {
    await silentZoneManager.handleExit(placeId);
    await this.refreshMonitoringState();
    await this.updateForegroundService();
  }

  /**
   * Updates the foreground service notification text and icon.
   */
  private async updateForegroundService() {
    if (!this.realm || this.realm.isClosed) return;
    const enabledCount = PlaceService.getEnabledPlaces(this.realm).length;
    const activeCheckIns = Array.from(
      CheckInService.getActiveCheckIns(this.realm),
    );
    const activeName =
      activeCheckIns.length > 0
        ? (
            PlaceService.getPlaceById(
              this.realm,
              activeCheckIns[0].placeId as string,
            ) as any
          )?.name
        : null;

    await notificationManager.startForegroundService(
      enabledCount,
      [],
      activeName,
      activeCheckIns.length > 0,
    );
  }

  /**
   * Public API: Purges all scheduled alarms for all places.
   */
  async purgeAllAlarms() {
    if (!this.realm || this.realm.isClosed) return;
    const all = Array.from(PlaceService.getAllPlaces(this.realm));
    for (const p of all) {
      const id = (p as any).id;
      await PersistentAlarmService.cancelAlarm(`place-${id}-start`);
      await PersistentAlarmService.cancelAlarm(`place-${id}-end`);
    }
  }

  /**
   * Public API: Force a location check immediately.
   */
  async forceLocationCheck(): Promise<void> {
    return gpsManager.forceLocationCheck(
      async location => {
        try {
          await this.processLocationUpdate(location);
        } catch (err) {
          Logger.error(
            '[GPS] forceLocationCheck processLocationUpdate failed:',
            err,
          );
        }
      },
      error => Logger.error('[GPS] Force check failed:', error),
      1,
      3,
    );
  }

  /**
   * Helper to find the end time of the current or next schedule for a place.
   */
  private calculateDeadlineForPlace(placeId: string): number | undefined {
    if (!this.realm) return undefined;
    const place = PlaceService.getPlaceById(this.realm, placeId);
    const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
    return schedule?.endTime.getTime();
  }

  /**
   * Safety Net: Checks if any active sessions have exceeded their schedule end time.
   */
  private async checkSessionExpiry() {
    if (!this.realm) return;

    const activeCheckIns = CheckInService.getActiveCheckIns(
      this.realm,
    ).snapshot();
    const now = Date.now();
    const EXPIRY_BUFFER_MS = 2 * 60 * 1000; // 2 minutes grace period

    for (const log of activeCheckIns) {
      const placeId = log.placeId as string;
      const place = PlaceService.getPlaceById(this.realm, placeId) as any;

      if (!place) continue;

      const isCurrentlyValid = ScheduleManager.isCurrentScheduleActive(place);

      if (!isCurrentlyValid) {
        Logger.warn(
          `[LocationService] ⏳ Session Expiry: active session for ${place.name} is past schedule. Forcing exit.`,
        );
        await silentZoneManager.handleExit(placeId, true);
        await this.updateForegroundService();
      }
    }
  }
}

export const locationService = new LocationService();
