import Geofencing from '@rn-org/react-native-geofencing';

import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import {  Preferences } from '../database/services/PreferencesService';
import { CheckInService } from '../database/services/CheckInService';
import { Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import RingerMode, { RINGER_MODE } from '../modules/RingerMode';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { NativeModules } from 'react-native';
import { Logger } from './Logger';
import { ScheduleManager, UpcomingSchedule } from './ScheduleManager';
import { LocationValidator, LocationState } from './LocationValidator';
import { alarmService, ALARM_ACTIONS } from './AlarmService';
import { notificationManager } from './NotificationManager';


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
import { CONFIG } from '../config/config';

// Removed dual-alarm system - now using individual alarms per schedule
// Alarm IDs format: place-{placeId}-schedule-{index}


// LocationState and UpcomingSchedule interfaces removed (imported)

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
  private watchId: number | null = null;
  
  // Schedule tracking
  private upcomingSchedules: UpcomingSchedule[] = [];
  private isInScheduleWindow = false;
  private scheduleEndTimer: ReturnType<typeof setTimeout> | null = null;
  // NEW: timer maps for specific places
  // NEW: timer maps for specific places
  private startTimers: { [key: string]: ReturnType<typeof setTimeout> } = {};
  private endTimers: { [key: string]: ReturnType<typeof setTimeout> } = {};
  
  private nextAlarmScheduled = false;

  private restartCheckInterval: ReturnType<typeof setInterval> | null = null;
  private gpsVerificationTimeout: ReturnType<typeof setTimeout> | null = null;

  /**
   * Initialize the location service
   */
  async initialize(realmInstance: Realm) {
    // CRITICAL: Always update the realm instance
    // Background alarms open a new realm, so we must update it even if already initialized
    this.realm = realmInstance;
    
    // CRITICAL: Always restore state from database
    // This handles process death and alarm wake-ups
    await this.restoreStateFromDatabase();

    if (this.isReady) {
      Logger.info('[LocationService] Re-initializing with new realm instance');
      // Re-sync with the new realm data to pick up any schedule changes
      await this.syncGeofences();
      return;
    }


    if (Platform.OS === 'android') {
      await notificationManager.createNotificationChannels();
    }

    await this.syncGeofences();
    this.setupReactiveSync();
    
    // Setup service restart mechanism
    this.setupServiceRestart();

    this.isReady = true;
    Logger.info('[LocationService] ✅ Service initialized');
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

    Logger.info('[Restore] 🔄 Restoring state from database...');

    try {
      // 1. Restore active check-ins
      const activeLogs = CheckInService.getActiveCheckIns(this.realm);
      Logger.info(`[Restore] Found ${activeLogs.length} active check-in(s)`);

      // 2. Recalculate upcoming schedules
      const enabledPlaces = PlaceService.getEnabledPlaces(this.realm);
      const { upcomingSchedules } = ScheduleManager.categorizeBySchedule(Array.from(enabledPlaces));
      this.upcomingSchedules = upcomingSchedules;
      Logger.info(`[Restore] Found ${this.upcomingSchedules.length} upcoming schedule(s)`);

      // 3. Determine if we're currently in a schedule window
      const now = new Date();
      
      let foundActiveWindow = false;
      for (const place of enabledPlaces) {
        const schedules = (place as any).schedules || [];
        for (const schedule of schedules) {
          const isActive = ScheduleManager.isScheduleActiveNow(schedule, now);
          if (isActive) {
            foundActiveWindow = true;
            Logger.info(`[Restore] ✅ Currently in active window: ${(place as any).name}`);
            break;
          }
        }
        if (foundActiveWindow) break;
      }
      
      this.isInScheduleWindow = foundActiveWindow;

      // 4. Restore timers for active check-ins (schedule end timers)
      await this.restoreActiveTimers();

      Logger.info('[Restore] ✅ State restoration complete', {
        activeCheckIns: activeLogs.length,
        upcomingSchedules: this.upcomingSchedules.length,
        isInScheduleWindow: this.isInScheduleWindow
      });

    } catch (error) {
      Logger.error('[Restore] Failed to restore state:', error);
    }
  }





  /**
   * Start foreground service
   */

  /**
   * Schedule a cleanup check for when current schedule ends
   */
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
      Logger.error('[LocationService] ❌ Aborting start: Missing critical permissions in background');
      await notificationManager.showNotification(
        'Setup Required',
        'Silent Zone failed to start. Please open app and check permissions.',
        'permission-failure'
      );
      return; 
    }

    // Gather state for notification
    const enabledPlaces = this.realm ? PlaceService.getEnabledPlaces(this.realm) : [];
    const enabledCount = enabledPlaces.length;
    const activeCheckIns = this.realm ? CheckInService.getActiveCheckIns(this.realm) : [];
    
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
   * Restore timers for active check-ins (e.g. after restart)
   */
  private async restoreActiveTimers() {
    if (!this.realm || this.realm.isClosed) return;

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    Logger.info(`[LocationService] Restoring timers for ${activeLogs.length} active sessions`);

    for (const log of activeLogs) {
      const placeId = log.placeId as string;
      // Skip if we already have a timer
      if (this.endTimers[placeId]) continue;

      const place = PlaceService.getPlaceById(this.realm, placeId);
      if (!place) continue;

      const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
      if (schedule) {
        const endTime = schedule.endTime.getTime();
        const now = Date.now();
        
        if (now >= endTime) {
           // Should have ended!
           Logger.info(`[LocationService] Found expired session for ${place.name}, ending now`);
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

    // Set up restart on kill
    const restartInterval = setInterval(() => {
      if (this.watchId === null && this.geofencesActive) {
        Logger.info('[LocationService] ⚠️ Service appears stopped, restarting');
        this.startGeofenceMonitoring();
      }
    }, 60000); // Check every minute

    // Store reference for cleanup
    this.restartCheckInterval = restartInterval;
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

      const activeLogs = CheckInService.getActiveCheckIns(this.realm);
      
      if (activeLogs.length > 0) {
        Logger.info(`[LocationService] Restoring sound for ${activeLogs.length} active locations`);
        
        for (const log of activeLogs) {
          try {
            await this.restoreRingerMode(log.id as string);
            CheckInService.logCheckOut(this.realm, log.id as string);
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

  // LocationService.ts - setupReactiveSync() method replacement

/**
 * Set up reactive database listeners - CRASH-SAFE VERSION
 */
private setupReactiveSync() {
  if (!this.realm || this.realm.isClosed) return;

  const places = this.realm.objects('Place');
  places.addListener((collection, changes) => {
    if (
      changes.insertions.length > 0 ||
      changes.deletions.length > 0 ||
      changes.newModifications.length > 0
    ) {
      Logger.info('[LocationService] Places changed, syncing');
      
      // Check if we should auto-enable tracking
      const enabledPlaces = Array.from(collection).filter((p: any) => p.isEnabled);
      
      if (enabledPlaces.length > 0) {
        const prefs = this.realm!.objectForPrimaryKey('Preferences', 'USER_PREFS') as any;
        if (prefs && !prefs.trackingEnabled) {
          Logger.info('[LocationService] ✅ Auto-enabling tracking (places added)');
          
          // Enable tracking and wait for it to complete
         this.realm!.write(() => {
            prefs.trackingEnabled = true;
          });
          
          // Wait longer for all listeners to process
          setTimeout(() => {
            Logger.info('[LocationService] Syncing after tracking enabled');
            this.syncGeofences();
          }, 300);
          
          return; // Don't sync immediately
        }
      }
      
      // If no enabled places, auto-disable tracking
      if (enabledPlaces.length === 0) {
        const prefs = this.realm!.objectForPrimaryKey('Preferences', 'USER_PREFS') as any;
        if (prefs && prefs.trackingEnabled) {
          Logger.info('[LocationService] ❌ Auto-disabling tracking (no enabled places)');
          this.realm!.write(() => {
            prefs.trackingEnabled = false;
          });
        }
      }

      this.syncGeofences();
    }
  });

  // Listen for CheckInLog changes to update notification
  const checkIns = this.realm.objects('CheckInLog');
  checkIns.addListener((collection, changes) => {
    if (changes.insertions.length > 0 || changes.deletions.length > 0) {
      Logger.info('[LocationService] CheckIns changed, updating notification');
      this.startForegroundService();
    }
  });

  const prefs = this.realm.objectForPrimaryKey<Preferences>('Preferences', 'USER_PREFS');
  if (prefs) {
    prefs.addListener(() => {
      Logger.info('[LocationService] Preferences changed, syncing');
      this.syncGeofences();
    });
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
        // Cancel alarms for ALL places (since everything is paused)
        const allPlaces = Array.from(PlaceService.getAllPlaces(this.realm));
        for (const place of allPlaces) {
             await alarmService.cancelAlarmsForPlace(place.id as string);
        }
        await this.stopForegroundService();
        await Geofencing.removeAllGeofence();
        this.geofencesActive = false;
        return;
      }

      // CRITICAL FIX: Get ALL places first to cleanup disabled ones
      const allPlaces = Array.from(PlaceService.getAllPlaces(this.realm));
      const enabledPlaces = allPlaces.filter((p: any) => p.isEnabled);

      // Cleanup alarms for DISABLED places (Paused)
      const disabledPlaces = allPlaces.filter((p: any) => !p.isEnabled);
      for (const place of disabledPlaces) {
          await alarmService.cancelAlarmsForPlace(place.id as string);
      }
      
      const { activePlaces, upcomingSchedules } = ScheduleManager.categorizeBySchedule(enabledPlaces);
      this.upcomingSchedules = upcomingSchedules;
      this.isInScheduleWindow = activePlaces.length > 0 && upcomingSchedules.length > 0;

      // NEW: Smart decision logic
      const shouldMonitor = this.shouldStartMonitoring(activePlaces, upcomingSchedules);

      // Log next schedule if any
      if (upcomingSchedules.length > 0) {
        const next = upcomingSchedules[0];
        Logger.info(
          `[LocationService] Next schedule: ${next.placeName} in ${next.minutesUntilStart} minutes (Starts at ${next.startTime.toLocaleTimeString()})`
        );
      } else {
        Logger.info('[LocationService] No upcoming schedules found in categorization');
      }

      if (shouldMonitor) {
         // ACTIVE MONITORING
         await this.handleManualDisableCleanup(new Set(activePlaces.map(p => p.id as string)));
         await Geofencing.removeAllGeofence();
         this.geofencesActive = false;

         if (enabledPlaces.length === 0) {
           Logger.info('[LocationService] No locations to monitor');
           await this.stopForegroundService();
           return;
         }

         const hasPermissions = await PermissionsManager.hasCriticalPermissions();
         if (!hasPermissions) {
           Logger.warn('[LocationService] Missing required permissions');
           await this.stopForegroundService();
           return;
         }

         // Add geofences for currently active places AND upcoming pre-start places
         const placesToMonitor = new Set([...activePlaces]);
         
         // If we are monitoring because of an UPCOMING schedule (pre-start), add it too
         if (upcomingSchedules.length > 0) {
            const next = upcomingSchedules[0];
            if (next.minutesUntilStart <= CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES) {
                const place = enabledPlaces.find(p => p.id === next.placeId);
                if (place) placesToMonitor.add(place);
            }
         }

         for (const place of placesToMonitor) {
           await Geofencing.addGeofence({
             id: place.id as string,
             latitude: place.latitude as number,
             longitude: place.longitude as number,
             radius: Math.max(
               CONFIG.MIN_GEOFENCE_RADIUS,
               (place.radius as number) + CONFIG.GEOFENCE_RADIUS_BUFFER
             ),
           });
         }

         Logger.info(`[LocationService] Added ${placesToMonitor.size} geofences (Active + Upcoming)`);
         await this.startForegroundService();
         this.geofencesActive = true;
         
         // Even while monitoring, schedule next alarm for redundancy or next event
          // Schedule individual alarms for all enabled places
          for (const place of enabledPlaces) {
            if (place.isEnabled) {
              await alarmService.cancelAlarmsForPlace(place.id as string);
              await alarmService.scheduleAlarmsForPlace(place);
            }
          }


          // CRITICAL FIX: If we have active places, verify location immediately
          // This fixes the "Sitting at home" scenario where we don't cross boundary
          if (activePlaces.length > 0) {
              // Calculate the latest end time of all active schedules
              // We should retry checking location until this time (if needed)
              const now = new Date();
              let maxEndTime = 0;
              
              for (const place of activePlaces) {
                  // Find the active schedule for this place
                  if (place.schedules) {
                      for (const schedule of place.schedules) {
                           if (ScheduleManager.isScheduleActiveNow(schedule, now)) {
                               const [endHours, endMins] = schedule.endTime.split(':').map(Number);
                               const scheduleEnd = new Date(now);
                               scheduleEnd.setHours(endHours, endMins, 0, 0);
                               
                               // Handle overnight ending tomorrow (if end time is earlier than now, it might be +1 day, 
                               // but isScheduleActiveNow handles the logic. 
                               // Simplified: just ensure if end < now, it's tomorrow)
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

              Logger.info(`[LocationService] Active places detected (${activePlaces.length}) - Checking if already inside...`);
              Logger.info(`[LocationService] ⏳ Location check deadline: ${new Date(maxEndTime).toLocaleTimeString()}`);
              
              await this.forceLocationCheck(1, 3, maxEndTime);
          }

      } else {
         // PASSIVE MODE (Sleep & Alarm)
         Logger.info('[LocationService] 💤 Entering passive mode (using alarms)');
         
         // Ensure we cleanup any stuck checkins before sleeping if we are transitioning from active
          if (this.geofencesActive) {
             await this.handleManualDisableCleanup(new Set());
             await Geofencing.removeAllGeofence();
             this.geofencesActive = false;
          }
          
          await this.stopForegroundService();
          
          for (const place of enabledPlaces) {
            if (place.isEnabled) {
              await alarmService.cancelAlarmsForPlace(place.id as string);
              await alarmService.scheduleAlarmsForPlace(place);
            }
          }
      }
      
      // At the very end, add health check
      if (this.geofencesActive) {
        // Log system health for monitoring
        const diagnostics = await alarmService.getAlarmDiagnostics();
        
        Logger.info('[LocationService] System Health:', {
          gpsActive: this.geofencesActive,
          hasLocation: !!this.lastKnownLocation,
          isInScheduleWindow: this.isInScheduleWindow,
          upcomingSchedules: this.upcomingSchedules.length,
          totalAlarms: diagnostics.totalScheduled,
          nextAlarm: diagnostics.nextAlarmTime?.toLocaleString() || 'none'
        });
        
        // Warn if no alarms scheduled but in schedule window
        if (this.isInScheduleWindow && diagnostics.totalScheduled === 0) {
          Logger.warn('[LocationService] ⚠️ In schedule window but no alarms scheduled!');
        }
      }
      
    } catch (error) {
      Logger.error('[LocationService] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Get comprehensive system health status
   * Useful for debugging and user diagnostics screen
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
    
    // Check GPS
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
    
    // Check alarms
    const alarmDiag = await alarmService.getAlarmDiagnostics();
    
    if (this.isInScheduleWindow && alarmDiag.totalScheduled === 0) {
      issues.push('In schedule window but no alarms scheduled');
      status = 'error';
    }
    
    // Check tracking state
    const activeCheckIns = this.realm 
      ? CheckInService.getActiveCheckIns(this.realm).length
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
          next: alarmDiag.nextAlarmTime?.toLocaleString() || null
        },
        tracking: {
          enabled: this.geofencesActive,
          activeCheckIns,
          upcomingSchedules: this.upcomingSchedules.length
        },
        issues
      }
    };
  }



  private async handleManualDisableCleanup(enabledIdsSet: Set<string>) {
    if (!this.realm || this.realm.isClosed) return;

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    
    for (const log of activeLogs) {
      if (!enabledIdsSet.has(log.placeId as string)) {
        Logger.info(`[LocationService] Force checkout: ${log.placeId}`);
        await this.handleGeofenceExit(log.placeId as string, true);
      }
    }
  }

  /**
   * Start geofence monitoring with GPS verification
   * 
   * CRITICAL: Verifies GPS is actually working within 30 seconds
   * If no location updates arrive, stops monitoring and notifies user
   * 
   * @param deadline Optional timestamp. If provided, retries will stop after this time.
   */
  /**
   * Start geofence monitoring with GPS verification
   * 
   * CRITICAL: Verifies GPS is actually working within 30 seconds
   * If no location updates arrive, stops monitoring and notifies user
   * 
   * @param deadline Optional timestamp. If provided, retries will stop after this time.
   */
  private async startGeofenceMonitoring(deadline?: number) {
    if (this.geofencesActive) {
      Logger.info('[LocationService] Geofences already active');
      return;
    }
    
    // Clear any previous timeout
    this.stopGeofenceMonitoring();
    
    Logger.info('[LocationService] 🛰️ Starting geofence monitoring');
    
    // CRITICAL: Give Notifee time to promote app to Foreground Service
    await new Promise<void>(resolve => setTimeout(() => resolve(), 2000));
    
    this.geofencesActive = true;
    
    // Start watching position
    this.startWatcher();
    
    // CRITICAL: Set verification timeout
    // This ensures GPS is actually providing location updates
    
    // Retry Logic: 30s -> 60s -> 60s
    const verifyGPS = async (attemptNumber: number = 1, maxAttempts: number = 3) => {
      // CHECK DEADLINE
      if (deadline && Date.now() > deadline) {
          Logger.warn('[LocationService] ⏳ GPS verification skipped - Deadline passed (Schedule ended)');
          return;
      }
      
      const timeoutDuration = attemptNumber === 1 ? 30000 : 60000; // 30s first, then 60s
      
      Logger.info(
        `[LocationService] 🕒 GPS verification attempt ${attemptNumber}/${maxAttempts} ` +
        `(${timeoutDuration / 1000}s timeout)`
      );
      
      this.gpsVerificationTimeout = setTimeout(async () => {
        // Check if we've received any location updates
        if (!this.lastKnownLocation) {
          Logger.warn(
            `[LocationService] ⚠️ GPS verification attempt ${attemptNumber}/${maxAttempts} failed - ` +
            'No location updates yet'
          );
          
          // Should we retry?
          if (attemptNumber < maxAttempts) {
             // Check deadline again before retrying
             if (deadline && Date.now() > deadline) {
                  Logger.warn('[LocationService] ⏳ Stop retrying - Deadline passed');
                  return;
             }
          
            // YES - Try again
            Logger.info(`[LocationService] 🔄 Retrying GPS verification (attempt ${attemptNumber + 1}/${maxAttempts})...`);
            
            // Clear old timeout
            this.gpsVerificationTimeout = null;
            
            // Retry
            await verifyGPS(attemptNumber + 1, maxAttempts);
            
          } else {
            // NO - All attempts exhausted
            // FAIL OPEN: Do NOT stop monitoring. Just warn user.
            
            Logger.error(
              `[LocationService] ❌ GPS VERIFICATION FAILED - ` +
              `No location updates after ${maxAttempts} attempts`
            );
            
            // Notify user about the problem
            notificationManager.showNotification(
              'GPS Struggling',
              'GPS signal is weak, but we are still scanning for your location.',
              'gps-slow-start'
            );
            
            // 🔴 CRITICAL CHANGE: DON'T stop monitoring!
            // Keep trying in background - GPS might work later
            Logger.warn('[LocationService] ⚠️ GPS slow to start but continuing monitoring in background');
            
            // Clear the timeout reference
            this.gpsVerificationTimeout = null;
          }
          
        } else {
          // SUCCESS - GPS is working
          const age = Date.now() - this.lastKnownLocation.timestamp;
          Logger.info(
            `[LocationService] ✅ GPS verification passed on attempt ${attemptNumber} - ` +
            `location age: ${Math.round(age / 1000)}s`
          );
          
          // Clear the timeout reference
          this.gpsVerificationTimeout = null;
        }
      }, timeoutDuration);
    };

    // Start verification
    await verifyGPS(1, 3);
    
    Logger.info('[LocationService] Geofence monitoring started with verification');
  }

  private stopGeofenceMonitoring() {
    Logger.info('[LocationService] Stopping geofence monitoring');
    
    // Clear GPS verification timeout if active
    if (this.gpsVerificationTimeout) {
      clearTimeout(this.gpsVerificationTimeout);
      this.gpsVerificationTimeout = null;
      Logger.info('[LocationService] Cleared GPS verification timeout');
    }

    if (this.watchId !== null) {
      Geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    // NEW: Clear schedule end timer
    if (this.scheduleEndTimer) {
      clearTimeout(this.scheduleEndTimer);
      this.scheduleEndTimer = null;
    }
    
    // Clear all specific timers
    Object.values(this.startTimers).forEach(t => clearTimeout(t));
    this.startTimers = {};
    
    Object.values(this.endTimers).forEach(t => clearTimeout(t));
    this.endTimers = {};
  }

  /**
   * Determine if we should start monitoring NOW
   * Checks both current active windows AND upcoming schedules
   */
  private shouldStartMonitoring(activePlaces: any[], upcomingSchedules: any[]): boolean {
    if (!this.realm) {
      Logger.warn('[Monitor Check] Realm not ready');
      return false;
    }

    const now = new Date();
    const enabledPlaces = PlaceService.getEnabledPlaces(this.realm);

    if (enabledPlaces.length === 0) {
      Logger.info('[Monitor Check] No enabled places');
      return false;
    }

    // CRITICAL CHECK #1: Are we CURRENTLY inside an active schedule window?
    for (const place of enabledPlaces) {
      const schedules = (place as any).schedules || [];
      
      for (const schedule of schedules) {
        const isActive = ScheduleManager.isScheduleActiveNow(schedule, now);
        
        if (isActive) {
          Logger.info(`[Monitor Check] ✅ ACTIVE NOW: ${(place as any).name}`);
          return true; // Should monitor
        }
      }
    }

    // CRITICAL CHECK #2: Do we have an upcoming schedule soon?
    // We can use the passed upcomingSchedules which are already calculated
    if (upcomingSchedules.length > 0) {
      const nextSchedule = upcomingSchedules[0];
      const safetyThreshold = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES + 5; // 20 minutes
      
      if (nextSchedule.minutesUntilStart <= safetyThreshold) {
        Logger.info(
          `[Monitor Check] ✅ UPCOMING: ${nextSchedule.placeName} in ${nextSchedule.minutesUntilStart} min (<= ${safetyThreshold}m)`
        );
        return true;
      }
      
      Logger.info(
        `[Monitor Check] ⏸️ WAITING: Next schedule (${nextSchedule.placeName}) ` +
        `in ${nextSchedule.minutesUntilStart} min (> ${safetyThreshold} min threshold)`
      );
    } else {
      Logger.info('[Monitor Check] No upcoming schedules found');
    }

    return false;
  }





  /**
  /**
   * Handle alarm fired event - THREAD SAFE with queue
   * Prevents race conditions from multiple simultaneous alarms
   */
  async handleAlarmFired(data: any) {
    const alarmId = data?.notification?.id || 'unknown';
    
    // Check if already processing an alarm
    if (this.isProcessingAlarm) {
      Logger.warn(`[LocationService] Alarm ${alarmId} queued (already processing)`);
      this.alarmQueue.push(data);
      return;
    }

    this.isProcessingAlarm = true;
    
    try {
      Logger.info(`[LocationService] 🎯 Processing alarm: ${alarmId}`, data);
      
      // Small delay to ensure Realm is fully ready
      await new Promise<void>(resolve => setTimeout(() => resolve(), 500));
      
      if (!this.realm || this.realm.isClosed) {
        Logger.error('[LocationService] Cannot process alarm: realm not ready');
        return;
      }

      const action = data?.notification?.data?.action || data?.action;
      
      if (action === ALARM_ACTIONS.START_MONITORING) {
        Logger.info('[LocationService] 🟡 Pre-activation alarm (15min before)');
      } else if (action === ALARM_ACTIONS.START_SILENCE) {
        Logger.info('[LocationService] 🔴 Activation alarm (exact time)');
      } else if (action === ALARM_ACTIONS.STOP_SILENCE) {
        Logger.info('[LocationService] 🟢 Deactivation alarm (end time)');
      }

      // Execute sync
      await this.syncGeofences();

      // If this was a START_SILENCE alarm, force immediate check
      // This handles the "User is already here" case
      if (action === ALARM_ACTIONS.START_SILENCE) {
         // Extract the place ID and calculate the schedule end time
         const placeId = data?.notification?.data?.placeId || data?.placeId;
         let deadline: number | undefined;
         
         if (placeId) {
            const place = PlaceService.getPlaceById(this.realm, placeId);
            if (place && (place as any).schedules) {
               const now = new Date();
               // Find the currently active schedule for this place
               for (const schedule of (place as any).schedules) {
                  if (ScheduleManager.isScheduleActiveNow(schedule, now)) {
                     const [endHours, endMins] = schedule.endTime.split(':').map(Number);
                     const scheduleEnd = new Date(now);
                     scheduleEnd.setHours(endHours, endMins, 0, 0);
                     
                     // Handle overnight schedules (if end time is earlier than now, it's tomorrow)
                     if (scheduleEnd.getTime() < now.getTime()) {
                        scheduleEnd.setDate(scheduleEnd.getDate() + 1);
                     }
                     
                     deadline = scheduleEnd.getTime();
                     Logger.info(`[LocationService] ⏳ Force check deadline: ${scheduleEnd.toLocaleTimeString()}`);
                     break;
                  }
               }
            }
         }
         
         await this.forceLocationCheck(1, 3, deadline);
      }

      // If this was a STOP_SILENCE alarm, force exit
      if (action === ALARM_ACTIONS.STOP_SILENCE) {
        Logger.info('[LocationService] 🎯 STOP_SILENCE: Forcing check-out of all zones');
        const placeId = data?.notification?.data?.placeId || data?.placeId;
        if (placeId) {
          await this.handleGeofenceExit(placeId, true);
        }
      }

      Logger.info(`[LocationService] ✅ Alarm ${alarmId} processed successfully`);

    } catch (error) {
      Logger.error('[LocationService] Error processing alarm:', error);
    } finally {
      this.isProcessingAlarm = false;
      
      // Process next queued alarm if any
      if (this.alarmQueue.length > 0) {
        const nextAlarm = this.alarmQueue.shift();
        Logger.info(`[LocationService] Processing queued alarm (${this.alarmQueue.length} remaining)`);
        setTimeout(() => this.handleAlarmFired(nextAlarm), 1000);
      }
    }
  }


  /**
   * Schedule automatic stop when prayer ends
   */
  private scheduleAutoStop(activePlaces: any[]) {
    // Clear existing timer
    if (this.scheduleEndTimer) {
      clearTimeout(this.scheduleEndTimer);
      this.scheduleEndTimer = null;
    }

    if (activePlaces.length === 0) return;

    // Find earliest end time
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
    
    // Add small buffer to ensure we don't cut off exactly at the second
    // but close enough. The strict geofence exit will handle the precise checkout.
    // This is just to STOP the battery drain.
    const stopDelay = msUntilEnd + 60000; // +1 minute buffer

    if (stopDelay > 0) {
      Logger.info(`[LocationService] ⏰ Auto-stop scheduled in ${Math.round(stopDelay / 60000)}m`);
      
      this.scheduleEndTimer = setTimeout(async () => {
        Logger.info('[LocationService] ⏰ Schedule ended - stopping monitoring');
        
        // Force sync will see no active schedules -> activePlaces=[], will stop service & schedule next alarm
        await this.syncGeofences();
        
      }, stopDelay);
    }
  }

  /**
   * Start native location watcher (PUSH model)
   * This allows the OS to wake up the JS thread only when meaningful updates occur
   */
  private startWatcher() {
    if (this.watchId !== null) return;

    // 1. Get immediate location FIRST
    Geolocation.getCurrentPosition(
      async (position) => {
        try {  // ← Add this
          Logger.info('[LocationService] Initial location acquired');
          await this.processLocationUpdate(position);
          // Restore timers after initial location check
          await this.restoreActiveTimers();
        } catch (error) {  // ← Add this
          Logger.error('[LocationService] Processing error:', error);
        }
      },
      (error) => Logger.error('[LocationService] Initial location error:', error),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    // Default configuration for background tracking
    const config = {
      enableHighAccuracy: true,
      distanceFilter: CONFIG.DISTANCE.VERY_CLOSE / 2, // Update every ~50m movement
      interval: 10000, // Android: Active update interval (10s)
      fastestInterval: 5000, // Android: Fastest interval
      showLocationDialog: false, // Don't show popup
      forceRequestLocation: true, // Force check
    };

    Logger.info('[LocationService] Starting native watcher');

    this.watchId = Geolocation.watchPosition(
      async (position) => {
        // Logger.info(`[LocationService] 📍 Update received: ${position.coords.latitude}, ${position.coords.longitude}`);
        try {
          await this.processLocationUpdate(position);
        } catch (error) {
          Logger.error('[LocationService] Processing error:', error);
        }
      },
      (error) => this.handleLocationError(error),
      config
    );
  }

  /**
   * Handle GPS location errors with detailed diagnostics
   */
  private handleLocationError(error: any) {
    Logger.error('[LocationService] GPS Error:', {
      code: error.code,
      message: error.message
    });
    
    // Map error codes to user-friendly messages
    let userMessage = 'Location tracking issue detected.';
    let shouldStopMonitoring = false;
    
    switch (error.code) {
      case 1: // PERMISSION_DENIED
        userMessage = 'Location permission denied. Please enable in settings.';
        shouldStopMonitoring = true;
        break;
        
      case 2: // POSITION_UNAVAILABLE
        userMessage = 'GPS signal unavailable. Ensure GPS is enabled and you\'re outdoors.';
        // Don't stop - might recover
        break;
        
      case 3: // TIMEOUT
        userMessage = 'GPS timeout. This is normal indoors or in poor signal areas.';
        // Don't stop - will retry
        break;
        
      default:
        userMessage = `GPS error (code ${error.code}). Will retry automatically.`;
    }
    
    // Show notification for critical errors
    if (shouldStopMonitoring) {
      notificationManager.showNotification(
        'Location Tracking Stopped',
        userMessage,
        'gps-error'
      );
      
      this.stopGeofenceMonitoring();
      Logger.error('[LocationService] Stopped monitoring due to critical GPS error');
    } else {
      // Log but don't notify for temporary errors
      Logger.warn(`[LocationService] Temporary GPS error: ${userMessage}`);
    }
  }


  /**
   * Process location update with smart detection
   */
  private async processLocationUpdate(position: any) {
    if (!this.realm || this.realm.isClosed) return;

    // CRITICAL: Clear GPS verification timeout on first location
    // This signals that GPS is working properly
    if (this.gpsVerificationTimeout) {
      clearTimeout(this.gpsVerificationTimeout);
      this.gpsVerificationTimeout = null;
      
      const elapsed = Date.now() - (this.lastKnownLocation?.timestamp || Date.now());
      Logger.info(
        `[LocationService] ✅ GPS verified - receiving locations ` +
        `(first update after ${Math.round(Math.abs(elapsed) / 1000)}s)`
      );
    }

    // Prevent concurrent processing
    if (this.isChecking) {
      Logger.info('[LocationService] Already checking location, skipping');
      return;
    }

    this.isChecking = true;

    try {
      const location: LocationState = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp,
      };

      // VALIDATION: Check location quality
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

      // Determine inside places using new logic (returns Place IDs)
      const insidePlaceIds = LocationValidator.determineInsidePlaces(location, this.realm);
      
      // Resolve IDs to Place objects for legacy handlers
      const insidePlaces = insidePlaceIds
        .map(id => PlaceService.getPlaceById(this.realm!, id))
        .filter(p => p !== null);

      // Get active places for schedule cleanup checks
      const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
      const { activePlaces } = ScheduleManager.categorizeBySchedule(enabledPlaces);

      Logger.info(`[LocationService] Inside: ${insidePlaceIds.join(', ') || 'none'}`);

      await this.validateCurrentCheckIns(location.latitude, location.longitude, location.accuracy, activePlaces);
      
      await this.handleScheduleCleanup(activePlaces);
      await this.handleNewEntries(insidePlaces);

      // NEW: Schedule auto-stop when prayer ends
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

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    // We only force exit if it's NOT active AND NOT upcoming (i.e. completely finished)
    // But validateCurrentCheckIns is mostly about "Are we still physically inside?"
    // If the schedule ended, handleScheduleCleanup handles it.
    
    const activePlaceIds = new Set(activePlaces.map(p => p.id));

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
        place.latitude as number,
        place.longitude as number
      );

      const threshold = (place.radius as number) * CONFIG.EXIT_BUFFER_MULTIPLIER;
      const isSmallRadius = (place.radius as number) < CONFIG.SCHEDULE.SMALL_RADIUS_THRESHOLD;
      const effectiveThreshold = isSmallRadius ? threshold + 5 : threshold;
      
      const confidenceExit = distance > effectiveThreshold + accuracy || 
                            (accuracy < 50 && distance > effectiveThreshold);

      if (confidenceExit) {
        Logger.info(
          `[LocationService] EXIT: ${place.name} (dist: ${Math.round(distance)}m)`
        );
        await this.handleGeofenceExit(placeId);
      }
    }
  }

  /**
   * Determine which places user is inside based on GPS location
   * 
   * CRITICAL: Accounts for GPS accuracy to prevent false positives
   * - Requires accuracy < 50% of zone radius
   * - Calculates "effective distance" accounting for uncertainty
   * 
   * Example: 50m radius zone
   * - Good: 20m distance, 10m accuracy → effective 10m ✅ INSIDE
   * - Poor: 45m distance, 30m accuracy → effective 15m ✅ INSIDE (barely)
   * - Bad: 40m distance, 60m accuracy → REJECTED (accuracy too low)
   */




  private async handleScheduleCleanup(activePlaces: any[]) {
    // Legacy cleanup, mostly handled by timers now but good as failsafe
    if (!this.realm) return;

    const activePlaceIds = new Set(activePlaces.map(p => p.id));
    const activeLogs = CheckInService.getActiveCheckIns(this.realm);

    for (const log of activeLogs) {
      if (!activePlaceIds.has(log.placeId as string)) {
        // Double check time just to be safe? 
        // categorizeBySchedule already checks time, so if it's not in activePlaces, it's out of time.
        Logger.info(`[LocationService] Schedule ended (Detected by Poll): ${log.placeId}`);
        await this.handleGeofenceExit(log.placeId as string, true);
      }
    }
  }

  private async handleNewEntries(insidePlaces: any[]) {
    if (!this.realm) return;

    for (const place of insidePlaces) {
      if (!CheckInService.isPlaceActive(this.realm, place.id as string)) {
        Logger.info(`[LocationService] ENTRY: ${place.name}`);
        await this.handleGeofenceEntry(place.id as string);
      }
    }
  }



  /**
   * Handle geofence entry
   */
  private async handleGeofenceEntry(placeId: string) {
    const now = Date.now();
    const lastTime = this.lastTriggerTime[placeId] || 0;

    // Debounce only if very recent (to avoid rapid toggling)
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
      await this.activateSilentZone(place);
      return;
    }

    const startTime = currentSchedule.startTime.getTime();
    const endTime = currentSchedule.endTime.getTime();

    // 1. EARLY ARRIVAL CHECK
    if (now < startTime) {
      const msUntilStart = startTime - now;
      Logger.info(`[LocationService] EARLY ARRIVAL: ${place.name}. Waiting ${Math.round(msUntilStart / 1000)}s`);
      
      // Notify user they are being monitored but not yet silenced
      // Optional: Could rely on existing "Upcoming" foreground notification
      
      // Schedule timer to silence exactly at start time
      this.scheduleStartTimer(placeId, msUntilStart);
      return;
    }

    // 2. LATE ARRIVAL / ALREADY ENDED CHECK
    if (now >= endTime) {
      Logger.info(`[LocationService] Schedule ended for ${place.name}, ignoring entry`);
      return;
    }

    // 3. ACTIVE SCHEDULE
    await this.activateSilentZone(place);
    
    // Schedule strict end time
    const msUntilEnd = endTime - now;
    this.scheduleEndTimerForPlace(placeId, msUntilEnd);
  }



  /**
   * Activate silent zone - handles both first entry and overlapping zones
   * 
   * Key Logic:
   * - First entry: Save original volume, then silence
   * - Overlapping: Save current state (already silent), stay silent
   * 
   * This ensures when exiting one zone, we check if still in others before restoring
   */
  private async activateSilentZone(place: any) {
    if (!this.realm) {
      Logger.error('[SilentZone] Cannot activate: realm not available');
      return;
    }

    const placeId = place.id;
    const placeName = place.name;
    
    // Check if we're already in any silent zones
    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    const isOverlapping = activeLogs.length > 0;
    
    if (isOverlapping) {
      // OVERLAPPING ZONE: We're already in another silent zone
      Logger.info(
        `[SilentZone] 🔄 Entering ${placeName} ` +
        `(already in ${activeLogs.length} zone(s))`
      );
      
      // List which zones we're already in
      activeLogs.forEach((log: any, index: number) => {
        const existingPlace = PlaceService.getPlaceById(this.realm!, log.placeId);
        const existingName = existingPlace ? (existingPlace as any).name : 'Unknown';
        Logger.info(`  └─ Zone ${index + 1}: ${existingName}`);
      });
      
      // CRITICAL FIX: Save CURRENT state (which is already silent)
      // This way, when we exit THIS zone, we stay silent if still in others
      try {
        const currentMode = await RingerMode.getRingerMode();
        const currentVolume = await RingerMode.getStreamVolume(
          RingerMode.STREAM_TYPES.MUSIC
        );
        
        Logger.info(
          `[SilentZone] Saving current state for ${placeName}: ` +
          `mode=${currentMode} (should be ${RINGER_MODE.silent}), ` +
          `volume=${currentVolume} (should be 0)`
        );
        
        // Validate that we're actually silent
        if (currentMode !== RINGER_MODE.silent) {
          Logger.warn(
            `[SilentZone] ⚠️ WARNING: Phone not silent in overlapping zone! ` +
            `Mode=${currentMode}, expected=${RINGER_MODE.silent}`
          );
        }
        
        // Log check-in with current (silent) state
        const result = CheckInService.logCheckIn(
          this.realm, 
          placeId, 
          currentMode,     // Current state (should be silent)
          currentVolume    // Current state (should be 0)
        );
        
        if (!result) {
          Logger.error(`[SilentZone] ❌ Failed to log overlapping check-in for ${placeName}`);
          return;
        }
        
        // Notify user
        await notificationManager.showNotification(
          'Multiple Silent Zones',
          `Entered ${placeName}. Phone remains silent (${activeLogs.length + 1} active zones).`,
          'check-in-multi'
        );
        
        Logger.info(`[SilentZone] ✅ Overlapping check-in logged for ${placeName}`);
        
      } catch (error) {
        Logger.error('[SilentZone] Failed to save overlapping state:', error);
        
        // Fallback: Log check-in without volume data
        CheckInService.logCheckIn(this.realm, placeId);
      }
      
    } else {
      // FIRST ENTRY: Save original volume state and silence
      Logger.info(`[SilentZone] 🔇 First entry into ${placeName}`);
      
      try {
        await this.saveAndSilencePhone(placeId);
        
        await notificationManager.showNotification(
          'Phone Silenced 🔕',
          `Entered ${placeName}`,
          'check-in'
        );
        
        Logger.info(`[SilentZone] ✅ Phone silenced for ${placeName}`);
        
      } catch (error) {
        Logger.error(`[SilentZone] Failed to silence phone for ${placeName}:`, error);
      }
    }
    
    // Schedule end timer for this place
    const schedules = place.schedules || [];
    if (schedules.length > 0) {
      // Find which schedule is currently active
      const now = new Date();
      for (const schedule of schedules) {
        if (ScheduleManager.isScheduleActiveNow(schedule, now)) {
          // Calculate time until end
          const [endHours, endMinutes] = schedule.endTime.split(':').map(Number);
          const endTime = new Date(now);
          endTime.setHours(endHours, endMinutes, 0, 0);
          
          // Handle overnight schedules
          if (endTime < now) {
            endTime.setDate(endTime.getDate() + 1);
          }
          
          const msUntilEnd = endTime.getTime() - now.getTime();
          
          if (msUntilEnd > 0) {
            this.scheduleEndTimerForPlace(placeId, msUntilEnd);
            Logger.info(
              `[SilentZone] Scheduled end timer for ${placeName} ` +
              `in ${Math.round(msUntilEnd / 60000)} min`
            );
          }
          
          break;
        }
      }
    }
  }

  /**
   * Handle geofence exit with overlapping zone support
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

    if (!this.realm) {
      Logger.error('[LocationService] Cannot handle exit: realm not available');
      return;
    }

    const place = PlaceService.getPlaceById(this.realm, placeId);
    const placeName = place ? (place as any).name : 'Unknown';
    
    // Check if this place has an active check-in
    if (!CheckInService.isPlaceActive(this.realm, placeId)) {
      Logger.info(`[LocationService] No active check-in for ${placeName}, ignoring exit`);
      return;
    }

    // Get all active logs and find this one
    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    const thisLog = activeLogs.find(l => l.placeId === placeId);

    if (!thisLog) {
      Logger.warn(`[LocationService] Active check-in for ${placeName} not found`);
      return;
    }

    const totalActive = activeLogs.length;
    Logger.info(`[LocationService] 🚪 Exiting ${placeName} (${totalActive} total active zones)`);

    if (totalActive === 1) {
      // LAST ZONE: Restore sound
      Logger.info(`[LocationService] Last zone exit - restoring sound`);
      
      await this.restoreRingerMode(thisLog.id as string);
      CheckInService.logCheckOut(this.realm, thisLog.id as string);
      
      await notificationManager.showNotification(
        'Sound Restored 🔔',
        `You have left ${placeName}. Phone sound restored.`,
        'check-out'
      );
      
      Logger.info(`[LocationService] ✅ Sound restored after exiting ${placeName}`);
      
    } else {
      // OVERLAPPING: Still in other zones, stay silent
      Logger.info(
        `[LocationService] Still in ${totalActive - 1} other zone(s), ` +
        `staying silent`
      );
      
      // Log which zones we're still in
      activeLogs.forEach((log: any) => {
        if (log.placeId !== placeId) {
          const otherPlace = PlaceService.getPlaceById(this.realm!, log.placeId);
          const otherName = otherPlace ? (otherPlace as any).name : 'Unknown';
          Logger.info(`  └─ Still in: ${otherName}`);
        }
      });
      
      // Close this check-in but DON'T restore sound
      CheckInService.logCheckOut(this.realm, thisLog.id as string);
      
      await notificationManager.showNotification(
        'Partial Exit',
        `Left ${placeName}. Phone stays silent (${totalActive - 1} active zones).`,
        'check-out-partial'
      );
      
      Logger.info(`[LocationService] ✅ Partial exit from ${placeName}`);
    }
    
    // Clear end timer for this place
    if (this.endTimers[placeId]) {
      clearTimeout(this.endTimers[placeId]);
      delete this.endTimers[placeId];
      Logger.info(`[LocationService] Cleared end timer for ${placeName}`);
    }
  }

  private async saveAndSilencePhone(placeId: string) {
    if (Platform.OS !== 'android') return;

    try {
      const hasPermission = await RingerMode.checkDndPermission();

      if (!hasPermission) {
        Logger.warn('[LocationService] No DND permission');
        await notificationManager.showNotification(
          'Permission Required',
          'Grant "Do Not Disturb" access in settings for automatic silencing',
          'dnd-required'
        );
        CheckInService.logCheckIn(this.realm!, placeId);
        return;
      }

      const currentMode = await RingerMode.getRingerMode();
      const currentMediaVolume = await RingerMode.getStreamVolume(RingerMode.STREAM_TYPES.MUSIC);

      Logger.info(`[LocationService] Saving: mode=${currentMode}, volume=${currentMediaVolume}`);

      const log = CheckInService.logCheckIn(this.realm!, placeId, currentMode, currentMediaVolume);
      if (!log) {
         Logger.error(`[LocationService] Failed to persist check-in for ${placeId}, aborting silence operation`);
         return; 
      }

      try {
        await RingerMode.setRingerMode(RINGER_MODE.silent);
        await RingerMode.setStreamVolume(RingerMode.STREAM_TYPES.MUSIC, 0);
        Logger.info('[LocationService] Phone silenced');
      } catch (error: any) {
        if (error.code === 'NO_PERMISSION') {
          Logger.warn('[LocationService] DND permission revoked');
          await RingerMode.requestDndPermission();
        } else {
          Logger.error('[LocationService] Failed to silence:', error);
        }
      }
    } catch (error) {
      Logger.error('[LocationService] Save and silence failed:', error);
      // Try to log check-in anyway but without volume data (fallback)
      CheckInService.logCheckIn(this.realm!, placeId);
    }
  }

  private async restoreRingerMode(checkInLogId: string) {
    if (Platform.OS !== 'android') return;

    try {
      const log = this.realm!.objectForPrimaryKey('CheckInLog', checkInLogId) as any;
      if (!log) return;

      const savedMode = log.savedVolumeLevel;
      const savedMediaVolume = log.savedMediaVolume;

      if (savedMode !== null && savedMode !== undefined) {
        Logger.info(`[LocationService] Restoring mode: ${savedMode}`);
        await RingerMode.setRingerMode(savedMode);
      } else {
        await RingerMode.setRingerMode(RINGER_MODE.normal);
      }

      if (savedMediaVolume !== null && savedMediaVolume !== undefined) {
        Logger.info(`[LocationService] Restoring volume: ${savedMediaVolume}`);
        await RingerMode.setStreamVolume(RingerMode.STREAM_TYPES.MUSIC, savedMediaVolume);
      }

      Logger.info('[LocationService] Sound restored');
    } catch (error) {
      Logger.error('[LocationService] Failed to restore:', error);
    }
  }

  /**
   * Schedule a timer to activate silent zone at strict start time
   */
  /**
   * Schedule a timer to activate silent zone at strict start time
   */
  private scheduleStartTimer(placeId: string, delay: number) {
    // Clear existing if any
    if (this.startTimers[placeId]) {
      clearTimeout(this.startTimers[placeId]);
      delete this.startTimers[placeId];
    }
    
    // CRITICAL: If delay is too long (> 1 minute), do NOT use setTimeout.
    // We already have a system alarm set for the EXACT start time ('START_SILENCE').
    // Using long functionality setTimeout in background is unreliable.
    if (delay > 60000) {
        Logger.info(`[LocationService] Start timer delay ${Math.round(delay/1000)}s > 60s. Relying on System Alarm for activation.`);
        return;
    }

    Logger.info(`[LocationService] Scheduled SHORT strict timer for ${placeId} in ${Math.round(delay / 1000)}s`);

    this.startTimers[placeId] = setTimeout(async () => {
      Logger.info(`[LocationService] ⏰ Strict timer fired for ${placeId}`);
      delete this.startTimers[placeId];
      
      // Re-trigger entry logic (checks schedules)
      await this.handleGeofenceEntry(placeId);
    }, delay);
  }

  /**
   * Force a location check immediately
   * Critical for:
   * 1. When a place is edited and becomes active NOW
   * 2. When a "Start Silence" alarm fires
   * 3. When service restarts
   */

  async forceLocationCheck(attemptNumber: number = 1, maxAttempts: number = 3, deadline?: number): Promise<void> {
    
    // CHECK DEADLINE
    if (deadline && Date.now() > deadline) {
        Logger.warn('[LocationService] ⏳ Force location check cancelled - Deadline passed');
        return Promise.resolve();
    }

    Logger.info(`[LocationService] ⚡ Forcing location check (attempt ${attemptNumber}/${maxAttempts})`);
    
    return new Promise<void>((resolve) => {
      const timeout = attemptNumber === 1 ? 15000 : 30000; // 15s first, 30s for retries
      
      Geolocation.getCurrentPosition(
        async (position) => {
          try {
            Logger.info(`[LocationService] 📍 Forced location acquired on attempt ${attemptNumber}`);
            await this.processLocationUpdate(position);
            resolve();
          } catch (error) {
            Logger.error('[LocationService] Error processing forced location:', error);
            resolve();
          }
        },
        async (error) => {
          Logger.error(`[LocationService] Attempt ${attemptNumber} failed:`, error);
          
          // Should we retry?
          if (attemptNumber < maxAttempts) {
            // Check deadline again
            if (deadline && Date.now() > deadline) {
                 Logger.warn('[LocationService] ⏳ Stop retrying forced check - Deadline passed');
                 resolve();
                 return;
            }
          
            Logger.info(`[LocationService] 🔄 Retrying location check (attempt ${attemptNumber + 1}/${maxAttempts})...`);
            
            // Wait 2 seconds before retry
            await new Promise<void>(r => setTimeout(() => r(), 2000));
            
            // Retry recursively
            await this.forceLocationCheck(attemptNumber + 1, maxAttempts, deadline);
            resolve();
          } else {
            Logger.error(`[LocationService] ❌ All ${maxAttempts} location check attempts failed`);
            resolve();
          }
        },
        { enableHighAccuracy: true, timeout, maximumAge: 10000 }
      );
    });
  }

  /**
   * Schedule a timer to force exit silent zone at strict end time
   */
  private scheduleEndTimerForPlace(placeId: string, delay: number) {
    if (this.endTimers[placeId]) {
      clearTimeout(this.endTimers[placeId]);
    }

    Logger.info(`[LocationService] Scheduled END timer for ${placeId} in ${Math.round(delay / 1000)}s`);

    this.endTimers[placeId] = setTimeout(async () => {
      Logger.info(`[LocationService] ⏰ End time arrived for ${placeId}`);
      delete this.endTimers[placeId];
      
      // Force checkout
      await this.handleGeofenceExit(placeId, true);
    }, delay);
  }



  destroy() {
    Logger.info('[LocationService] Destroying service');
    this.stopGeofenceMonitoring();
    
    // Cleanup restart interval
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