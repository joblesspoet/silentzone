import Geofencing from '@rn-org/react-native-geofencing';
import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import { Preferences } from '../database/services/PreferencesService';
import { CheckInService } from '../database/services/CheckInService';
import { Platform } from 'react-native';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { Logger } from './Logger';
import { ScheduleManager, UpcomingSchedule } from './ScheduleManager';
import { LocationValidator, LocationState } from './LocationValidator';
import { alarmService, ALARM_ACTIONS } from './AlarmService';
import { notificationManager } from './NotificationManager';
import { CONFIG } from '../config/config';
import { TimerManager } from './TimerManager';
import { GPSManager, gpsManager } from './GPSManager';
import { SilentZoneManager, silentZoneManager } from './SilentZoneManager';

/**
 * UNIVERSAL LOCATION SERVICE
 * Optimized for scheduled locations with smart battery management
 *
 * Works for ANY location type:
 * - Mosque (30m radius, scheduled prayer times)
 * - Office (50m radius, work hours)
 * - Library (40m radius, study sessions)
 * - Hospital (60m radius, visiting hours)
 * - Cinema (35m radius, movie times)
 * - Gym (45m radius, workout schedule)
 * - Any other location!
 */

class LocationService {
  // Core state
  private realm: Realm | null = null;
  private isReady = false;
  private isChecking = false;
  private isSyncing = false;
  private geofencesActive = false;

  // Concurrency control
  private isProcessingAlarm = false;
  private alarmQueue: any[] = [];

  // Optimization
  private lastTriggerTime: { [key: string]: number } = {};
  private lastEnabledIds: string = '';
  private lastKnownLocation: LocationState | null = null;

  // Schedule tracking
  private upcomingSchedules: UpcomingSchedule[] = [];
  private isInScheduleWindow = false;

  // Timer management
  private timerManager = new TimerManager();

  // Service restart check
  private restartCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize the location service
   */
  async initialize(realmInstance: Realm) {
    // CRITICAL: Always update the realm instance
    this.realm = realmInstance;
    silentZoneManager.setRealm(realmInstance);

    // CRITICAL: Always restore state from database
    await this.restoreStateFromDatabase();

    if (this.isReady) {
      Logger.info('[LocationService] Re-initializing with new realm instance');
      await this.syncGeofences();
      return;
    }

    if (Platform.OS === 'android') {
      await notificationManager.createNotificationChannels();
    }

    await this.syncGeofences();
    this.setupReactiveSync();
    this.setupServiceRestart();

    this.isReady = true;
    Logger.info('[LocationService] Service initialized');
  }

  /**
   * CRITICAL: Restore runtime state from database
   * Called on every initialization to handle process death
   */
  private async restoreStateFromDatabase() {
    if (!this.realm || this.realm.isClosed) {
      Logger.error('[Restore] Cannot restore: realm not available');
      return;
    }

    Logger.info('[Restore] Restoring state from database...');

    try {
      // 1. Restore active check-ins
      const activeLogs = Array.from(CheckInService.getActiveCheckIns(this.realm));
      Logger.info(`[Restore] Found ${activeLogs.length} active check-in(s)`);

      // 2. Recalculate upcoming schedules
      const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
      const { upcomingSchedules } = ScheduleManager.categorizeBySchedule(enabledPlaces);
      this.upcomingSchedules = upcomingSchedules;
      Logger.info(`[Restore] Found ${this.upcomingSchedules.length} upcoming schedule(s)`);

      // 3. Determine if we're currently in a schedule window
      const now = new Date();
      let foundActiveWindow = false;

      for (const place of enabledPlaces) {
        const schedules = (place as any).schedules || [];
        for (const schedule of schedules) {
          if (ScheduleManager.isScheduleActiveNow(schedule, now)) {
            foundActiveWindow = true;
            Logger.info(`[Restore] Currently in active window: ${(place as any).name}`);
            break;
          }
        }
        if (foundActiveWindow) break;
      }

      this.isInScheduleWindow = foundActiveWindow;

      // 4. Restore timers for active check-ins
      await this.restoreActiveTimers();

      // 5. CRITICAL: Always reschedule alarms on app restart
      // This handles the case where app was killed and alarms may have been lost
      Logger.info('[Restore] Rescheduling all alarms after app restart...');
      for (const place of enabledPlaces) {
        if ((place as any).isEnabled) {
          await alarmService.cancelAlarmsForPlace((place as any).id as string);
          await alarmService.scheduleAlarmsForPlace(place);
        }
      }

      // 6. CRITICAL: If we're in an active window but geofences aren't active, start monitoring
      // This handles the case where phone was rebooted during an active schedule
      if (foundActiveWindow && !this.geofencesActive) {
        Logger.warn('[Restore] In active window but geofences not active - auto-starting monitoring');
        await this.startForegroundService();
        
        // Force a location check to see if we're already inside the zone
        const activePlaces = enabledPlaces.filter((place: any) => {
          const schedules = place.schedules || [];
          return schedules.some((schedule: any) => ScheduleManager.isScheduleActiveNow(schedule, now));
        });
        
        if (activePlaces.length > 0) {
          const deadline = this.calculateMaxEndTime(activePlaces);
          Logger.info(`[Restore] Forcing location check for ${activePlaces.length} active place(s)`);
          await gpsManager.forceLocationCheck(
            (location) => this.processLocationUpdate(location),
            (error) => this.handleLocationError(error),
            1,
            3,
            deadline
          );
        }
      }

      Logger.info('[Restore] State restoration complete', {
        activeCheckIns: activeLogs.length,
        upcomingSchedules: this.upcomingSchedules.length,
        isInScheduleWindow: this.isInScheduleWindow,
        geofencesActive: this.geofencesActive,
      });
    } catch (error) {
      Logger.error('[Restore] Failed to restore state:', error);
    }
  }

