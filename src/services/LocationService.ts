import Geofencing from '@rn-org/react-native-geofencing';
import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import { Preferences } from '../database/services/PreferencesService';
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
  private geofencesActive = false;
  private lastTriggerTime: { [key: string]: number } = {};

  /**
   * Initialize the service with the active database instance.
   */
  async initialize(realmInstance: Realm) {
    if (this.isReady && this.realm === realmInstance) return;
    
    this.realm = realmInstance;
    silentZoneManager.setRealm(realmInstance);
    
    if (Platform.OS === 'android') {
      await notificationManager.createNotificationChannels();
    }

    // Initial seed: ensure every enabled place has its next alarm scheduled
    await this.syncGeofences();
    this.setupReactiveSync();
    this.isReady = true;
    Logger.info('[LocationService] Engine Initialized');
  }

  /**
   * Non-destructive initialization for background events.
   */
  async initializeLight(realmInstance: Realm) {
    this.realm = realmInstance;
    silentZoneManager.setRealm(realmInstance);
    this.isReady = true;
  }

  /**
   * Main Sync: Ensures the "First Link" in the chain is set for all places.
   * Can be used for a global reset or for specific updated places.
   */
  async syncGeofences(forceAlarmSync: boolean = false, specificPlaceIds?: string[]) {
    if (!this.realm || this.realm.isClosed) return;

    try {
      const prefs = this.realm.objectForPrimaryKey<Preferences>('Preferences', 'USER_PREFS');
      const trackingEnabled = prefs?.trackingEnabled ?? true;

      // Handle Global Disable
      if (!trackingEnabled) {
        Logger.info('[LocationService] Tracking disabled. Cleaning up.');
        await this.purgeAllAlarms();
        await this.stopMonitoring();
        return;
      }

      const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
      
      for (const place of enabledPlaces) {
        await this.seedNextAlarmForPlace(place);
      }

      await this.refreshMonitoringState();
    } catch (error) {
      Logger.error('[LocationService] Sync failed:', error);
    }
  }

  /**
   * For a specific place, find the very next START and END alarms and set them.
   * This is the "Daisy Chain" engine.
   */
  private async seedNextAlarmForPlace(place: any) {
    const schedules = place.schedules || [];
    if (schedules.length === 0) return;

    // To find the TRULY next alarm (and not the one that just fired),
    // we search from (NOW + 1 minute).
    const searchBase = new Date(Date.now() + 61000); 
    const next = ScheduleManager.getCurrentOrNextSchedule({...place, searchBase}); 
    // Wait, ScheduleManager doesn't take searchBase. 
    // I'll manually handle the 'Next' logic here for precision.
    
    const { upcomingSchedules } = ScheduleManager.categorizeBySchedule([place]);
    
    // Filter to find the first schedule that starts AFTER now + buffer
    const nextTrueStart = upcomingSchedules.find(s => s.startTime.getTime() > Date.now() + 60000);
    const nextTrueEnd = upcomingSchedules.find(s => s.endTime.getTime() > Date.now() + 60000);

    const startId = `place-${place.id}-start`;
    const endId = `place-${place.id}-end`;

    // 1. Schedule next START (T-10)
    if (nextTrueStart) {
      const startTime = nextTrueStart.startTime.getTime();
      const triggerStart = startTime - (CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000);
      if (triggerStart > Date.now()) {
        await alarmService.scheduleNativeAlarm(startId, triggerStart, place.id, ALARM_ACTIONS.START_SILENCE);
      }
    }

    // 2. Schedule next END (Exactly at end time)
    if (nextTrueEnd) {
      const triggerEnd = nextTrueEnd.endTime.getTime();
      if (triggerEnd > Date.now()) {
        await alarmService.scheduleNativeAlarm(endId, triggerEnd, place.id, ALARM_ACTIONS.STOP_SILENCE);
      }
    }
  }

  /**
   * Logic for when an OS alarm fires.
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

  private async handleStopAction(placeId: string) {
    Logger.info(`[Engine] 🧹 Cleaning up for ${placeId}`);
    
    // 1. Restore sound if checked in
    await silentZoneManager.handleExit(placeId, true);
    
    // 2. Refresh monitoring state (Stop GPS if no other active zones)
    await this.refreshMonitoringState();
  }

  private async refreshMonitoringState() {
    if (!this.realm) return;

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    const { activePlaces, upcomingSchedules } = ScheduleManager.categorizeBySchedule(enabledPlaces);

    const needsMonitoring = activePlaces.length > 0 || 
      (upcomingSchedules.length > 0 && upcomingSchedules[0].minutesUntilStart <= CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES);

    if (needsMonitoring) {
      await this.startMonitoring();
    } else {
      await this.stopMonitoring();
    }
  }

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

  private async stopMonitoring() {
    this.geofencesActive = false;
    gpsManager.stopWatching();
    await Geofencing.removeAllGeofence();
    await notificationManager.stopForegroundService();
  }

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

  async handleGeofenceEntry(placeId: string) {
    if (!this.realm) return;
    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !place.isEnabled) return;

    // Check if we are within the schedule window for this place
    const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
    const now = Date.now();
    
    // Allow activation 1 minute early for smooth flow
    if (schedule && now >= schedule.startTime.getTime() - 60000 && now < schedule.endTime.getTime()) {
      await silentZoneManager.activateSilentZone(place);
      await this.updateForegroundService();
    }
  }

  async handleGeofenceExit(placeId: string) {
    await silentZoneManager.handleExit(placeId);
    await this.updateForegroundService();
  }

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

  private async purgeAllAlarms() {
    if (!this.realm) return;
    const all = Array.from(PlaceService.getAllPlaces(this.realm));
    for (const p of all) await alarmService.cancelAlarmsForPlace((p as any).id);
  }

  private setupReactiveSync() {
    if (!this.realm) return;
    
    // Update service when places are added/toggled
    const places = this.realm.objects('Place');
    places.addListener(() => this.syncGeofences());

    // Update notification when checkins change
    const checkins = this.realm.objects('CheckInLog');
    checkins.addListener(() => this.updateForegroundService());
  }

  /**
   * Public API: Force a location check immediately.
   */
  async forceLocationCheck(): Promise<void> {
    return gpsManager.forceLocationCheck(
      (location) => this.processLocationUpdate(location),
      (error) => Logger.error('[GPS] Force check failed:', error),
      1, 3
    );
  }

  private calculateDeadlineForPlace(placeId: string): number | undefined {
    if (!this.realm) return undefined;
    const place = PlaceService.getPlaceById(this.realm, placeId);
    const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
    return schedule?.endTime.getTime();
  }
}

export const locationService = new LocationService();