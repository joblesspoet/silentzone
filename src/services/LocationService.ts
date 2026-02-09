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
import { notificationBus } from './NotificationEventBus';
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
  private completedVisits: Set<string> = new Set();

  // Timer management
  private timerManager = new TimerManager();

  // Service restart check
  private restartCheckInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Initialize the location service
   */
  async initialize(realmInstance: Realm) {
    // CRITICAL: If already initialized with the SAME realm, skip full restore
    if (this.isReady && this.realm === realmInstance) {
      Logger.info('[LocationService] Already initialized with this realm instance');
      return;
    }

    // CRITICAL: Always update the realm instance
    this.realm = realmInstance;
    silentZoneManager.setRealm(realmInstance);

    // CRITICAL: Always restore state from database
    await this.restoreStateFromDatabase();

    if (Platform.OS === 'android') {
      await notificationManager.createNotificationChannels();
    }

    // CRITICAL: We don't call syncGeofences here because setupReactiveSync 
    // will often trigger it via pref changes. One initial sync is enough.
    await this.syncGeofences();
    this.setupReactiveSync();
    this.setupServiceRestart();

    this.isReady = true;
    Logger.info('[LocationService] Service initialized fully');
  }

  /**
   * LIGHT INITIALIZATION (Background Only)
   * Sets up context without triggering global system resets or syncs.
   */
  async initializeLight(realmInstance: Realm) {
    this.realm = realmInstance;
    silentZoneManager.setRealm(realmInstance);
    
    // Set ready but SKIP full sync/restore tasks
    this.isReady = true;
    Logger.info('[LocationService] Light initialization complete (Background context)');
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
        const currentSchedule = ScheduleManager.getCurrentOrNextSchedule(place);
        if (currentSchedule && now >= currentSchedule.startTime && now < currentSchedule.endTime) {
          if (!this.isVisitCompleted((place as any).id, currentSchedule)) {
            foundActiveWindow = true;
            Logger.info(`[Restore] Currently in active window: ${(place as any).name}`);
            break;
          } else {
            Logger.info(`[Restore] Already completed visit for ${(place as any).name} in this window`);
          }
        }
      }

      this.isInScheduleWindow = foundActiveWindow;

      // 4. Restore timers for active check-ins
      await this.restoreActiveTimers();

      // 5. SURGICAL RESTORE: Only fill gaps for missed or upcoming alarms
      if (enabledPlaces.length > 0) {
        Logger.info('[Restore] Performing surgical gap-filling restore...');
        await alarmService.restoreGapsOnBoot(enabledPlaces);
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
    } catch (error: any) {
      Logger.error('[Restore] Failed to restore state:', error?.message || error);
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
    if (!this.realm || this.realm.isClosed) {
      await notificationManager.stopForegroundService();
      return;
    }

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    const enabledPlaces = PlaceService.getEnabledPlaces(this.realm);
    const { upcomingSchedules } = ScheduleManager.categorizeBySchedule(Array.from(enabledPlaces));

    const hasActiveWork = activeLogs.length > 0 || this.isInScheduleWindow;

    if (!hasActiveWork) {
      Logger.info('[LocationService] No active work left, stopping foreground service');
      await notificationManager.stopForegroundService();
      this.stopGeofenceMonitoring();
    } else {
      // Just update it instead of stopping
      await this.startForegroundService();
    }
  }

  /**
   * CRITICAL: Stop everything and restore phone state
   * Used when permissions are revoked or tracking is hard-disabled
   */
  async purgeAllTracking() {
    Logger.info('[LocationService] Purging all tracking states...');
    try {
      if (this.realm && !this.realm.isClosed) {
        // Restore sound for all potentially active zones
        await this.cleanupOnCrash();
        
        // Cancel ALL alarms
        const allPlaces = Array.from(PlaceService.getAllPlaces(this.realm));
        for (const place of allPlaces) {
          await alarmService.cancelAlarmsForPlace((place as any).id as string);
        }
      }
    } catch (error) {
      Logger.error('[LocationService] Purge failed:', error);
    } finally {
      this.geofencesActive = false;
      this.isReady = false;
      await Geofencing.removeAllGeofence();
    }
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
                  // Auto-enable doesn't need to reset alarms - place changes handle that
                  await this.syncGeofences(false);
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

            // Extract IDs of inserted and modified places for targeted alarm sync
            const affectedIds: string[] = [];
            changes.insertions.forEach(index => {
                const place = collection[index] as any;
                if (place?.id) affectedIds.push(place.id);
            });
            changes.newModifications.forEach(index => {
                const place = collection[index] as any;
                if (place?.id) affectedIds.push(place.id);
            });

            await this.syncGeofences(false, affectedIds);
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
          // Don't force alarm reset on preference changes - only sync geofences
          await this.syncGeofences(false);
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
  async syncGeofences(forceAlarmSync: boolean = false, specificPlaceIds?: string[]) {
    if (!this.realm || this.realm.isClosed || this.isSyncing) return;

    this.isSyncing = true;

    try {
      const trackingEnabled = this.isPreferenceTrackingEnabled();

      if (!trackingEnabled) {
        Logger.info('[LocationService] Tracking disabled globally');
        // CRITICAL FIX: Ensure active silences are checked out when tracking is disabled
        await this.handleManualDisableCleanup(new Set());
        
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
      
      // NARROW LOGIC: Only in window if we are SENSING (T-15) or ACTIVE
      const sensingThreshold = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES; 
      const isSensingSoon = upcomingSchedules.length > 0 && 
                           upcomingSchedules[0].minutesUntilStart <= sensingThreshold;
                           
      this.isInScheduleWindow = activePlaces.length > 0 || isSensingSoon;

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

        // Condition-based alarm sync (Targeted or Global)
        if (specificPlaceIds && specificPlaceIds.length > 0) {
            Logger.info(`[LocationService] Syncing alarms for specific places: ${specificPlaceIds.join(', ')}`);
            for (const id of specificPlaceIds) {
                const place = enabledPlaces.find((p: any) => p.id === id);
                if (place) await alarmService.scheduleAlarmsForPlace(place);
            }
        } else if (forceAlarmSync) {
            Logger.info('[LocationService] Forcing global alarm sync for all enabled places');
            for (const place of enabledPlaces) {
                await alarmService.scheduleAlarmsForPlace(place);
            }
        }

        // If we have places to monitor (active or sensing window), verify location immediately
        if (placesToMonitor.size > 0) {
          const deadline = this.calculateMaxEndTime(Array.from(placesToMonitor));
          Logger.info(`[LocationService] Monitoring active - Checking if already inside...`);
          await gpsManager.forceLocationCheck(
            (location) => this.processLocationUpdate(location),
            (error) => this.handleLocationError(error),
            1,
            3,
            deadline
          );
        }
      } else {
        // PASSIVE MODE - Only act if we were previously active or it's a fresh sync
        if (this.geofencesActive) {
          Logger.info('[LocationService] Entering passive mode (using alarms)');
          await this.handleManualDisableCleanup(new Set());
          await Geofencing.removeAllGeofence();
          await this.stopForegroundService();
          this.geofencesActive = false;
        }

        // Condition-based alarm sync (Targeted or Global)
        if (specificPlaceIds && specificPlaceIds.length > 0) {
            Logger.info(`[LocationService] Syncing alarms (passive) for specific places: ${specificPlaceIds.join(', ')}`);
            for (const id of specificPlaceIds) {
                const place = enabledPlaces.find((p: any) => p.id === id);
                if (place) await alarmService.scheduleAlarmsForPlace(place);
            }
        } else if (forceAlarmSync) {
            Logger.info('[LocationService] Forcing global (passive) alarm sync');
            for (const place of enabledPlaces) {
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
    } catch (error: any) {
      Logger.error('[LocationService] Sync failed:', error?.message || error);
    } finally {
      this.isSyncing = false;
      // Periodic cleanup of completed visits (keep only relevant ones)
      this.cleanupCompletedVisits();
    }
  }

  /**
   * Cleanup completed visits that are in the past
   */
  private cleanupCompletedVisits() {
    const now = Date.now();
    const toRemove: string[] = [];
    
    this.completedVisits.forEach(key => {
      try {
        const parts = key.split('-');
        if (parts.length < 2) return;
        const startTime = new Date(parts[1]).getTime();
        // If the schedule start was more than 24 hours ago, definitely safe to remove
        if (now - startTime > 24 * 60 * 60 * 1000) {
          toRemove.push(key);
        }
      } catch (e) {}
    });

    toRemove.forEach(key => this.completedVisits.delete(key));
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
   * START active prayer session (T-5 to End)
   * High-frequency GPS monitoring
   */
  private async startActivePrayerSession(placeId: string, prayerIndex: number, deadline?: number) {
    Logger.info(`[Session] Starting active session for ${placeId} (Prayer #${prayerIndex})`);
    
    // 1. Ensure foreground service is running for high priority
    await this.startForegroundService();
    
    // 2. Start high-frequency GPS watcher (Uber-style)
    // We pass a custom config for higher frequency
    await gpsManager.startWatching(
      (location) => this.processLocationUpdate(location),
      (error) => this.handleLocationError(error),
      deadline,
      {
        interval: 30000, // 30 seconds
        fastestInterval: 15000,
        distanceFilter: 10,
      }
    );

    this.geofencesActive = true;
    Logger.info(`[Session] High-frequency GPS active for ${placeId}`);
  }

  /**
   * STOP active prayer session (End-time)
   */
  private async stopActivePrayerSession(placeId: string) {
    Logger.info(`[Session] Stopping active session for ${placeId}`);
    
    // 1. Force checkout
    await this.handleGeofenceExit(placeId, true);
    
    // 2. Stop GPS and cleanup
    this.stopGeofenceMonitoring();
    this.geofencesActive = false;
    
    // 3. Stop foreground service if no other sessions active
    // (In a multi-place scenario, we'd check if others are active, 
    // but stopForegroundService is safe to call as it updates notifications)
    await this.stopForegroundService();
    
    Logger.info(`[Session] Active session stopped for ${placeId}`);
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
      const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
      if (schedule && now >= schedule.startTime && now < schedule.endTime) {
        if (!this.isVisitCompleted((place as any).id, schedule)) {
          Logger.info(`[Monitor Check] ACTIVE NOW: ${(place as any).name}`);
          return true;
        } else {
          Logger.info(`[Monitor Check] Already completed visit for ${(place as any).name}`);
          continue;
        }
      }
      
      // If no schedules, it's a 24/7 place - ALWAYS active
      if (!(place as any).schedules || (place as any).schedules.length === 0) {
        Logger.info(`[Monitor Check] 24/7 Place: ${(place as any).name}`);
        return true;
      }
    }

    // Check if we have an upcoming schedule soon
    if (upcomingSchedules.length > 0) {
      const nextSchedule = upcomingSchedules[0];
      
      // Skip if already completed
      if (this.isVisitCompleted(nextSchedule.placeId, nextSchedule)) {
         Logger.info(`[Monitor Check] Upcoming ${nextSchedule.placeName} already completed`);
      } else {
        const safetyThreshold = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES; // Align with T-15 alarm

        if (nextSchedule.minutesUntilStart <= safetyThreshold) {
          Logger.info(
            `[Monitor Check] UPCOMING: ${nextSchedule.placeName} in ${nextSchedule.minutesUntilStart} min`
          );
          return true;
        }
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
   * Helper to determine if a visit was already completed (memory or DB)
   */
  private isVisitCompleted(placeId: string, schedule: UpcomingSchedule): boolean {
    const visitKey = `${placeId}-${schedule.startTime.toISOString()}`;
    if (this.completedVisits.has(visitKey)) return true;

    // Persistent check: Do we have a checkout for this place in this window?
    if (this.realm && !this.realm.isClosed) {
      const recentCheckIns = Array.from(CheckInService.getCheckInsForPlace(this.realm, placeId));
      if (recentCheckIns.length > 0) {
        const lastLog = recentCheckIns[0] as any;
        if (lastLog.checkOutTime) {
          // If checked in during this schedule window and already checked out
          const checkInTime = new Date(lastLog.checkInTime).getTime();
          const winStart = schedule.startTime.getTime();
          const winEnd = schedule.endTime.getTime();
          
          if (checkInTime >= winStart && checkInTime < winEnd) {
             // Synchronize our session-based cache
             this.completedVisits.add(visitKey);
             return true;
          }
        }
      }
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
      const now = Date.now();
      const scheduledTimeStr = data?.notification?.data?.scheduledTime || 'unknown';
      const scheduledDiff = scheduledTimeStr !== 'unknown' 
        ? Math.round((now - new Date(scheduledTimeStr).getTime()) / 1000)
        : 0;

      Logger.info(`[LocationService] Processing alarm: ${alarmId} (fired ${scheduledDiff}s after scheduled)`, data);

      await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));

      if (!this.realm || this.realm.isClosed) {
        Logger.error('[LocationService] Cannot process alarm: realm not ready');
        return;
      }

      const action = data?.notification?.data?.action || data?.action;
      const placeId = data?.notification?.data?.placeId || data?.placeId;
      const prayerIndex = data?.notification?.data?.prayerIndex;
      const subType = data?.notification?.data?.subType;

      if (!placeId) {
        Logger.error('[LocationService] Alarm fired without placeId, skipping');
        return;
      }

      // --- STALE ALARM PROTECTION ---
      // If the alarm is more than 5 minutes off (late or early), it's likely 
      // a "ghost" alarm or for a different day. Ignore it.
      if (Math.abs(scheduledDiff) > 300) {
        Logger.warn(`[LocationService] Ignoring STALE/MISALIGNED alarm: ${alarmId} (${scheduledDiff}s diff)`);
        return;
      }

      const place = PlaceService.getPlaceById(this.realm, placeId);
      if (!place) {
        Logger.error(`[LocationService] Place ${placeId} not found for alarm`);
        return;
      }

      // --- SURGICAL LOGIC SELECTION ---
      
      // --- SELF-HEALING TRIGGER (Trigger-time Healing) ---
      // Every alarm (T-15, T-5, End) now acts as a safety check to seed tomorrow's slots
      // if they are missing. This fixes the "Broken Chain" issue.
      if (place.isEnabled) {
        await alarmService.scheduleAlarmsForPlace(place);
      }

      if (subType === 'notify') {
        Logger.info(`[Surgical] Pre-activation Notification check for ${place.name}`);
        
        // Only notify if user is distant (saving them from surprise silence)
        const location = await this.getQuickLocation();
        if (location) {
          const distance = LocationValidator.calculateDistance(
            location.latitude,
            location.longitude,
            (place as any).latitude,
            (place as any).longitude
          );

          if (distance > (place as any).radius + CONFIG.GEOFENCE_RADIUS_BUFFER) {
            Logger.info(`[Surgical] User is far (${Math.round(distance)}m), sending pre-notification`);
            notificationBus.emit({
              type: 'SCHEDULE_APPROACHING',
              placeId,
              placeName: (place.name as string) || 'Unknown Place',
              timestamp: Date.now(),
              source: 'alarm'
            });
          } else {
            Logger.info(`[Surgical] User is already close (${Math.round(distance)}m), skipping pre-notification`);
          }
        } else {
          Logger.warn('[Surgical] Could not get location for T-15 check, skipping pre-notification');
        }
      } 
      else if (subType === 'monitor') {
        Logger.info(`[Surgical] Activation Session Start for ${place.name}`);
        
        // ALWAYS start monitoring at T-0, regardless of distance
        // This ensures check-in works even if user is arriving during the gap
        const deadline = this.calculateDeadlineForPlace(placeId);
        await this.startActivePrayerSession(placeId, prayerIndex, deadline);
      } 
      else if (subType === 'cleanup') {
        Logger.info(`[Surgical] End-time Cleanup for ${place.name}`);
        
        // Only notify if we were actually active in this place
        if (CheckInService.isPlaceActive(this.realm, placeId)) {
          Logger.info(`[Surgical] Emitting SCHEDULE_END for active place ${place.name}`);
          notificationBus.emit({
            type: 'SCHEDULE_END',
            placeId,
            placeName: (place.name as string) || 'Unknown Place',
            timestamp: Date.now(),
            source: 'alarm'
          });
        }
        
        await this.stopActivePrayerSession(placeId);
      }
      else {
        // Fallback for legacy alarms
        Logger.info(`[LocationService] Legacy alarm action: ${action}`);
        if (action === ALARM_ACTIONS.STOP_SILENCE) {
          await this.handleGeofenceExit(placeId, true);
        } else {
          // If it's a legacy start alarm, we still need sync for now
          await this.syncGeofences(true);
        }
      }

      Logger.info(`[LocationService] Alarm ${alarmId} processed successfully`);
    } catch (error) {
      Logger.error('[LocationService] Error processing alarm:', error);
    } finally {
      this.isProcessingAlarm = false;

      const queue = this.alarmQueue as any[];
      if (queue.length > 0) {
        const nextAlarm = queue.shift();
        Logger.info(`[LocationService] Processing queued alarm (${queue.length} remaining)`);
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
      // Validate location quality using config threshold
      const quality = LocationValidator.validateLocationQuality(
        location, 
        CONFIG.MAX_ACCEPTABLE_ACCURACY
      );
      
      if (!quality.valid) {
        Logger.warn(`[LocationService] Skipping location update: ${quality.reason}`);
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

    if (!this.realm) return;

    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !place.isEnabled) return;

    // CHECK STRICT SCHEDULE
    const currentSchedule = ScheduleManager.getCurrentOrNextSchedule(place);

    if (!currentSchedule) {
      // 24/7 Place (No schedule)
      this.lastTriggerTime[placeId] = now; // Action taken
      await silentZoneManager.activateSilentZone(place);
      return;
    }

    const startTime = currentSchedule.startTime.getTime();
    const endTime = currentSchedule.endTime.getTime();

    // 1. EARLY ARRIVAL CHECK
    // Allow auto-silence up to 1 minute early for a smooth transition
    if (now < startTime - (60 * 1000)) {
      const msUntilStart = startTime - now;
      Logger.info(
        `[LocationService] EARLY ARRIVAL: ${place.name}. Waiting ${Math.round(msUntilStart / 1000)}s`
      );

      // IMPORTANT: We do NOT update lastTriggerTime here, so that the 
      // actual start alarm (3s later) can still fire without being debounced.

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
      this.lastTriggerTime[placeId] = now; // Mark as processed
      Logger.info(`[LocationService] Schedule ended for ${place.name}, ignoring entry`);
      return;
    }

    // 3. ACTIVE SCHEDULE - Activate silent zone
    // Only update lastTriggerTime when we actually ATTEMPT activation
    this.lastTriggerTime[placeId] = now;
    await silentZoneManager.activateSilentZone(place);

    // NO-OP: We do NOT schedule an end timer here for scheduled places.
    // AlarmService handles the 'cleanup' alarm which triggers termination.
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

    // MARK VISIT AS COMPLETED
    // This prevents the "Monitoring" notification from reappearing immediately
    // after an early exit until the next schedule window.
    if (!force) {
      const place = this.realm ? PlaceService.getPlaceById(this.realm, placeId) : null;
      const schedule = place ? ScheduleManager.getCurrentOrNextSchedule(place) : null;
      if (schedule) {
        const visitKey = `${placeId}-${schedule.startTime.toISOString()}`;
        this.completedVisits.add(visitKey);
        Logger.info(`[LocationService] Visit marked as completed: ${visitKey}`);
      }
    }

    // Clear end timer for this place
    this.timerManager.clear(`end-${placeId}`);
  }

  /**
   * Schedule a timer to force exit silent zone at strict end time
   */
  private scheduleEndTimerForPlace(placeId: string, delay: number) {
    if (!this.realm) return;
  
    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place) return;
  
    // Only schedule manual end timer for 24/7 places (no schedules)
    const schedules = (place as any).schedules || [];
    if (schedules.length > 0) {
      Logger.info(`[LocationService] Skipping end timer for ${placeId} - AlarmService handles scheduled ends`);
      return;
    }

    this.timerManager.clear(`end-${placeId}`);
    Logger.info(`[LocationService] Scheduled END timer for 24/7 place ${placeId} in ${Math.round(delay / 1000)}s`);

    this.timerManager.schedule(`end-${placeId}`, delay, async () => {
      Logger.info(`[LocationService] End time arrived for 24/7 place ${placeId}`);
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

  /**
   * Get a single location update quickly for decision making
   */
  private async getQuickLocation(): Promise<LocationState | null> {
    try {
      return await new Promise((resolve) => {
        gpsManager.forceLocationCheck(
          (location) => resolve(location),
          (error) => {
            Logger.warn(`[LocationService] Quick location fail: ${error.message}`);
            resolve(null);
          },
          3, // Strengthened for background cold-starts
          3  // 3 attempts
        );
      });
    } catch (error) {
      return null;
    }
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