  /**
   * Start foreground service
   */
  private async startForegroundService() {
    if (Platform.OS !== 'android') {
      this.startGeofenceMonitoring();
      return;
    }

    const hasPermission = await PermissionsManager.hasCriticalPermissions();
    if (!hasPermission) {
      Logger.error('[LocationService] Aborting start: Missing critical permissions in background');
      await notificationManager.showNotification(
        'Setup Required',
        'Silent Zone failed to start. Please open app and check permissions.',
        'permission-failure'
      );
      return;
    }

    // Gather state for notification
    const enabledPlaces = this.realm ? Array.from(PlaceService.getEnabledPlaces(this.realm)) : [];
    const enabledCount = enabledPlaces.length;
    const activeCheckIns = this.realm ? Array.from(CheckInService.getActiveCheckIns(this.realm)) : [];

    // Determine active place name if checked in
    let activePlaceName: string | null = null;
    if (activeCheckIns.length > 0) {
      const placeId = activeCheckIns[0].placeId;
      const place = this.realm ? PlaceService.getPlaceById(this.realm, placeId as string) : null;
      if (place) activePlaceName = (place as any).name;
    }

    await notificationManager.startForegroundService(
      enabledCount,
      this.upcomingSchedules,
      activePlaceName,
      this.isInScheduleWindow
    );

    this.startGeofenceMonitoring();
  }

  /**
   * Restore timers for active check-ins
   */
  private async restoreActiveTimers() {
    if (!this.realm || this.realm.isClosed) return;

    const activeLogs = Array.from(CheckInService.getActiveCheckIns(this.realm));
    Logger.info(`[LocationService] Restoring timers for ${activeLogs.length} active sessions`);

    for (const log of activeLogs) {
      const placeId = log.placeId as string;
      if (this.timerManager.hasTimer(`end-${placeId}`)) continue;

      const place = PlaceService.getPlaceById(this.realm, placeId);
      if (!place) continue;

      const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
      if (schedule) {
        const endTime = schedule.endTime.getTime();
        const now = Date.now();

        if (now >= endTime) {
          Logger.info(`[LocationService] Found expired session for ${(place as any).name}, ending now`);
          await this.handleGeofenceExit(placeId, true);
        } else {
          const delay = endTime - now;
          this.scheduleEndTimerForPlace(placeId, delay);
        }
      }
    }
  }

  /**
   * Restart service if killed by Android
   */
  private setupServiceRestart() {
    if (Platform.OS !== 'android') return;

    this.restartCheckInterval = setInterval(() => {
      if (!gpsManager.isWatching() && this.geofencesActive) {
        Logger.info('[LocationService] Service appears stopped, restarting');
        this.startGeofenceMonitoring();
      }
    }, 60000);
  }

  /**
   * Stop foreground service
   */
  private async stopForegroundService() {
    await notificationManager.stopForegroundService();
    this.stopGeofenceMonitoring();
  }

  /**
   * Emergency cleanup for crashes
   */
  async cleanupOnCrash() {
    Logger.info('[LocationService] Emergency cleanup triggered');

    try {
      if (!this.realm || this.realm.isClosed) return;

      const activeLogs = Array.from(CheckInService.getActiveCheckIns(this.realm));

      if (activeLogs.length > 0) {
        Logger.info(`[LocationService] Restoring sound for ${activeLogs.length} active locations`);

        for (const log of activeLogs) {
          try {
            await silentZoneManager.handleExit(log.placeId as string, true);
          } catch (error) {
            Logger.error('[LocationService] Failed to restore:', error);
          }
        }
      }
    } catch (error) {
      Logger.error('[LocationService] Emergency cleanup failed:', error);
    } finally {
      await this.stopForegroundService();
    }
  }

  private isPreferenceTrackingEnabled(): boolean {
    if (!this.realm || this.realm.isClosed) return false;
    const prefs = this.realm.objectForPrimaryKey<Preferences>('Preferences', 'USER_PREFS');
    return prefs?.trackingEnabled ?? true;
  }

