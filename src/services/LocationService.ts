import Geofencing from '@rn-org/react-native-geofencing';
import notifee, {
  AndroidImportance,
  AndroidForegroundServiceType,
  TriggerType,
  TimestampTrigger,
  AndroidCategory,
  AlarmType,
} from '@notifee/react-native';
import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import { PreferencesService, Preferences } from '../database/services/PreferencesService';
import { CheckInService } from '../database/services/CheckInService';
import { Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import RingerMode, { RINGER_MODE } from '../modules/RingerMode';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { NativeModules } from 'react-native';

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
const CONFIG = {
  // Debouncing
  DEBOUNCE_TIME: 8000, // 8 seconds
  
  // Accuracy thresholds
  MIN_ACCURACY_THRESHOLD: 50,  // Good for small radius (30m+)
  ACTIVE_MIN_ACCURACY: 80,     // For already active places
  MAX_ACCEPTABLE_ACCURACY: 100,
  
  // GPS settings
  GPS_TIMEOUT: 30000,           // 30 seconds
  GPS_MAXIMUM_AGE: 5000,        // 5 seconds - fresh readings
  
  // Check intervals - ADAPTIVE
  INTERVALS: {
    SCHEDULE_ACTIVE: 10000,        // 10 seconds - during scheduled time
    SCHEDULE_APPROACHING: 20000,   // 20 seconds - before scheduled time
    
    // Distance-based (for always-active places)
    VERY_CLOSE: 15000,    // 15 seconds - within 100m
    CLOSE: 45000,         // 45 seconds - within 500m
    NEAR: 3 * 60 * 1000,  // 3 minutes - within 2km
    FAR: 5 * 60 * 1000,   // 5 minutes - beyond 2km
    
    // Deep sleep (no active or upcoming schedules)
    DEEP_SLEEP: 30 * 60 * 1000, // 30 minutes max
  },
  
  // Distance thresholds
  DISTANCE: {
    VERY_CLOSE: 100,   // meters
    CLOSE: 500,        // meters
    NEAR: 2000,        // meters
  },
  
  // Schedule settings
  SCHEDULE: {
    PRE_ACTIVATION_MINUTES: 15,  // Start checking 15 min before schedule
    POST_GRACE_MINUTES: 0,        // Strict end time (was 5)
    SMALL_RADIUS_THRESHOLD: 60,  // Consider "small" if under this
  },
  
  // Geofence settings
  GEOFENCE_RADIUS_BUFFER: 15,    // meters to add
  MIN_GEOFENCE_RADIUS: 25,       // minimum radius
  EXIT_BUFFER_MULTIPLIER: 1.15,  // 15% buffer for exit
  
  // Notification channels
  CHANNELS: {
    SERVICE: 'location-tracking-service',
    ALERTS: 'location-alerts',
  },
};

interface LocationState {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}

interface UpcomingSchedule {
  placeId: string;
  placeName: string;
  startTime: Date;
  endTime: Date;
  minutesUntilStart: number;
}

class LocationService {
  // Core state
  private realm: Realm | null = null;
  private isReady = false;
  private isChecking = false;
  private isSyncing = false;
  private geofencesActive = false;
  
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

  /**
   * Initialize the location service
   */
  async initialize(realmInstance: Realm) {
    if (this.isReady) {
      console.log('[LocationService] Already initialized');
      return;
    }

    this.realm = realmInstance;

    if (Platform.OS === 'android') {
      await this.createNotificationChannels();
    }

    await this.syncGeofences();
    this.setupReactiveSync();
    
    // Setup service restart mechanism
    this.setupServiceRestart();

    this.isReady = true;
    console.log('[LocationService] ✅ Service initialized');
  }

  /**
   * Create notification channels
   */
  private async createNotificationChannels() {
    try {
      await notifee.createChannel({
        id: CONFIG.CHANNELS.SERVICE,
        name: 'Location Tracking Service',
        importance: AndroidImportance.DEFAULT, // Changed from LOW to DEFAULT for better persistence
        vibration: false,
        lights: false,
      });

      await notifee.createChannel({
        id: CONFIG.CHANNELS.ALERTS,
        name: 'Location Alerts',
        importance: AndroidImportance.HIGH,
        sound: 'default',
      });
      
      console.log('[LocationService] Notification channels created');
    } catch (error) {
      console.error('[LocationService] Failed to create channels:', error);
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

    // Check if we have background location permission
    // Check for CRITICAL background location permission (Loc + Bg + Notif)
    // We do NOT block on DND here. If missing, we'll prompt when entering zone.
    const hasPermission = await PermissionsManager.hasCriticalPermissions();
    if (!hasPermission) {
      console.error('[LocationService] Missing critical permissions (Loc/Bg/Notif)!');
      // Show notification to user
      await this.showNotification(
        'Permission Required',
        'Enable "Allow all the time" for location to use Silent Zone in background',
        'permission-warning'
      );
      return;
    }

    try {
      // Small delay to ensure notifee is fully ready
     await new Promise<void>(resolve => setTimeout(() => resolve(), 100));

      const enabledCount = this.realm 
        ? PlaceService.getEnabledPlaces(this.realm).length 
        : 0;

      const inScheduleWindow = this.isInScheduleWindow;
      const nextSchedule = this.upcomingSchedules[0];

      let title = '🛡️ Silent Zone Running';
      let body = `Monitoring ${enabledCount} active location${enabledCount !== 1 ? 's' : ''}`;
      
      if (inScheduleWindow && nextSchedule) {
        title = '🔕 Silent Zone Active';
        body = `📍 Inside ${nextSchedule.placeName}`;
      } else if (nextSchedule && nextSchedule.minutesUntilStart <= 15) {
        title = '⏱️ Preparing to Silence';
        body = `🔜 ${nextSchedule.placeName} starts in ${nextSchedule.minutesUntilStart} min`;
      }

      await notifee.displayNotification({
        id: 'location-tracking-service',
        title,
        body,
        android: {
          channelId: CONFIG.CHANNELS.SERVICE,
          asForegroundService: true,
          color: '#8B5CF6', // Purple-500
          ongoing: true,
          autoCancel: false,
          colorized: true,
          largeIcon: 'ic_launcher',
          foregroundServiceTypes: [
            AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION,
          ],
          pressAction: {
            id: 'default',
            launchActivity: 'default',
          },
        },
      });

      this.startGeofenceMonitoring();
      console.log('[LocationService] Foreground service started');
    } catch (error) {
      console.error('[LocationService] Failed to start service:', error);
    }
  }

  /**
   * Schedule a cleanup check for when current schedule ends
   */
  /**
   * Restore timers for active check-ins (e.g. after restart)
   */
  private async restoreActiveTimers() {
    if (!this.realm || this.realm.isClosed) return;

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    console.log(`[LocationService] Restoring timers for ${activeLogs.length} active sessions`);

    for (const log of activeLogs) {
      const placeId = log.placeId as string;
      // Skip if we already have a timer
      if (this.endTimers[placeId]) continue;

      const place = PlaceService.getPlaceById(this.realm, placeId);
      if (!place) continue;

      const schedule = this.getCurrentOrNextSchedule(place);
      if (schedule) {
        const endTime = schedule.endTime.getTime();
        const now = Date.now();
        
        if (now >= endTime) {
           // Should have ended!
           console.log(`[LocationService] Found expired session for ${place.name}, ending now`);
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
        console.log('[LocationService] ⚠️ Service appears stopped, restarting');
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
    if (Platform.OS === 'android') {
      try {
        await notifee.stopForegroundService();
        await notifee.cancelNotification('location-tracking-service');
        console.log('[LocationService] Service stopped');
      } catch (error) {
        console.error('[LocationService] Error stopping service:', error);
      }
    }
    this.stopGeofenceMonitoring();
  }

  /**
   * Emergency cleanup for crashes
   */
  async cleanupOnCrash() {
    console.log('[LocationService] Emergency cleanup triggered');
    
    try {
      if (!this.realm || this.realm.isClosed) return;

      const activeLogs = CheckInService.getActiveCheckIns(this.realm);
      
      if (activeLogs.length > 0) {
        console.log(`[LocationService] Restoring sound for ${activeLogs.length} active locations`);
        
        for (const log of activeLogs) {
          try {
            await this.restoreRingerMode(log.id as string);
            CheckInService.logCheckOut(this.realm, log.id as string);
          } catch (error) {
            console.error('[LocationService] Failed to restore:', error);
          }
        }
      }
    } catch (error) {
      console.error('[LocationService] Emergency cleanup failed:', error);
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
      console.log('[LocationService] Places changed, syncing');
      
      // Check if we should auto-enable tracking
      const enabledPlaces = Array.from(collection).filter((p: any) => p.isEnabled);
      
      if (enabledPlaces.length > 0) {
        const prefs = this.realm!.objectForPrimaryKey('Preferences', 'USER_PREFS') as any;
        if (prefs && !prefs.trackingEnabled) {
          console.log('[LocationService] ✅ Auto-enabling tracking (places added)');
          
          // Enable tracking and wait for it to complete
          this.realm!.write(() => {
            prefs.trackingEnabled = true;
          });
          
          // Wait longer for all listeners to process
          setTimeout(() => {
            console.log('[LocationService] Syncing after tracking enabled');
            this.syncGeofences();
          }, 300);
          
          return; // Don't sync immediately
        }
      }
      
      // If no enabled places, auto-disable tracking
      if (enabledPlaces.length === 0) {
        const prefs = this.realm!.objectForPrimaryKey('Preferences', 'USER_PREFS') as any;
        if (prefs && prefs.trackingEnabled) {
          console.log('[LocationService] ❌ Auto-disabling tracking (no enabled places)');
          this.realm!.write(() => {
            prefs.trackingEnabled = false;
          });
        }
      }

      this.syncGeofences();
    }
  });

  const prefs = this.realm.objectForPrimaryKey<Preferences>('Preferences', 'USER_PREFS');
  if (prefs) {
    prefs.addListener(() => {
      console.log('[LocationService] Preferences changed, syncing');
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
        console.log('[LocationService] Tracking disabled');
        await this.stopForegroundService();
        await Geofencing.removeAllGeofence();
        this.geofencesActive = false;
        return;
      }

      const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
      
      const { activePlaces, upcomingSchedules } = this.categorizeBySchedule(enabledPlaces);
      this.upcomingSchedules = upcomingSchedules;
      this.isInScheduleWindow = activePlaces.length > 0 && upcomingSchedules.length > 0;

      // NEW: Smart decision logic
      const shouldMonitor = this.shouldStartMonitoring(activePlaces, upcomingSchedules);

      // Log next schedule if any
      if (upcomingSchedules.length > 0) {
        const next = upcomingSchedules[0];
        console.log(
          `[LocationService] Next schedule: ${next.placeName} in ${next.minutesUntilStart} minutes`
        );
      }

      if (shouldMonitor) {
         // ACTIVE MONITORING
         await this.handleManualDisableCleanup(new Set(activePlaces.map(p => p.id as string)));
         await Geofencing.removeAllGeofence();
         this.geofencesActive = false;

         if (enabledPlaces.length === 0) {
           console.log('[LocationService] No locations to monitor');
           await this.stopForegroundService();
           return;
         }

         const hasPermissions = await PermissionsManager.hasCriticalPermissions();
         if (!hasPermissions) {
           console.warn('[LocationService] Missing required permissions');
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

         console.log(`[LocationService] Added ${placesToMonitor.size} geofences (Active + Upcoming)`);
         await this.startForegroundService();
         this.geofencesActive = true;
         
         // Even while monitoring, schedule next alarm for redundancy or next event
         this.scheduleNextAlarm(upcomingSchedules);

      } else {
         // PASSIVE MODE (Sleep & Alarm)
         console.log('[LocationService] 💤 Entering passive mode (using alarms)');
         
         // Ensure we cleanup any stuck checkins before sleeping if we are transitioning from active
         if (this.geofencesActive) {
            await this.handleManualDisableCleanup(new Set()); // Cleanup all? No, just verify.
            await Geofencing.removeAllGeofence();
            this.geofencesActive = false;
         }
         
         await this.stopForegroundService();
         this.scheduleNextAlarm(upcomingSchedules);
      }
      
    } catch (error) {
      console.error('[LocationService] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * SCHEDULE-AWARE CATEGORIZATION
   * Returns places that are currently active or will be active soon
   * Works for ANY scheduled location (mosque, office, gym, etc.)
   */
  private categorizeBySchedule(enabledPlaces: any[]): {
    activePlaces: any[];
    upcomingSchedules: UpcomingSchedule[];
  } {
    const now = new Date();
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
    const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];

    const activePlaces: any[] = [];
    const upcomingSchedules: UpcomingSchedule[] = [];

    for (const place of enabledPlaces) {
      // Places without schedules are always active (24/7 locations)
      if (!place.schedules || place.schedules.length === 0) {
        activePlaces.push(place);
        continue;
      }

      // Check each schedule
      for (const schedule of place.schedules) {
        // Day check
        if (schedule.days.length > 0 && !schedule.days.includes(currentDay)) {
          // console.log(`[LocationService] ${place.name}: Day mismatch (${currentDay} not in [${schedule.days}])`);
          continue;
        }

        const [startHours, startMins] = schedule.startTime.split(':').map(Number);
        const [endHours, endMins] = schedule.endTime.split(':').map(Number);
        const startTimeMinutes = startHours * 60 + startMins;
        const endTimeMinutes = endHours * 60 + endMins;

        // Calculate with activation window and grace period
        const preActivationMinutes = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES;
        const postGraceMinutes = CONFIG.SCHEDULE.POST_GRACE_MINUTES;
        
        const effectiveStartMinutes = startTimeMinutes - preActivationMinutes;
        const effectiveEndMinutes = endTimeMinutes + postGraceMinutes;

        // Handle overnight schedules (e.g., night shift 22:00 - 06:00)
        const isOvernight = startTimeMinutes > endTimeMinutes;
        let isInEffectiveWindow = false;

        if (!isOvernight) {
          isInEffectiveWindow = currentTimeMinutes >= effectiveStartMinutes && 
                                currentTimeMinutes <= effectiveEndMinutes;
        } else {
          isInEffectiveWindow = currentTimeMinutes >= effectiveStartMinutes || 
                                currentTimeMinutes <= effectiveEndMinutes;
        }

        /*
        // Debug logging
        console.log(
          `[LocationService] Schedule Check for ${place.name}: \n` +
          `  Current: ${currentTimeMinutes} (${Math.floor(currentTimeMinutes/60)}:${currentTimeMinutes%60})\n` +
          `  Window: ${effectiveStartMinutes} - ${effectiveEndMinutes}\n` +
          `  Match: ${isInEffectiveWindow}`
        );
        */

        if (isInEffectiveWindow) {
          if (!activePlaces.find(p => p.id === place.id)) {
            activePlaces.push(place);
          }

          // Calculate minutes until start
          let minutesUntilStart: number;
          let isOvernightActive = false;

          if (isOvernight && currentTimeMinutes < startTimeMinutes) {
             // We are in the "Next Day" part of the overnight schedule
             minutesUntilStart = 0; 
             isOvernightActive = true;
          } else if (currentTimeMinutes < startTimeMinutes) {
            minutesUntilStart = startTimeMinutes - currentTimeMinutes;
          } else if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes) {
            minutesUntilStart = 0; // Already in scheduled time
          } else {
            // Should be covered by isInEffectiveWindow check, but fallback
             minutesUntilStart = 0;
          }

          // Create schedule object
          const scheduleStart = new Date(now);
          scheduleStart.setHours(startHours, startMins, 0, 0);
          
          if (isOvernightActive) {
             // If we are in the early morning part, the start time was YESTERDAY
             scheduleStart.setDate(scheduleStart.getDate() - 1);
          }
          
          const scheduleEnd = new Date(now);
          scheduleEnd.setHours(endHours, endMins, 0, 0);
          if (isOvernight && endTimeMinutes < startTimeMinutes && !isOvernightActive) {
            // If we are in the evening part, end time is TOMORROW
            scheduleEnd.setDate(scheduleEnd.getDate() + 1);
          }

          upcomingSchedules.push({
            placeId: place.id,
            placeName: place.name,
            startTime: scheduleStart,
            endTime: scheduleEnd,
            minutesUntilStart,
          });
        }
      }
    }

    // Sort upcoming schedules by start time
    upcomingSchedules.sort((a, b) => a.minutesUntilStart - b.minutesUntilStart);

    return { activePlaces, upcomingSchedules };
  }

  private async handleManualDisableCleanup(enabledIdsSet: Set<string>) {
    if (!this.realm || this.realm.isClosed) return;

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    
    for (const log of activeLogs) {
      if (!enabledIdsSet.has(log.placeId as string)) {
        console.log(`[LocationService] Force checkout: ${log.placeId}`);
        await this.handleGeofenceExit(log.placeId as string, true);
      }
    }
  }

  private startGeofenceMonitoring() {
    this.stopGeofenceMonitoring();
    // Start watching position
    this.startWatcher();
  }

  private stopGeofenceMonitoring() {
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
   * Decide if we should actively monitor NOW
   */
  private shouldStartMonitoring(activePlaces: any[], upcomingSchedules: any[]): boolean {
    // 1. If schedule is active right now → Monitor
    if (activePlaces.length > 0) {
      // console.log('[LocationService] ✅ Schedule active now');
      return true;
    }

    // 2. If schedule starts within 15 minutes → Monitor
    if (upcomingSchedules.length > 0) {
      const nextSchedule = upcomingSchedules[0];
      if (nextSchedule.minutesUntilStart <= 15) {
        console.log(`[LocationService] ✅ Pre-start monitoring: ${nextSchedule.placeName} in ${nextSchedule.minutesUntilStart}m`);
        return true;
      }
    }

    // 3. Otherwise → Don't monitor, use alarm instead
    // console.log('[LocationService] ⏰ Using alarm (next schedule > 15m away)');
    return false;
  }

  /**
   * Schedule AlarmManager to wake before next prayer
   */
  private async scheduleNextAlarm(upcomingSchedules: any[]) {
    if (upcomingSchedules.length === 0) {
      console.log('[LocationService] No upcoming schedules to alarm for');
      return;
    }

    const nextSchedule = upcomingSchedules[0];
    const wakeMinutes = nextSchedule.minutesUntilStart - 15; // Wake 15 min early

    if (wakeMinutes <= 0) {
       // Already handled by 'shouldStartMonitoring' or passed
       return;
    }

    console.log(
      `[LocationService] ⏰ Scheduling alarm in ${wakeMinutes}m for ${nextSchedule.placeName}`
    );

    try {
      const trigger: TimestampTrigger = {
        type: TriggerType.TIMESTAMP,
        timestamp: Date.now() + wakeMinutes * 60 * 1000,
        alarmManager: {
          allowWhileIdle: true, // ✅ Works in Doze mode!
          type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
        },
      };

      await notifee.createTriggerNotification(
        {
          id: 'prayer-alarm',
          title: 'Prayer Time Approaching',
          body: `${nextSchedule.placeName} starting soon`,
          data: {
            action: 'START_MONITORING',
            scheduleId: nextSchedule.placeId,
          },
          android: {
            channelId: CONFIG.CHANNELS.SERVICE,
            importance: AndroidImportance.HIGH,
            category: AndroidCategory.ALARM,
            autoCancel: true,
            pressAction: {
                id: 'default',
                launchActivity: 'default',
            },
          },
        },
        trigger
      );

      this.nextAlarmScheduled = true;
    } catch (error) {
      console.error('[LocationService] Failed to schedule alarm:', error);
    }
  }

  /**
   * Handle alarm firing (called when notification appears)
   */
  async handleAlarmFired() {
    console.log('[LocationService] ⏰ Alarm fired - waking up service');
    if (!this.realm) {
        // If coming from dead background, might need re-init, but usually 'initialize' called from index.js handles it.
        // This method is called AFTER initialize if wired up correctly.
        console.warn('[LocationService] handleAlarmFired called but realm not ready?');
    }
    // Force a sync, which will see we are <15m and start monitoring
    await this.syncGeofences();
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
        const schedule = this.getCurrentOrNextSchedule(place);
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
      console.log(`[LocationService] ⏰ Auto-stop scheduled in ${Math.round(stopDelay / 60000)}m`);
      
      this.scheduleEndTimer = setTimeout(async () => {
        console.log('[LocationService] ⏰ Schedule ended - stopping monitoring');
        
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
          console.log('[LocationService] Initial location acquired');
          await this.processLocationUpdate(position);
          // Restore timers after initial location check
          await this.restoreActiveTimers();
        } catch (error) {  // ← Add this
          console.error('[LocationService] Processing error:', error);
        }
      },
      (error) => console.error('[LocationService] Initial location error:', error),
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

    console.log('[LocationService] Starting native watcher');

    this.watchId = Geolocation.watchPosition(
      async (position) => {
        try {
          await this.processLocationUpdate(position);
        } catch (error) {
          console.error('[LocationService] Processing error:', error);
        }
      },
      (error) => {
        console.error('[LocationService] Watch error:', error);
        // If error is timeout or position unavailable, retrying is handled by the OS/Library usually
        // But if completely failed, we might want to restart watcher after delay
      },
      config
    );
  }


  /**
   * Process location update with smart detection
   */
  private async processLocationUpdate(position: any) {
    if (!this.realm || this.realm.isClosed) return;

    const { latitude, longitude, accuracy } = position.coords;
    
    this.lastKnownLocation = {
      latitude,
      longitude,
      accuracy,
      timestamp: Date.now(),
    };

    console.log(
      `[LocationService] Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}, ` +
      `accuracy: ${accuracy.toFixed(1)}m`
    );

    if (accuracy > CONFIG.MAX_ACCEPTABLE_ACCURACY) {
      console.warn(`[LocationService] Poor GPS accuracy (${accuracy.toFixed(0)}m)`);
      // We still process it, but maybe with caution?
      // For now, let's proceed but just warn.
    }

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    const { activePlaces } = this.categorizeBySchedule(enabledPlaces);

    console.log(`[LocationService] Checking ${activePlaces.length} active locations`);

    await this.validateCurrentCheckIns(latitude, longitude, accuracy, activePlaces);
    
    const insidePlaces = this.determineInsidePlaces(latitude, longitude, accuracy, activePlaces);
    
    await this.handleScheduleCleanup(activePlaces);
    await this.handleNewEntries(insidePlaces);

    // NEW: Schedule cleanup timer for schedule end
    await this.handleNewEntries(insidePlaces);

    // NEW: Schedule auto-stop when prayer ends
    this.scheduleAutoStop(activePlaces);
  }

  private async validateCurrentCheckIns(
    latitude: number,
    longitude: number,
    accuracy: number,
    activePlaces: any[]
  ) {
    if (!this.realm) return;

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    const activePlaceIds = new Set(activePlaces.map(p => p.id));

    for (const log of activeLogs) {
      const placeId = log.placeId as string;
      const place = PlaceService.getPlaceById(this.realm, placeId);

      if (!place || !activePlaceIds.has(placeId)) {
        await this.handleGeofenceExit(placeId, true);
        continue;
      }

      const distance = this.calculateDistance(
        latitude,
        longitude,
        place.latitude as number,
        place.longitude as number
      );

      const threshold = (place.radius as number) * CONFIG.EXIT_BUFFER_MULTIPLIER;
      const isSmallRadius = (place.radius as number) < CONFIG.SCHEDULE.SMALL_RADIUS_THRESHOLD;
      const effectiveThreshold = isSmallRadius ? threshold + 10 : threshold;
      
      const confidenceExit = distance > effectiveThreshold + accuracy || 
                            (accuracy < 50 && distance > effectiveThreshold);

      if (confidenceExit) {
        console.log(
          `[LocationService] EXIT: ${place.name} (dist: ${Math.round(distance)}m)`
        );
        await this.handleGeofenceExit(placeId);
      }
    }
  }

  /**
   * Determine which places user is inside
   * Smart handling for small radius locations
   */
  private determineInsidePlaces(
    latitude: number,
    longitude: number,
    accuracy: number,
    places: any[]
  ): any[] {
    return places.filter(place => {
      const distance = this.calculateDistance(
        latitude,
        longitude,
        place.latitude as number,
        place.longitude as number
      );

      const radius = place.radius as number;
      const isSmallRadius = radius <= CONFIG.SCHEDULE.SMALL_RADIUS_THRESHOLD;
      const isActive = CheckInService.isPlaceActive(this.realm!, place.id as string);

      // For small radius, use sophisticated detection
      if (isSmallRadius) {
        if (accuracy < 20) {
          const isInside = distance <= radius + 8;
          console.log(
            `[LocationService] ${place.name} (PRECISE): dist=${Math.round(distance)}m, inside=${isInside}`
          );
          return isInside;
        }

        if (accuracy < 50) {
          const effectiveDistance = Math.max(0, distance - accuracy * 0.6);
          const isInside = effectiveDistance <= radius + 12;
          console.log(
            `[LocationService] ${place.name} (MODERATE): dist=${Math.round(distance)}m, inside=${isInside}`
          );
          return isInside;
        }

        if (accuracy <= CONFIG.MAX_ACCEPTABLE_ACCURACY) {
          const isVeryClose = distance <= radius + 20;
          const maybeInside = distance <= radius + accuracy * 0.5;
          const isInside = isVeryClose || maybeInside || isActive;
          
          console.log(
            `[LocationService] ${place.name} (POOR ACC): inside=${isInside}`
          );
          return isInside;
        }

        if (isActive) {
          console.log(`[LocationService] ${place.name}: Maintaining active state`);
          return true;
        }

        return false;
      }

      // For larger radius, use standard detection
      const radiusWithBuffer = radius * CONFIG.EXIT_BUFFER_MULTIPLIER;
      const effectiveDistance = Math.max(0, distance - accuracy);
      const isInside = effectiveDistance <= radiusWithBuffer || distance <= radius + 10;

      console.log(
        `[LocationService] ${place.name}: dist=${Math.round(distance)}m, inside=${isInside}`
      );

      return isInside;
    });
  }

  private async handleScheduleCleanup(activePlaces: any[]) {
    // Legacy cleanup, mostly handled by timers now but good as failsafe
    if (!this.realm) return;

    const activePlaceIds = new Set(activePlaces.map(p => p.id));
    const activeLogs = CheckInService.getActiveCheckIns(this.realm);

    for (const log of activeLogs) {
      if (!activePlaceIds.has(log.placeId as string)) {
        // Double check time just to be safe? 
        // categorizeBySchedule already checks time, so if it's not in activePlaces, it's out of time.
        console.log(`[LocationService] Schedule ended (Detected by Poll): ${log.placeId}`);
        await this.handleGeofenceExit(log.placeId as string, true);
      }
    }
  }

  private async handleNewEntries(insidePlaces: any[]) {
    if (!this.realm) return;

    for (const place of insidePlaces) {
      if (!CheckInService.isPlaceActive(this.realm, place.id as string)) {
        console.log(`[LocationService] ENTRY: ${place.name}`);
        await this.handleGeofenceEntry(place.id as string);
      }
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Handle geofence entry
   */
  private async handleGeofenceEntry(placeId: string) {
    const now = Date.now();
    const lastTime = this.lastTriggerTime[placeId] || 0;

    // Debounce only if very recent (to avoid rapid toggling)
    if (now - lastTime < CONFIG.DEBOUNCE_TIME) {
      console.log(`[LocationService] Debouncing entry: ${placeId}`);
      return;
    }
    this.lastTriggerTime[placeId] = now;

    if (!this.realm) return;

    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !place.isEnabled) return;

    // CHECK STRICT SCHEDULE
    const currentSchedule = this.getCurrentOrNextSchedule(place);
    
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
      console.log(`[LocationService] EARLY ARRIVAL: ${place.name}. Waiting ${Math.round(msUntilStart / 1000)}s`);
      
      // Notify user they are being monitored but not yet silenced
      // Optional: Could rely on existing "Upcoming" foreground notification
      
      // Schedule timer to silence exactly at start time
      this.scheduleStartTimer(placeId, msUntilStart);
      return;
    }

    // 2. LATE ARRIVAL / ALREADY ENDED CHECK
    if (now >= endTime) {
      console.log(`[LocationService] Schedule ended for ${place.name}, ignoring entry`);
      return;
    }

    // 3. ACTIVE SCHEDULE
    await this.activateSilentZone(place);
    
    // Schedule strict end time
    const msUntilEnd = endTime - now;
    this.scheduleEndTimerForPlace(placeId, msUntilEnd);
  }

  /**
   * Helper to get the relevant schedule for strict checking
   */
  private getCurrentOrNextSchedule(place: any): UpcomingSchedule | null {
    if (!place.schedules || place.schedules.length === 0) return null;

    const { upcomingSchedules } = this.categorizeBySchedule([place]);
    return upcomingSchedules[0] || null; // categorizeBySchedule handles the complex day/time logic
  }

  /**
   * Activates the silent zone and logs check-in
   */
  private async activateSilentZone(place: any) {
    const activeLogs = CheckInService.getActiveCheckIns(this.realm!);

    if (activeLogs.length > 0) {
      const firstLog = activeLogs[0] as any;
      const missingOriginal = firstLog.savedVolumeLevel == null || firstLog.savedMediaVolume == null;

      if (missingOriginal) {
        await this.saveAndSilencePhone(place.id);
      } else {
        CheckInService.logCheckIn(this.realm!, place.id, firstLog.savedVolumeLevel, firstLog.savedMediaVolume);
      }

      await this.showNotification(
        'Multiple Silent Zones',
        `Entered ${place.name}. Phone remains silent.`,
        'check-in-multi'
      );
    } else {
      await this.saveAndSilencePhone(place.id);
      await this.showNotification(
        'Phone Silenced 🔕',
        `Entered ${place.name}`,
        'check-in'
      );
    }
  }

  private async handleGeofenceExit(placeId: string, force: boolean = false) {
    const now = Date.now();
    const lastTime = this.lastTriggerTime[placeId] || 0;

    if (!force && now - lastTime < CONFIG.DEBOUNCE_TIME) {
      console.log(`[LocationService] Debouncing exit: ${placeId}`);
      return;
    }
    this.lastTriggerTime[placeId] = now;

    if (!this.realm) return;

    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!CheckInService.isPlaceActive(this.realm, placeId)) return;

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    const thisLog = activeLogs.find(l => l.placeId === placeId);

    if (!thisLog) return;

    if (activeLogs.length === 1) {
      await this.restoreRingerMode(thisLog.id as string);
      CheckInService.logCheckOut(this.realm, thisLog.id as string);
      await this.showNotification(
        'Sound Restored 🔔',
        `You have left ${place?.name || 'the silent zone'}`,
        'check-out'
      );
    } else {
      CheckInService.logCheckOut(this.realm, thisLog.id as string);
      await this.showNotification(
        'Partial Exit',
        `Left ${place?.name || 'location'}. Still in other silent zones.`,
        'check-out-partial'
      );
    }
  }

  private async saveAndSilencePhone(placeId: string) {
    if (Platform.OS !== 'android') return;

    try {
      const hasPermission = await RingerMode.checkDndPermission();

      if (!hasPermission) {
        console.warn('[LocationService] No DND permission');
        await this.showNotification(
          'Permission Required',
          'Grant "Do Not Disturb" access in settings for automatic silencing',
          'dnd-required'
        );
        CheckInService.logCheckIn(this.realm!, placeId);
        return;
      }

      const currentMode = await RingerMode.getRingerMode();
      const currentMediaVolume = await RingerMode.getStreamVolume(RingerMode.STREAM_TYPES.MUSIC);

      console.log(`[LocationService] Saving: mode=${currentMode}, volume=${currentMediaVolume}`);

      CheckInService.logCheckIn(this.realm!, placeId, currentMode, currentMediaVolume);

      try {
        await RingerMode.setRingerMode(RINGER_MODE.silent);
        await RingerMode.setStreamVolume(RingerMode.STREAM_TYPES.MUSIC, 0);
        console.log('[LocationService] Phone silenced');
      } catch (error: any) {
        if (error.code === 'NO_PERMISSION') {
          console.warn('[LocationService] DND permission revoked');
          await RingerMode.requestDndPermission();
        } else {
          console.error('[LocationService] Failed to silence:', error);
        }
      }
    } catch (error) {
      console.error('[LocationService] Save and silence failed:', error);
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
        console.log(`[LocationService] Restoring mode: ${savedMode}`);
        await RingerMode.setRingerMode(savedMode);
      } else {
        await RingerMode.setRingerMode(RINGER_MODE.normal);
      }

      if (savedMediaVolume !== null && savedMediaVolume !== undefined) {
        console.log(`[LocationService] Restoring volume: ${savedMediaVolume}`);
        await RingerMode.setStreamVolume(RingerMode.STREAM_TYPES.MUSIC, savedMediaVolume);
      }

      console.log('[LocationService] Sound restored');
    } catch (error) {
      console.error('[LocationService] Failed to restore:', error);
    }
  }

  /**
   * Schedule a timer to activate silent zone at strict start time
   */
  private scheduleStartTimer(placeId: string, delay: number) {
    // Clear existing if any
    if (this.startTimers[placeId]) {
      clearTimeout(this.startTimers[placeId]);
    }

    console.log(`[LocationService] Scheduled START timer for ${placeId} in ${Math.round(delay / 1000)}s`);

    this.startTimers[placeId] = setTimeout(async () => {
      console.log(`[LocationService] ⏰ Start time arrived for ${placeId}`);
      delete this.startTimers[placeId];
      
      // Re-verify if we are still here? 
      // User might have left but geofence didn't trigger (rare but possible).
      // Ideally receiving a 'Start Trigger' calls handleGeofenceEntry again 
      // which will now fall into "ACTIVE SCHEDULE" block.
      await this.handleGeofenceEntry(placeId);
    }, delay);
  }

  /**
   * Schedule a timer to force exit silent zone at strict end time
   */
  private scheduleEndTimerForPlace(placeId: string, delay: number) {
    if (this.endTimers[placeId]) {
      clearTimeout(this.endTimers[placeId]);
    }

    console.log(`[LocationService] Scheduled END timer for ${placeId} in ${Math.round(delay / 1000)}s`);

    this.endTimers[placeId] = setTimeout(async () => {
      console.log(`[LocationService] ⏰ End time arrived for ${placeId}`);
      delete this.endTimers[placeId];
      
      // Force checkout
      await this.handleGeofenceExit(placeId, true);
    }, delay);
  }

  private async showNotification(title: string, body: string, id: string) {
    try {
      await notifee.displayNotification({
        id,
        title,
        body,
        android: {
          channelId: CONFIG.CHANNELS.ALERTS,
          smallIcon: 'ic_launcher', // Make sure this is a transparent alpha icon if possible, otherwise use default
          largeIcon: 'ic_launcher',
          color: '#8B5CF6', // Purple-500 (Silent Zone Theme)
          pressAction: {
            id: 'default',
          },
        },
        ios: {
          foregroundPresentationOptions: {
            alert: true,
            badge: true,
            sound: true,
          },
        },
      });
    } catch (error) {
      console.error('[LocationService] Notification failed:', error);
    }
  }

  destroy() {
    console.log('[LocationService] Destroying service');
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