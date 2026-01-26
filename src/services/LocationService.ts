import Geofencing from '@rn-org/react-native-geofencing';
import notifee, {
  AndroidImportance,
  AndroidForegroundServiceType,
  TriggerType,
  AndroidCategory,
  AlarmType,
} from '@notifee/react-native';
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
      await this.createNotificationChannels();
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
      const { upcomingSchedules } = this.categorizeBySchedule(Array.from(enabledPlaces));
      this.upcomingSchedules = upcomingSchedules;
      Logger.info(`[Restore] Found ${this.upcomingSchedules.length} upcoming schedule(s)`);

      // 3. Determine if we're currently in a schedule window
      const now = new Date();
      
      let foundActiveWindow = false;
      for (const place of enabledPlaces) {
        const schedules = (place as any).schedules || [];
        for (const schedule of schedules) {
          const isActive = this.isScheduleActiveNow(schedule, now);
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
   * Helper: Check if a schedule is active RIGHT NOW
   */
  private isScheduleActiveNow(schedule: any, now: Date): boolean {
    const currentDayIndex = now.getDay();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDay = days[currentDayIndex];
    
    // Check if schedule has days defined and includes today
    if (schedule.days.length > 0 && !schedule.days.includes(currentDay)) {
      return false;
    }

    const [startHours, startMinutes] = schedule.startTime.split(':').map(Number);
    const [endHours, endMinutes] = schedule.endTime.split(':').map(Number);

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutesTotal = startHours * 60 + startMinutes;
    const endMinutesTotal = endHours * 60 + endMinutes;

    // Handle overnight schedules (e.g., 23:00 to 01:00)
    if (endMinutesTotal < startMinutesTotal) {
      return nowMinutes >= startMinutesTotal || nowMinutes <= endMinutesTotal;
    }

    return nowMinutes >= startMinutesTotal && nowMinutes <= endMinutesTotal;
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
      
      Logger.info('[LocationService] Notification channels created');
    } catch (error) {
      Logger.error('[LocationService] Failed to create channels:', error);
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

    // Check for CRITICAL background location permission (Loc + Bg + Notif)
    const hasPermission = await PermissionsManager.hasCriticalPermissions();
    Logger.info(`[LocationService] Critical permissions check: ${hasPermission}`);
    if (!hasPermission) {
      Logger.error('[LocationService] ❌ Aborting start: Missing critical permissions in background');
      
      // CRITICAL: Notify user why it failed
      await this.showNotification(
        'Setup Required',
        'Silent Zone failed to start. Please open app and check permissions.',
        'permission-failure'
      );
      return; 
    }

    try {
      // Small delay to ensure notifee is fully ready
      await new Promise<void>(resolve => setTimeout(() => resolve(), 100));

      const enabledCount = this.realm 
        ? PlaceService.getEnabledPlaces(this.realm).length 
        : 0;

      const nextSchedule = this.upcomingSchedules[0];

      // Default state
      let title = '🛡️ Silent Zone Running';
      let body = `Monitoring ${enabledCount} active location${enabledCount !== 1 ? 's' : ''}`;
      
      // Check if we are ACTUALLY inside (checked in)
      const activeCheckIns = this.realm ? CheckInService.getActiveCheckIns(this.realm) : [];
      
      if (activeCheckIns.length > 0) {
        // We are INSIDE
        const placeId = activeCheckIns[0].placeId;
        const place = this.realm ? PlaceService.getPlaceById(this.realm, placeId as string) : null;
        title = '🔕 Silent Zone Active';
        body = `📍 Inside ${place ? place.name : 'Unknown Location'}`;
      } else if (nextSchedule && nextSchedule.minutesUntilStart > 0 && nextSchedule.minutesUntilStart <= 15) {
        // Approaching (Only if > 0 minutes)
        title = '⏱️ Preparing to Silence';
        body = `🔜 ${nextSchedule.placeName} starts in ${nextSchedule.minutesUntilStart} min`;
      } else if (this.isInScheduleWindow && nextSchedule) {
        // In schedule window but NOT validated as inside yet (Active or 0 min)
        title = '🛡️ Silent Zone Monitoring';
        body = `Targeting ${nextSchedule.placeName}`;
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

    Logger.info('[LocationService] Foreground service started (Notification displayed)');
  } catch (error) {
    Logger.error('[LocationService] Failed to start service notification:', error);
  } finally {
    // CRITICAL: Always start result watcher, even if notification failed
    this.startGeofenceMonitoring();
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
    Logger.info(`[LocationService] Restoring timers for ${activeLogs.length} active sessions`);

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
    if (Platform.OS === 'android') {
      try {
        await notifee.stopForegroundService();
        await notifee.cancelNotification('location-tracking-service');
        Logger.info('[LocationService] Service stopped');
      } catch (error) {
        Logger.error('[LocationService] Error stopping service:', error);
      }
    }
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
             await this.cancelAlarmsForPlace(place.id as string);
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
          await this.cancelAlarmsForPlace(place.id as string);
      }
      
      const { activePlaces, upcomingSchedules } = this.categorizeBySchedule(enabledPlaces);
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
              await this.cancelAlarmsForPlace(place.id as string);
              await this.scheduleAlarmsForPlace(place);
            }
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
          
          // Schedule individual alarms for all enabled places
          for (const place of enabledPlaces) {
            if (place.isEnabled) {
              await this.cancelAlarmsForPlace(place.id as string);
              await this.scheduleAlarmsForPlace(place);
            }
          }
      }
      
    } catch (error) {
      Logger.error('[LocationService] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * SCHEDULE-AWARE CATEGORIZATION
   * Returns places that are currently active or will be active soon
   * Works for ANY scheduled location (mosque, office, gym, etc.)
   * 
   * CRITICAL: Returns TWO separate lists:
   * 1. activePlaces: Places within monitoring window (for location checking)
   * 2. upcomingSchedules: ALL future schedules (for alarm scheduling)
   * 
   * UPDATED: Now checks TOMORROW's schedules too for seamless overnight transition
   */
  private categorizeBySchedule(enabledPlaces: any[]): {
    activePlaces: any[];
    upcomingSchedules: UpcomingSchedule[];
  } {
    const now = new Date();
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
    const currentDayIndex = now.getDay();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    const activePlaces: any[] = [];
    const upcomingSchedules: UpcomingSchedule[] = [];

    for (const place of enabledPlaces) {
      // Places without schedules are always active (24/7 locations)
      if (!place.schedules || place.schedules.length === 0) {
        activePlaces.push(place);
        continue;
      }

      // Check each schedule for TODAY and TOMORROW
      // offset 0 = Today, offset 1 = Tomorrow
      for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
         const targetDayIndex = (currentDayIndex + dayOffset) % 7;
         const targetDayName = days[targetDayIndex];

         for (const schedule of place.schedules) {
            // Day check
            if (schedule.days.length > 0 && !schedule.days.includes(targetDayName)) {
               continue;
            }

            const [startHours, startMins] = schedule.startTime.split(':').map(Number);
            const [endHours, endMins] = schedule.endTime.split(':').map(Number);
            
            // Basic minutes in the target day
            let startTimeMinutes = startHours * 60 + startMins;
            let endTimeMinutes = endHours * 60 + endMins;

            // If checking TOMORROW, shift times forward by 24 hours (1440 minutes)
            if (dayOffset === 1) {
               startTimeMinutes += 1440;
               endTimeMinutes += 1440;
            }

            // Calculate with activation window and grace period
            const preActivationMinutes = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES;
            const postGraceMinutes = CONFIG.SCHEDULE.POST_GRACE_MINUTES;
            
            const effectiveStartMinutes = startTimeMinutes - preActivationMinutes;
            const effectiveEndMinutes = endTimeMinutes + postGraceMinutes;

            // Handle overnight schedules (e.g., night shift 22:00 - 06:00)
            const isOvernight = (startHours * 60 + startMins) > (endHours * 60 + endMins);
            
            // Note: Even for overnight, if we are checking TOMORROW with +1440 offset,
            // standard comparison works nicely because we linearize time.
            let isInEffectiveWindow = false;

            if (dayOffset === 0 && isOvernight) {
               // Special handling for overnight ON THE SAME DAY vs NEXT DAY wrap is tricky with linear time.
               // But standard overnight logic applies to "Today" specifically.
               isInEffectiveWindow = currentTimeMinutes >= effectiveStartMinutes || 
                                     currentTimeMinutes <= effectiveEndMinutes;
               
               // Fix: If checking TODAY and it's overnight starting yesterday (e.g. 02:00 < 22:00), 
               // effectiveStartMinutes is 22:00-15m.
               // This standard check works.
            } else {
               // Standard linear check (works for Today non-overnight AND Tomorrow shifted)
               isInEffectiveWindow = currentTimeMinutes >= effectiveStartMinutes && 
                                     currentTimeMinutes <= effectiveEndMinutes;
            }

            // Add to activePlaces if in monitoring window
            if (isInEffectiveWindow) {
               if (!activePlaces.find(p => p.id === place.id)) {
                  activePlaces.push(place);
               }
            }

            // FUTURE SCHEDULE CHECK
            let isFutureSchedule = false;
            let minutesUntilStart: number = 0;
            let isOvernightActive = false;

            if (dayOffset === 0 && isOvernight && currentTimeMinutes < (startHours * 60 + startMins)) {
               // Overnight part 2 (early morning of next day schedule started yesterday)
               // ACTUALLY: If isOvernight is true (e.g. 22:00-06:00), and now is 02:00.
               // 02:00 < 22:00.
               // We are in the "active" part.
               minutesUntilStart = 0;
               isOvernightActive = true;
               isFutureSchedule = false;
            } else if (currentTimeMinutes < startTimeMinutes) {
               // Future schedule (not started yet)
               // This works for Today (10:00 < 12:00) AND Tomorrow (23:00 < 24:05)
               minutesUntilStart = startTimeMinutes - currentTimeMinutes;
               isFutureSchedule = true;
            } else if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes) {
               // Currently active
               minutesUntilStart = 0;
               isFutureSchedule = false;
            } else {
               // Schedule has passed
               continue;
            }

            // Add to upcomingSchedules if it's in the effective window OR a future schedule
            // Only add unique schedules based on calculated start time to avoid dupes if logic overlaps
            // (But offset 1 ensures uniqueness from offset 0 usually)
            if (isInEffectiveWindow || isFutureSchedule) {
               // Create schedule object
               const scheduleStart = new Date(now);
               scheduleStart.setHours(startHours, startMins, 0, 0);
               
               // Adjust date based on offset
               scheduleStart.setDate(scheduleStart.getDate() + dayOffset);

               if (isOvernightActive && dayOffset === 0) {
                  // If we are in the early morning part of an overnight schedule, it started yesterday
                  scheduleStart.setDate(scheduleStart.getDate() - 1);
               }
               
               const scheduleEnd = new Date(scheduleStart);
               const durationMinutes = (endHours * 60 + endMins) - (startHours * 60 + startMins) + (isOvernight ? 1440 : 0);
               scheduleEnd.setMinutes(scheduleEnd.getMinutes() + durationMinutes);

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
        Logger.info(`[LocationService] Force checkout: ${log.placeId}`);
        await this.handleGeofenceExit(log.placeId as string, true);
      }
    }
  }

  private async startGeofenceMonitoring() {
    this.stopGeofenceMonitoring();
    
    // CRITICAL: Give Notifee time to promote app to Foreground Service
    // Android "While In Use" permission only applies AFTER the service is fully running.
    // Without this delay, the location request might loose the race and be denied.
    await new Promise<void>(resolve => setTimeout(() => resolve(), 2000));
    
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
        const isActive = this.isScheduleActiveNow(schedule, now);
        
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
   * Schedule individual alarms for all schedules in a place
   * Each schedule gets its own alarm - more reliable than dual-alarm system
   */
  /**
   * Schedule individual alarms for all schedules in a place (Today + Tomorrow)
   */
  private async scheduleAlarmsForPlace(place: any) {
    if (!place.schedules || place.schedules.length === 0) {
      Logger.info(`[LocationService] No schedules for ${place.name}, skipping alarm setup`);
      return;
    }

    let alarmsScheduled = 0;
    const now = new Date();

    // Loop through each user-defined schedule (e.g., 5 prayers)
    for (let i = 0; i < place.schedules.length; i++) {
      const schedule = place.schedules[i];
      const [startHour, startMin] = schedule.startTime.split(':').map(Number);
      
    // We schedule alarms for TODAY and TOMORROW to ensure continuity
    // Day Offset 0 = Today, 1 = Tomorrow
    for (let dayOffset = 0; dayOffset <= 1; dayOffset++) {
      // Construct target start time
      const targetTime = new Date(now);
      targetTime.setHours(startHour, startMin, 0, 0);
      
      if (dayOffset === 1) {
          targetTime.setDate(targetTime.getDate() + 1);
      }

      // --- ALARM 1: MONITORING START (15 mins before) ---
      const preActivationMillis = CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000;
      const monitorTime = targetTime.getTime() - preActivationMillis;

      if (monitorTime > Date.now()) {
          const monitorAlarmId = `place-${place.id}-sched-${i}-day-${dayOffset}-type-monitor`;
          await this.scheduleSingleAlarm(
              monitorAlarmId,
              monitorTime,
              place.id,
              'START_MONITORING',
              'Schedule Approaching',
              `${place.name} starting soon`
          );
          alarmsScheduled++;
      }

      // --- ALARM 2: ACTIVATE SILENCE (Exact Start) ---
      const startTime = targetTime.getTime();
      if (startTime > Date.now()) {
          const startAlarmId = `place-${place.id}-sched-${i}-day-${dayOffset}-type-start`;
          await this.scheduleSingleAlarm(
              startAlarmId,
              startTime,
              place.id,
              'START_SILENCE',
              'Silent Zone Starting',
              `Activating ${place.name} now`
          );
          alarmsScheduled++;
      }

      // --- ALARM 3: DEACTIVATE SILENCE (Exact End) ---
      // Determine duration
      const [endHour, endMin] = schedule.endTime.split(':').map(Number);
      const startTotal = startHour * 60 + startMin;
      const endTotal = endHour * 60 + endMin;
      // Handle overnight duration
      const durationMinutes = endTotal >= startTotal ? (endTotal - startTotal) : (1440 - startTotal + endTotal);
      
      const endTime = startTime + (durationMinutes * 60 * 1000);
      
      if (endTime > Date.now()) {
          const endAlarmId = `place-${place.id}-sched-${i}-day-${dayOffset}-type-end`;
          // We schedule this as "STOP_SILENCE" to force wakeup and exit
          await this.scheduleSingleAlarm(
              endAlarmId,
              endTime,
              place.id,
              'STOP_SILENCE',
              'Silent Zone Ending',
              `Leaving ${place.name}`
          );
          alarmsScheduled++;
      }
    }
    }
    Logger.info(`[LocationService] Scheduled ${alarmsScheduled} alarms for ${place.name}`);
  }

  /**
   * Helper to schedule a single alarm
   */
  private async scheduleSingleAlarm(
      id: string, 
      timestamp: number, 
      placeId: string, 
      action: string,
      title: string, 
      body: string
  ) {
      try {
        await notifee.createTriggerNotification(
          {
            id,
            title,
            body,
            data: {
              action, // START_MONITORING or START_SILENCE
              placeId,
              scheduledTime: new Date(timestamp).toISOString(),
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
          {
            type: TriggerType.TIMESTAMP,
            timestamp,
            alarmManager: {
              allowWhileIdle: true,
              type: AlarmType.SET_EXACT_AND_ALLOW_WHILE_IDLE,
            },
          }
        );
        Logger.info(`[LocationService] ✅ Alarm set: ${action} @ ${new Date(timestamp).toLocaleTimeString()} (ID: ${id})`);
      } catch (error) {
        Logger.error(`[LocationService] Failed to schedule alarm ${id}:`, error);
      }
  }

  /**
   * Cancel all alarms for a specific place
   */
  private async cancelAlarmsForPlace(placeId: string, scheduleCount: number = 10) {
    // Cancel alarms for today (day-0) and tomorrow (day-1) for each schedule index
    for (let i = 0; i < scheduleCount; i++) {
        const types = ['monitor', 'start', 'end'];
        for (const type of types) {
             const idDay0 = `place-${placeId}-sched-${i}-day-0-type-${type}`;
             const idDay1 = `place-${placeId}-sched-${i}-day-1-type-${type}`;
             try { await notifee.cancelTriggerNotification(idDay0); } catch (e) {}
             try { await notifee.cancelTriggerNotification(idDay1); } catch (e) {}
        }
    }
    Logger.info(`[LocationService] Cancelled alarms for place ${placeId}`);
  }


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
      
      // Log what triggered us
      if (action === 'START_MONITORING') {
        Logger.info('[LocationService] 🟡 Pre-activation alarm (15min before)');
      } else if (action === 'START_SILENCE') {
        Logger.info('[LocationService] 🔴 Activation alarm (exact time)');
      } else if (action === 'STOP_SILENCE') {
        Logger.info('[LocationService] 🟢 Deactivation alarm (end time)');
      }

      // Execute sync
      await this.syncGeofences();

      // If this was a START_SILENCE alarm, immediately check location
      if (action === 'START_SILENCE') {
        Logger.info('[LocationService] 🎯 START_SILENCE: Forcing immediate location check');
        
        // Get current location immediately
        Geolocation.getCurrentPosition(
          (position) => {
            Logger.info('[LocationService] Got immediate position after START_SILENCE');
            this.processLocationUpdate(position);
          },
          (error) => {
            Logger.error('[LocationService] Failed to get immediate position:', error);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
        );
      }

      // If this was a STOP_SILENCE alarm, force exit
      if (action === 'STOP_SILENCE') {
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
        // Small delay before processing next
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
      (error) => {
        Logger.error('[LocationService] Watch error:', error);
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

    Logger.info(
      `[LocationService] Location: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}, ` +
      `accuracy: ${accuracy.toFixed(1)}m`
    );

    if (accuracy > CONFIG.MAX_ACCEPTABLE_ACCURACY) {
      Logger.warn(`[LocationService] Poor GPS accuracy (${accuracy.toFixed(0)}m)`);
      // We still process it, but maybe with caution?
      // For now, let's proceed but just warn.
    }

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    const { activePlaces, upcomingSchedules } = this.categorizeBySchedule(enabledPlaces);

    // Filter upcoming schedules that are in the "pre-start" window
    const relevantUpcomingPlaces = upcomingSchedules
        .filter(s => s.minutesUntilStart <= CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES)
        .map(s => enabledPlaces.find(p => p.id === s.placeId))
        .filter(p => p !== undefined);

    const placesToCheck = [...activePlaces, ...relevantUpcomingPlaces];
    // Remove duplicates
    const uniquePlacesToCheck = Array.from(new Set(placesToCheck.map(p => p.id)))
        .map(id => placesToCheck.find(p => p.id === id));

    Logger.info(`[LocationService] Checking ${activePlaces.length} active + ${relevantUpcomingPlaces.length} upcoming locations`);

    await this.validateCurrentCheckIns(latitude, longitude, accuracy, activePlaces);
    
    // Check against ALL relevant places (Active + Upcoming)
    const insidePlaces = this.determineInsidePlaces(latitude, longitude, accuracy, uniquePlacesToCheck);
    
    await this.handleScheduleCleanup(activePlaces);
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
        Logger.info(
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
          Logger.info(
            `[LocationService] ${place.name} (PRECISE): dist=${Math.round(distance)}m, inside=${isInside}`
          );
          return isInside;
        }

        if (accuracy < 50) {
          const effectiveDistance = Math.max(0, distance - accuracy * 0.6);
          const isInside = effectiveDistance <= radius + 12;
          Logger.info(
            `[LocationService] ${place.name} (MODERATE): dist=${Math.round(distance)}m, inside=${isInside}`
          );
          return isInside;
        }

        if (accuracy <= CONFIG.MAX_ACCEPTABLE_ACCURACY) {
          const isVeryClose = distance <= radius + 20;
          const maybeInside = distance <= radius + accuracy * 0.5;
          const isInside = isVeryClose || maybeInside || isActive;
          
          Logger.info(
            `[LocationService] ${place.name} (POOR ACC): inside=${isInside}`
          );
          return isInside;
        }

        if (isActive) {
          Logger.info(`[LocationService] ${place.name}: Maintaining active state`);
          return true;
        }

        return false;
      }

      // For larger radius, use standard detection
      const radiusWithBuffer = radius * CONFIG.EXIT_BUFFER_MULTIPLIER;
      const effectiveDistance = Math.max(0, distance - accuracy);
      const isInside = effectiveDistance <= radiusWithBuffer || distance <= radius + 10;

      Logger.info(
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
      Logger.info(`[LocationService] Debouncing entry: ${placeId}`);
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
        const result = CheckInService.logCheckIn(this.realm!, place.id, firstLog.savedVolumeLevel, firstLog.savedMediaVolume);
        if (!result) {
           Logger.error(`[LocationService] Failed to log check-in (multi) for ${place.id}, aborting notification`);
           return;
        }
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
      Logger.info(`[LocationService] Debouncing exit: ${placeId}`);
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
        Logger.warn('[LocationService] No DND permission');
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
      Logger.error('[LocationService] Notification failed:', error);
    }
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