  /**
   * Set up reactive database listeners
   */
  private setupReactiveSync() {
    if (!this.realm || this.realm.isClosed) return;

    const places = this.realm.objects('Place');
    places.addListener((collection, changes) => {
      (async () => {
        try {
          if (
            changes.insertions.length > 0 ||
            changes.deletions.length > 0 ||
            changes.newModifications.length > 0
          ) {
            Logger.info('[LocationService] Places changed, syncing');

            const enabledPlaces = Array.from(collection).filter((p: any) => p.isEnabled);

            // Auto-enable tracking if places added
            if (enabledPlaces.length > 0) {
              const prefs = this.realm!.objectForPrimaryKey('Preferences', 'USER_PREFS') as any;
              if (prefs && !prefs.trackingEnabled) {
                Logger.info('[LocationService] Auto-enabling tracking (places added)');
                this.realm!.write(() => {
                  prefs.trackingEnabled = true;
                });

                setTimeout(async () => {
                  await this.syncGeofences();
                  await this.safetyCheckMonitoring();
                }, 300);

                return;
              }
            }

            // Auto-disable tracking if no enabled places
            if (enabledPlaces.length === 0) {
              const prefs = this.realm!.objectForPrimaryKey('Preferences', 'USER_PREFS') as any;
              if (prefs && prefs.trackingEnabled) {
                Logger.info('[LocationService] Auto-disabling tracking (no enabled places)');
                this.realm!.write(() => {
                  prefs.trackingEnabled = false;
                });
              }
            }

            await this.syncGeofences();
            await this.safetyCheckMonitoring();
          }
        } catch (error) {
          Logger.error('[LocationService] Reactive sync failed:', error);
        }
      })();
    });

    // Listen for CheckInLog changes
    const checkIns = this.realm.objects('CheckInLog');
    checkIns.addListener((collection, changes) => {
      (async () => {
        if (changes.insertions.length > 0 || changes.deletions.length > 0) {
          Logger.info('[LocationService] CheckIns changed, updating notification');
          await this.startForegroundService();
        }
      })();
    });

    // Listen for preferences changes
    const prefs = this.realm.objectForPrimaryKey<Preferences>('Preferences', 'USER_PREFS');
    if (prefs) {
      prefs.addListener(() => {
        (async () => {
          Logger.info('[LocationService] Preferences changed, syncing');
          await this.syncGeofences();
          await this.safetyCheckMonitoring();
        })();
      });
    }
  }

  /**
   * Safety check: Ensure monitoring is active if needed
   */
  private async safetyCheckMonitoring() {
    if (!this.realm) return;

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    if (enabledPlaces.length > 0 && this.isPreferenceTrackingEnabled()) {
      const { activePlaces, upcomingSchedules } = ScheduleManager.categorizeBySchedule(enabledPlaces);
      const shouldMonitor = this.shouldStartMonitoring(activePlaces, upcomingSchedules);

      if (shouldMonitor && !this.geofencesActive) {
        Logger.warn('[LocationService] Safety check: Restarting monitoring');
        await this.startForegroundService();
      }
    }
  }

  /**
   * Main sync method - smart scheduling support
   */
  async syncGeofences() {
    if (!this.realm || this.realm.isClosed || this.isSyncing) return;

    this.isSyncing = true;

    try {
      const trackingEnabled = this.isPreferenceTrackingEnabled();

      if (!trackingEnabled) {
        Logger.info('[LocationService] Tracking disabled globally');
        const allPlaces = Array.from(PlaceService.getAllPlaces(this.realm));
        for (const place of allPlaces) {
          await alarmService.cancelAlarmsForPlace((place as any).id as string);
        }
        await this.stopForegroundService();
        await Geofencing.removeAllGeofence();
        this.geofencesActive = false;
        return;
      }

      // Get ALL places first to cleanup disabled ones
      const allPlaces = Array.from(PlaceService.getAllPlaces(this.realm));
      const enabledPlaces = allPlaces.filter((p: any) => p.isEnabled);

      // Cleanup alarms for DISABLED places
      const disabledPlaces = allPlaces.filter((p: any) => !p.isEnabled);
      for (const place of disabledPlaces) {
        await alarmService.cancelAlarmsForPlace((place as any).id as string);
      }

      const { activePlaces, upcomingSchedules } = ScheduleManager.categorizeBySchedule(enabledPlaces);
      this.upcomingSchedules = upcomingSchedules;
      this.isInScheduleWindow = activePlaces.length > 0 || upcomingSchedules.length > 0;

      const shouldMonitor = this.shouldStartMonitoring(activePlaces, upcomingSchedules);

      // Log next schedule if any
      if (upcomingSchedules.length > 0) {
        const next = upcomingSchedules[0];
        Logger.info(
          `[LocationService] Next schedule: ${next.placeName} in ${next.minutesUntilStart} minutes`
        );
      }

      if (shouldMonitor) {
        const hasPermissions = await PermissionsManager.hasCriticalPermissions();
        if (!hasPermissions) {
          Logger.warn('[LocationService] Missing required permissions');
          await this.stopForegroundService();
          return;
        }

        // Add geofences for active places AND upcoming pre-start places
        const placesToMonitor = new Set([...activePlaces]);

        if (upcomingSchedules.length > 0) {
          const next = upcomingSchedules[0];
          if (next.minutesUntilStart <= CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES) {
            const place = enabledPlaces.find((p: any) => p.id === next.placeId);
            if (place) placesToMonitor.add(place);
          }
        }

        // OPTIMIZATION: Check if monitoring set OR place details have changed
        const currentIds = Array.from(placesToMonitor)
          .map((p: any) => `${p.id}:${p.updatedAt?.getTime() || 0}`)
          .sort()
          .join(',');
        const hasIdChanges = currentIds !== this.lastEnabledIds;

        if (!hasIdChanges && this.geofencesActive) {
          Logger.info('[LocationService] Monitoring set unchanged, skipping native geofence update');
        } else {
          await this.handleManualDisableCleanup(new Set(activePlaces.map((p: any) => p.id as string)));
          await Geofencing.removeAllGeofence();
          
          for (const place of placesToMonitor) {
            await Geofencing.addGeofence({
              id: (place as any).id as string,
              latitude: (place as any).latitude as number,
              longitude: (place as any).longitude as number,
              radius: Math.max(
                CONFIG.MIN_GEOFENCE_RADIUS,
                (place as any).radius as number + CONFIG.GEOFENCE_RADIUS_BUFFER
              ),
            });
          }
          this.lastEnabledIds = currentIds;
          Logger.info(`[LocationService] Updated native geofences (${placesToMonitor.size} places)`);
        }

        await this.startForegroundService();
        this.geofencesActive = true;

        // Schedule individual alarms for all enabled places
        for (const place of enabledPlaces) {
          if ((place as any).isEnabled) {
            // OPTIMIZATION: Only reschedule if needed or it's a new day
            // For now, keeping as is but canceling first to avoid dupes
            await alarmService.cancelAlarmsForPlace((place as any).id as string);
            await alarmService.scheduleAlarmsForPlace(place);
          }
        }

        // If we have active places, verify location immediately
        if (activePlaces.length > 0) {
          const deadline = this.calculateMaxEndTime(activePlaces);
          Logger.info(`[LocationService] Active places detected - Checking if already inside...`);
          await gpsManager.forceLocationCheck(
            (location) => this.processLocationUpdate(location),
            (error) => this.handleLocationError(error),
            1,
            3,
            deadline
          );
        }
      } else {
        // PASSIVE MODE
        Logger.info('[LocationService] Entering passive mode (using alarms)');

        if (this.geofencesActive) {
          await this.handleManualDisableCleanup(new Set());
          await Geofencing.removeAllGeofence();
          this.geofencesActive = false;
        }

        await this.stopForegroundService();

        for (const place of enabledPlaces) {
          if ((place as any).isEnabled) {
            await alarmService.cancelAlarmsForPlace((place as any).id as string);
            await alarmService.scheduleAlarmsForPlace(place);
          }
        }
      }

      // Health check
      if (this.geofencesActive) {
        const diagnostics = await alarmService.getAlarmDiagnostics();
        Logger.info('[LocationService] System Health:', {
          gpsActive: this.geofencesActive,
          hasLocation: !!this.lastKnownLocation,
          isInScheduleWindow: this.isInScheduleWindow,
          upcomingSchedules: this.upcomingSchedules.length,
          totalAlarms: diagnostics.totalScheduled,
          nextAlarm: diagnostics.nextAlarmTime?.toLocaleString() || 'none',
        });

        if (this.isInScheduleWindow && diagnostics.totalScheduled === 0) {
          Logger.warn('[LocationService] In schedule window but no alarms scheduled!');
        }
      }
    } catch (error) {
      Logger.error('[LocationService] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Calculate the latest end time of all active schedules
   */
  private calculateMaxEndTime(activePlaces: any[]): number {
    const now = new Date();
    let maxEndTime = 0;

    for (const place of activePlaces) {
      if (place.schedules) {
        for (const schedule of place.schedules) {
          if (ScheduleManager.isScheduleActiveNow(schedule, now)) {
            const [endHours, endMins] = schedule.endTime.split(':').map(Number);
            const scheduleEnd = new Date(now);
            scheduleEnd.setHours(endHours, endMins, 0, 0);

            if (scheduleEnd.getTime() < now.getTime()) {
              scheduleEnd.setDate(scheduleEnd.getDate() + 1);
            }

            if (scheduleEnd.getTime() > maxEndTime) {
              maxEndTime = scheduleEnd.getTime();
            }
          }
        }
      }
    }

    return maxEndTime;
  }

  /**
   * Get comprehensive system health status
   */
  async getSystemHealth(): Promise<{
    status: 'healthy' | 'warning' | 'error';
    details: {
      gps: { active: boolean; lastUpdate: string | null; accuracy: number | null };
      alarms: { total: number; next: string | null };
      tracking: {
        enabled: boolean;
        activeCheckIns: number;
        upcomingSchedules: number;
      };
      issues: string[];
    };
  }> {
    const issues: string[] = [];
    let status: 'healthy' | 'warning' | 'error' = 'healthy';

    const gpsActive = this.geofencesActive;
    const lastUpdate = this.lastKnownLocation
      ? new Date(this.lastKnownLocation.timestamp).toLocaleString()
      : null;
    const accuracy = this.lastKnownLocation?.accuracy || null;

    if (this.isInScheduleWindow && !gpsActive) {
      issues.push('GPS should be active but is not running');
      status = 'error';
    }

    if (gpsActive && !this.lastKnownLocation) {
      issues.push('GPS active but no location updates received');
      status = 'warning';
    }

    if (accuracy && accuracy > 100) {
      issues.push(`GPS accuracy poor (${Math.round(accuracy)}m)`);
      status = 'warning';
    }

    const alarmDiag = await alarmService.getAlarmDiagnostics();

    if (this.isInScheduleWindow && alarmDiag.totalScheduled === 0) {
      issues.push('In schedule window but no alarms scheduled');
      status = 'error';
    }

    const activeCheckIns = this.realm
      ? Array.from(CheckInService.getActiveCheckIns(this.realm)).length
      : 0;

    if (activeCheckIns > 0 && !gpsActive) {
      issues.push(`Active check-ins (${activeCheckIns}) but GPS not running`);
      status = 'warning';
    }

    return {
      status,
      details: {
        gps: { active: gpsActive, lastUpdate, accuracy },
        alarms: {
          total: alarmDiag.totalScheduled,
          next: alarmDiag.nextAlarmTime?.toLocaleString() || null,
        },
        tracking: {
          enabled: this.geofencesActive,
          activeCheckIns,
          upcomingSchedules: this.upcomingSchedules.length,
        },
        issues,
      },
    };
  }

  private async handleManualDisableCleanup(enabledIdsSet: Set<string>) {
    if (!this.realm || this.realm.isClosed) return;

    const activeLogs = Array.from(CheckInService.getActiveCheckIns(this.realm));

    for (const log of activeLogs) {
      if (!enabledIdsSet.has(log.placeId as string)) {
        Logger.info(`[LocationService] Force checkout: ${log.placeId}`);
        await this.handleGeofenceExit(log.placeId as string, true);
      }
    }
  }

  /**
   * Start geofence monitoring with GPS verification
   */
  private async startGeofenceMonitoring(deadline?: number) {
    if (this.geofencesActive) {
      Logger.info('[LocationService] Geofences already active');
      return;
    }

    this.stopGeofenceMonitoring();
    Logger.info('[LocationService] Starting geofence monitoring');

    this.geofencesActive = true;

    await gpsManager.startWatching(
      (location) => this.processLocationUpdate(location),
      (error) => this.handleLocationError(error),
      deadline
    );

    // Restore timers after starting
    await this.restoreActiveTimers();

    Logger.info('[LocationService] Geofence monitoring started with verification');
  }

  private stopGeofenceMonitoring() {
    Logger.info('[LocationService] Stopping geofence monitoring');
    gpsManager.stopWatching();
    this.timerManager.clearAll();
  }

  /**
   * Determine if we should start monitoring NOW
   */
  private shouldStartMonitoring(activePlaces: any[], upcomingSchedules: any[]): boolean {
    if (!this.realm) {
      Logger.warn('[Monitor Check] Realm not ready');
      return false;
    }

    const now = new Date();
    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));

    if (enabledPlaces.length === 0) {
      Logger.info('[Monitor Check] No enabled places');
      return false;
    }

    // Check if we're CURRENTLY inside an active schedule window
    for (const place of enabledPlaces) {
      const schedules = (place as any).schedules || [];

      // If no schedules, it's a 24/7 place - ALWAYS active
      if (schedules.length === 0) {
        Logger.info(`[Monitor Check] 24/7 Place: ${(place as any).name}`);
        return true;
      }

      for (const schedule of schedules) {
        if (ScheduleManager.isScheduleActiveNow(schedule, now)) {
          Logger.info(`[Monitor Check] ACTIVE NOW: ${(place as any).name}`);
          return true;
        }
      }
    }

    // Check if we have an upcoming schedule soon
    if (upcomingSchedules.length > 0) {
      const nextSchedule = upcomingSchedules[0];
      const safetyThreshold = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES + 5;

      if (nextSchedule.minutesUntilStart <= safetyThreshold) {
        Logger.info(
          `[Monitor Check] UPCOMING: ${nextSchedule.placeName} in ${nextSchedule.minutesUntilStart} min`
        );
        return true;
      }

      Logger.info(
        `[Monitor Check] WAITING: Next schedule in ${nextSchedule.minutesUntilStart} min`
      );
    } else {
      Logger.info('[Monitor Check] No upcoming schedules found');
    }

    return false;
  }

  /**
   * Handle alarm fired event - THREAD SAFE with queue
   */
  async handleAlarmFired(data: any) {
    const alarmId = data?.notification?.id || 'unknown';

    if (this.isProcessingAlarm) {
      Logger.warn(`[LocationService] Alarm ${alarmId} queued (already processing)`);
      this.alarmQueue.push(data);
      return;
    }

    this.isProcessingAlarm = true;

    try {
      Logger.info(`[LocationService] Processing alarm: ${alarmId}`, data);

      await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));

      if (!this.realm || this.realm.isClosed) {
        Logger.error('[LocationService] Cannot process alarm: realm not ready');
        return;
      }

      const action = data?.notification?.data?.action || data?.action;

      if (action === ALARM_ACTIONS.START_MONITORING) {
        Logger.info('[LocationService] Pre-activation alarm (15min before)');
      } else if (action === ALARM_ACTIONS.START_SILENCE) {
        Logger.info('[LocationService] Activation alarm (exact time)');
      } else if (action === ALARM_ACTIONS.STOP_SILENCE) {
        Logger.info('[LocationService] Deactivation alarm (end time)');
      }

      await this.syncGeofences();

      if (action === ALARM_ACTIONS.START_SILENCE) {
        const placeId = data?.notification?.data?.placeId || data?.placeId;
        const deadline = this.calculateDeadlineForPlace(placeId);
        await gpsManager.forceLocationCheck(
          (location) => this.processLocationUpdate(location),
          (error) => this.handleLocationError(error),
          1,
          3,
          deadline
        );
      }

      if (action === ALARM_ACTIONS.STOP_SILENCE) {
        Logger.info('[LocationService] STOP_SILENCE: Forcing check-out and rescheduling next occurrence');
        const placeId = data?.notification?.data?.placeId || data?.placeId;
        if (placeId) {
          await this.handleGeofenceExit(placeId, true);

          // CRITICAL: Reschedule alarms for the next occurrence (tomorrow)
          // This ensures daily repeating schedules work correctly
          const place = this.realm ? PlaceService.getPlaceById(this.realm, placeId) : null;
          if (place) {
            Logger.info(`[LocationService] Rescheduling next occurrence for ${(place as any).name}`);
            await alarmService.cancelAlarmsForPlace(placeId);
            await alarmService.scheduleAlarmsForPlace(place);
          }
        }
      }

      Logger.info(`[LocationService] Alarm ${alarmId} processed successfully`);
    } catch (error) {
      Logger.error('[LocationService] Error processing alarm:', error);
    } finally {
      this.isProcessingAlarm = false;

      if (this.alarmQueue.length > 0) {
        const nextAlarm = this.alarmQueue.shift();
        Logger.info(`[LocationService] Processing queued alarm (${this.alarmQueue.length} remaining)`);
        setTimeout(() => this.handleAlarmFired(nextAlarm), 1000);
      }
    }
  }

  /**
   * Calculate deadline for a place's active schedule
   */
  private calculateDeadlineForPlace(placeId: string): number | undefined {
    if (!this.realm) return undefined;

    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !(place as any).schedules) return undefined;

    const now = new Date();
    for (const schedule of (place as any).schedules) {
      if (ScheduleManager.isScheduleActiveNow(schedule, now)) {
        const [endHours, endMins] = schedule.endTime.split(':').map(Number);
        const scheduleEnd = new Date(now);
        scheduleEnd.setHours(endHours, endMins, 0, 0);

        if (scheduleEnd.getTime() < now.getTime()) {
          scheduleEnd.setDate(scheduleEnd.getDate() + 1);
        }

        Logger.info(`[LocationService] Force check deadline: ${scheduleEnd.toLocaleTimeString()}`);
        return scheduleEnd.getTime();
      }
    }

    return undefined;
  }

  /**
   * Schedule automatic stop when schedule ends
   */
  private scheduleAutoStop(activePlaces: any[]) {
    this.timerManager.clear('auto-stop');

    if (activePlaces.length === 0) return;

    let earliestEnd: Date | null = null;

    for (const place of activePlaces) {
      const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
      if (schedule && schedule.endTime) {
        if (!earliestEnd || schedule.endTime < earliestEnd) {
          earliestEnd = schedule.endTime;
        }
      }
    }

    if (!earliestEnd) return;

    const msUntilEnd = earliestEnd.getTime() - Date.now();
    const stopDelay = msUntilEnd + 60000; // +1 minute buffer

    if (stopDelay > 0) {
      Logger.info(`[LocationService] Auto-stop scheduled in ${Math.round(stopDelay / 60000)}m`);

      this.timerManager.schedule('auto-stop', stopDelay, async () => {
        Logger.info('[LocationService] Schedule ended - stopping monitoring');
        await this.syncGeofences();
      });
    }
  }

  /**
   * Handle GPS location errors
   */
  private handleLocationError(error: any) {
    Logger.error('[LocationService] GPS Error:', {
      code: error.code,
      message: error.message,
    });

    let userMessage = 'Location tracking issue detected.';
    let shouldStopMonitoring = false;

    switch (error.code) {
      case 1: // PERMISSION_DENIED
        userMessage = 'Location permission denied. Please enable in settings.';
        shouldStopMonitoring = true;
        break;

      case 2: // POSITION_UNAVAILABLE
        userMessage = 'GPS signal unavailable. Ensure GPS is enabled.';
        break;

      case 3: // TIMEOUT
        userMessage = 'GPS timeout. This is normal indoors or in poor signal areas.';
        break;

      default:
        userMessage = `GPS error (code ${error.code}). Will retry automatically.`;
    }

    if (shouldStopMonitoring) {
      notificationManager.showNotification('Location Tracking Stopped', userMessage, 'gps-error');
      this.stopGeofenceMonitoring();
      Logger.error('[LocationService] Stopped monitoring due to critical GPS error');
    } else {
      Logger.warn(`[LocationService] Temporary GPS error: ${userMessage}`);
    }
  }

  /**
   * Process location update with smart detection
   */
  private async processLocationUpdate(location: LocationState) {
    if (!this.realm || this.realm.isClosed) return;

    // Prevent concurrent processing
    if (this.isChecking) {
      Logger.info('[LocationService] Already checking location, skipping');
      return;
    }

    this.isChecking = true;

    try {
      // Validate location quality
      const quality = LocationValidator.validateLocationQuality(location);
      if (!quality.valid) {
        Logger.warn(`[LocationService] Poor location quality: ${quality.reason}`);
        return;
      }

      this.lastKnownLocation = location;

      Logger.info(
        `[LocationService] Location: ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}, ` +
        `accuracy: ${location.accuracy.toFixed(1)}m`
      );

      // Determine inside places
      const insidePlaceIds = LocationValidator.determineInsidePlaces(location, this.realm);

      // Resolve IDs to Place objects
      const insidePlaces = insidePlaceIds
        .map((id) => PlaceService.getPlaceById(this.realm!, id))
        .filter((p) => p !== null);

      // Get active places for schedule cleanup checks
      const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
      const { activePlaces } = ScheduleManager.categorizeBySchedule(enabledPlaces);

      Logger.info(`[LocationService] Inside: ${insidePlaceIds.join(', ') || 'none'}`);

      await this.validateCurrentCheckIns(
        location.latitude,
        location.longitude,
        location.accuracy,
        activePlaces
      );

      await this.handleScheduleCleanup(activePlaces);
      await this.handleNewEntries(insidePlaces);

      // Schedule auto-stop when schedule ends
      this.scheduleAutoStop(activePlaces);
    } catch (error) {
      Logger.error('[LocationService] Error processing location:', error);
    } finally {
      this.isChecking = false;
    }
  }

  private async validateCurrentCheckIns(
    latitude: number,
    longitude: number,
    accuracy: number,
    activePlaces: any[]
  ) {
    if (!this.realm) return;

    const activeLogs = Array.from(CheckInService.getActiveCheckIns(this.realm));
    const activePlaceIds = new Set(activePlaces.map((p: any) => p.id));

    for (const log of activeLogs) {
      const placeId = log.placeId as string;
      const place = PlaceService.getPlaceById(this.realm, placeId);

      if (!place || !activePlaceIds.has(placeId)) {
        await this.handleGeofenceExit(placeId, true);
        continue;
      }

      const distance = LocationValidator.calculateDistance(
        latitude,
        longitude,
        (place as any).latitude as number,
        (place as any).longitude as number
      );

      const threshold = (place as any).radius * CONFIG.EXIT_BUFFER_MULTIPLIER;
      const isSmallRadius = (place as any).radius < CONFIG.SCHEDULE.SMALL_RADIUS_THRESHOLD;
      const effectiveThreshold = isSmallRadius ? threshold + 5 : threshold;

      const confidenceExit =
        distance > effectiveThreshold + accuracy || (accuracy < 50 && distance > effectiveThreshold);

      if (confidenceExit) {
        Logger.info(`[LocationService] EXIT: ${(place as any).name} (dist: ${Math.round(distance)}m)`);
        await this.handleGeofenceExit(placeId);
      }
    }
  }

  private async handleScheduleCleanup(activePlaces: any[]) {
    if (!this.realm) return;

    const activePlaceIds = new Set(activePlaces.map((p: any) => p.id));
    const activeLogs = Array.from(CheckInService.getActiveCheckIns(this.realm));

    for (const log of activeLogs) {
      if (!activePlaceIds.has(log.placeId as string)) {
        Logger.info(`[LocationService] Schedule ended: ${log.placeId}`);
        await this.handleGeofenceExit(log.placeId as string, true);
      }
    }
  }

  private async handleNewEntries(insidePlaces: any[]) {
    if (!this.realm) return;

    for (const place of insidePlaces) {
      if (!CheckInService.isPlaceActive(this.realm, (place as any).id as string)) {
        Logger.info(`[LocationService] ENTRY: ${(place as any).name}`);
        await this.handleGeofenceEntry((place as any).id as string);
      }
    }
  }

  /**
   * Handle geofence entry
   */
  private async handleGeofenceEntry(placeId: string) {
    const now = Date.now();
    const lastTime = this.lastTriggerTime[placeId] || 0;

    // Debounce
    if (now - lastTime < CONFIG.DEBOUNCE_TIME) {
      Logger.info(`[LocationService] Debouncing entry: ${placeId}`);
      return;
    }
    this.lastTriggerTime[placeId] = now;

    if (!this.realm) return;

    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !place.isEnabled) return;

    // CHECK STRICT SCHEDULE
    const currentSchedule = ScheduleManager.getCurrentOrNextSchedule(place);

    if (!currentSchedule) {
      // 24/7 Place (No schedule)
      await silentZoneManager.activateSilentZone(place);
      return;
    }

    const startTime = currentSchedule.startTime.getTime();
    const endTime = currentSchedule.endTime.getTime();

    // 1. EARLY ARRIVAL CHECK
    if (now < startTime) {
      const msUntilStart = startTime - now;
      Logger.info(
        `[LocationService] EARLY ARRIVAL: ${place.name}. Waiting ${Math.round(msUntilStart / 1000)}s`
      );

      // Schedule timer to silence exactly at start time (only if within 60s)
      if (msUntilStart <= 60000) {
        this.timerManager.schedule(`start-${placeId}`, msUntilStart, async () => {
          Logger.info(`[LocationService] Strict timer fired for ${placeId}`);
          await this.handleGeofenceEntry(placeId);
        });
      }
      return;
    }

    // 2. LATE ARRIVAL / ALREADY ENDED CHECK
    if (now >= endTime) {
      Logger.info(`[LocationService] Schedule ended for ${place.name}, ignoring entry`);
      return;
    }

    // 3. ACTIVE SCHEDULE
    if (CheckInService.isPlaceActive(this.realm, placeId)) {
        Logger.info(`[LocationService] Place ${placeId} already active, skipping entry logic`);
        return;
    }

    await silentZoneManager.activateSilentZone(place);

    // Schedule strict end time
    const msUntilEnd = endTime - now;
    this.scheduleEndTimerForPlace(placeId, msUntilEnd);
  }

  /**
   * Handle geofence exit
   */
  private async handleGeofenceExit(placeId: string, force: boolean = false) {
    const now = Date.now();
    const lastTime = this.lastTriggerTime[placeId] || 0;

    // Debounce (unless forced)
    if (!force && now - lastTime < CONFIG.DEBOUNCE_TIME) {
      Logger.info(`[LocationService] Debouncing exit: ${placeId}`);
      return;
    }
    this.lastTriggerTime[placeId] = now;

    await silentZoneManager.handleExit(placeId, force);

    // Clear end timer for this place
    this.timerManager.clear(`end-${placeId}`);
  }

  /**
   * Schedule a timer to force exit silent zone at strict end time
   */
  private scheduleEndTimerForPlace(placeId: string, delay: number) {
    this.timerManager.clear(`end-${placeId}`);

    Logger.info(`[LocationService] Scheduled END timer for ${placeId} in ${Math.round(delay / 1000)}s`);

    this.timerManager.schedule(`end-${placeId}`, delay, async () => {
      Logger.info(`[LocationService] End time arrived for ${placeId}`);
      await this.handleGeofenceExit(placeId, true);
      await this.syncGeofences();
    });
  }

  /**
   * Force a location check immediately
   * Public API for external components
   */
  async forceLocationCheck(): Promise<void> {
    return gpsManager.forceLocationCheck(
      (location) => this.processLocationUpdate(location),
      (error) => this.handleLocationError(error),
      1,
      3
    );
  }

  destroy() {
    Logger.info('[LocationService] Destroying service');
    this.stopGeofenceMonitoring();

    if (this.restartCheckInterval) {
      clearInterval(this.restartCheckInterval);
      this.restartCheckInterval = null;
    }

    this.isReady = false;
    this.geofencesActive = false;
    this.lastKnownLocation = null;
    this.upcomingSchedules = [];
  }
}

export const locationService = new LocationService();
