import Geofencing from '@rn-org/react-native-geofencing';
import notifee, {
  AndroidImportance,
  AndroidForegroundServiceType,
} from '@notifee/react-native';
import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import { PreferencesService, Preferences } from '../database/services/PreferencesService';
import { CheckInService } from '../database/services/CheckInService';
import { Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import RingerMode, { RINGER_MODE } from '../modules/RingerMode';
import { PermissionsManager } from '../permissions/PermissionsManager';

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
    POST_GRACE_MINUTES: 5,        // Keep active 5 min after schedule ends
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
  private monitoringTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Schedule tracking
  private upcomingSchedules: UpcomingSchedule[] = [];
  private isInScheduleWindow = false;

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
        importance: AndroidImportance.LOW,
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

    try {
      // Small delay to ensure notifee is fully ready
     await new Promise<void>(resolve => setTimeout(() => resolve(), 100));

      const enabledCount = this.realm 
        ? PlaceService.getEnabledPlaces(this.realm).length 
        : 0;

      const inScheduleWindow = this.isInScheduleWindow;
      const nextSchedule = this.upcomingSchedules[0];

      let body = `Monitoring ${enabledCount} location${enabledCount !== 1 ? 's' : ''}`;
      if (inScheduleWindow && nextSchedule) {
        body = `Active: ${nextSchedule.placeName}`;
      } else if (nextSchedule && nextSchedule.minutesUntilStart <= 15) {
        body = `Upcoming: ${nextSchedule.placeName} in ${nextSchedule.minutesUntilStart}m`;
      }

      await notifee.displayNotification({
        id: 'location-tracking-service',
        title: 'Silent Zone Active',
        body,
        android: {
          channelId: CONFIG.CHANNELS.SERVICE,
          asForegroundService: true,
          color: '#3B82F6',
          ongoing: true,
          foregroundServiceTypes: [
            AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION,
          ],
          pressAction: {
            id: 'default',
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
      
      // Calculate active and upcoming schedules
      const { activePlaces, upcomingSchedules } = this.categorizeBySchedule(enabledPlaces);
      this.upcomingSchedules = upcomingSchedules;
      this.isInScheduleWindow = activePlaces.length > 0 && upcomingSchedules.length > 0;

      // Log next schedule if any
      if (upcomingSchedules.length > 0) {
        const next = upcomingSchedules[0];
        console.log(
          `[LocationService] Next schedule: ${next.placeName} in ${next.minutesUntilStart} minutes`
        );
      }

      const activeIdsString = activePlaces.map(p => p.id as string).sort().join(',');

      if (activeIdsString === this.lastEnabledIds && this.geofencesActive) {
        await this.handleManualDisableCleanup(new Set(activePlaces.map(p => p.id as string)));
        return;
      }

      this.lastEnabledIds = activeIdsString;
      console.log(`[LocationService] Syncing: ${activePlaces.length} active locations`);

      await this.handleManualDisableCleanup(new Set(activePlaces.map(p => p.id as string)));
      await Geofencing.removeAllGeofence();
      this.geofencesActive = false;

      if (enabledPlaces.length === 0) {
        console.log('[LocationService] No locations to monitor');
        await this.stopForegroundService();
        return;
      }

      const hasPermissions = await PermissionsManager.hasScanningPermissions();
      if (!hasPermissions) {
        console.warn('[LocationService] Missing required permissions');
        await this.stopForegroundService();
        return;
      }

      // Add geofences for currently active places
      for (const place of activePlaces) {
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

      console.log(`[LocationService] Added ${activePlaces.length} geofences`);
      await this.startForegroundService();
      this.geofencesActive = true;
      
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

        if (isInEffectiveWindow) {
          if (!activePlaces.find(p => p.id === place.id)) {
            activePlaces.push(place);
          }

          // Calculate minutes until start
          let minutesUntilStart: number;
          if (currentTimeMinutes < startTimeMinutes) {
            minutesUntilStart = startTimeMinutes - currentTimeMinutes;
          } else if (currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes) {
            minutesUntilStart = 0; // Already in scheduled time
          } else {
            minutesUntilStart = 0; // In grace period
          }

          // Create schedule object
          const scheduleStart = new Date(now);
          scheduleStart.setHours(startHours, startMins, 0, 0);
          
          const scheduleEnd = new Date(now);
          scheduleEnd.setHours(endHours, endMins, 0, 0);
          if (isOvernight && endTimeMinutes < startTimeMinutes) {
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
    this.runMonitoringCycle();
  }

  private stopGeofenceMonitoring() {
    if (this.monitoringTimeout) {
      clearTimeout(this.monitoringTimeout);
      this.monitoringTimeout = null;
    }
  }

  /**
   * Main monitoring cycle with schedule awareness
   */
  private async runMonitoringCycle() {
    try {
      await this.syncGeofences();
      await this.checkGeofences();

      if (this.isPreferenceTrackingEnabled()) {
        const interval = await this.getDynamicCheckInterval();
        
        // Log interval with context
        const context = this.isInScheduleWindow ? '⏰ ACTIVE' : 
                       this.upcomingSchedules[0]?.minutesUntilStart <= 15 ? '⏳ SOON' : 
                       '💤 IDLE';
        console.log(`[LocationService] ${context} Next check in ${Math.round(interval / 1000)}s`);
        
        this.monitoringTimeout = setTimeout(
          () => this.runMonitoringCycle(),
          interval
        );
      }
    } catch (error) {
      console.error('[LocationService] Monitoring error:', error);
      this.monitoringTimeout = setTimeout(
        () => this.runMonitoringCycle(),
        CONFIG.INTERVALS.CLOSE
      );
    }
  }

  /**
   * SMART INTERVAL CALCULATION
   * Adapts based on:
   * 1. Whether we're in a scheduled time window
   * 2. Distance to nearest location
   * 3. Whether schedules are upcoming
   */
  private async getDynamicCheckInterval(): Promise<number> {
    if (!this.realm || this.realm.isClosed) {
      return CONFIG.INTERVALS.FAR;
    }

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    const { activePlaces, upcomingSchedules } = this.categorizeBySchedule(enabledPlaces);

    // PRIORITY 1: During scheduled time - CHECK FREQUENTLY
    if (this.isInScheduleWindow && activePlaces.length > 0) {
      console.log('[LocationService] ⏰ ACTIVE SCHEDULE - Checking every 10s');
      return CONFIG.INTERVALS.SCHEDULE_ACTIVE;
    }

    // PRIORITY 2: Schedule approaching (within 15 minutes)
    if (upcomingSchedules.length > 0 && upcomingSchedules[0].minutesUntilStart <= 15) {
      console.log(
        `[LocationService] ⏳ Schedule in ${upcomingSchedules[0].minutesUntilStart}m - Checking every 20s`
      );
      return CONFIG.INTERVALS.SCHEDULE_APPROACHING;
    }

    // PRIORITY 3: No active or upcoming schedules - DEEP SLEEP
    const alwaysActivePlaces = enabledPlaces.filter(
      (p: any) => !p.schedules || p.schedules.length === 0
    );

    if (alwaysActivePlaces.length === 0 && activePlaces.length === 0) {
      const timeToNext = this.getTimeToNextSchedule(enabledPlaces);
      const wakeTime = timeToNext - (CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000);
      const sleepDuration = Math.max(60000, Math.min(wakeTime, CONFIG.INTERVALS.DEEP_SLEEP));

      console.log(
        `[LocationService] 💤 DEEP SLEEP for ${Math.round(sleepDuration / 60000)}m ` +
        `(Next schedule in ${Math.round(timeToNext / 60000)}m)`
      );
      
      return sleepDuration;
    }

    // PRIORITY 4: Distance-based for always-active places
    const placesToCheck = [...alwaysActivePlaces, ...activePlaces];
    
    if (
      this.lastKnownLocation &&
      Date.now() - this.lastKnownLocation.timestamp < 30000
    ) {
      return this.calculateIntervalFromDistance(this.lastKnownLocation, placesToCheck);
    }

    return new Promise(resolve => {
      Geolocation.getCurrentPosition(
        position => {
          const locationState: LocationState = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: Date.now(),
          };
          
          this.lastKnownLocation = locationState;
          const interval = this.calculateIntervalFromDistance(locationState, placesToCheck);
          resolve(interval);
        },
        error => {
          console.warn('[LocationService] Location unavailable:', error);
          resolve(CONFIG.INTERVALS.FAR);
        },
        {
          enableHighAccuracy: false,
          timeout: 5000,
          maximumAge: 30000,
        }
      );
    });
  }

  private calculateIntervalFromDistance(location: LocationState, places: any[]): number {
    let minDistance = Infinity;

    for (const place of places) {
      const dist = this.calculateDistance(
        location.latitude,
        location.longitude,
        place.latitude as number,
        place.longitude as number
      );
      minDistance = Math.min(minDistance, dist);
    }

    if (minDistance <= CONFIG.DISTANCE.VERY_CLOSE) {
      return CONFIG.INTERVALS.VERY_CLOSE;
    } else if (minDistance <= CONFIG.DISTANCE.CLOSE) {
      return CONFIG.INTERVALS.CLOSE;
    } else if (minDistance <= CONFIG.DISTANCE.NEAR) {
      return CONFIG.INTERVALS.NEAR;
    } else {
      return CONFIG.INTERVALS.FAR;
    }
  }

  /**
   * Calculate time until next schedule
   */
  private getTimeToNextSchedule(places: any[]): number {
    let minDiff = Infinity;
    const now = new Date();
    const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

    for (const place of places) {
      if (!place.schedules || place.schedules.length === 0) continue;

      for (const schedule of place.schedules) {
        if (schedule.days.length > 0 && !schedule.days.includes(currentDay)) {
          continue;
        }

        const [startHours, startMins] = schedule.startTime.split(':').map(Number);
        const startTimeMinutes = startHours * 60 + startMins;

        if (startTimeMinutes > currentTimeMinutes) {
          const diffMinutes = startTimeMinutes - currentTimeMinutes;
          const diffMs = diffMinutes * 60 * 1000;
          minDiff = Math.min(minDiff, diffMs);
        }
      }
    }

    return minDiff === Infinity ? CONFIG.INTERVALS.DEEP_SLEEP : minDiff;
  }

  /**
   * Check current location against geofences
   * OPTIMIZED FOR SMALL RADIUS (30m+)
   */
  private async checkGeofences(): Promise<void> {
    const hasPermissions = await PermissionsManager.hasScanningPermissions();
    const gpsEnabled = await PermissionsManager.isGpsEnabled();

    if (!hasPermissions || !gpsEnabled) {
      console.warn(`[LocationService] Requirements not met: perms=${hasPermissions}, gps=${gpsEnabled}`);
      return;
    }

    if (!this.realm || this.realm.isClosed || this.isChecking) return;

    this.isChecking = true;

    return new Promise<void>(resolve => {
      Geolocation.getCurrentPosition(
        async position => {
          try {
            await this.processLocationUpdate(position);
          } catch (error) {
            console.error('[LocationService] Processing error:', error);
          } finally {
            resolve();
          }
        },
        error => {
          console.error('[LocationService] Location error:', error);
          resolve();
        },
        {
          enableHighAccuracy: true,
          timeout: CONFIG.GPS_TIMEOUT,
          maximumAge: CONFIG.GPS_MAXIMUM_AGE,
        }
      );
    }).finally(() => {
      this.isChecking = false;
    });
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
    }

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    const { activePlaces } = this.categorizeBySchedule(enabledPlaces);

    console.log(`[LocationService] Checking ${activePlaces.length} active locations`);

    await this.validateCurrentCheckIns(latitude, longitude, accuracy, activePlaces);
    const insidePlaces = this.determineInsidePlaces(latitude, longitude, accuracy, activePlaces);
    await this.handleScheduleCleanup(activePlaces);
    await this.handleNewEntries(insidePlaces);
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
    if (!this.realm) return;

    const activePlaceIds = new Set(activePlaces.map(p => p.id));
    const activeLogs = CheckInService.getActiveCheckIns(this.realm);

    for (const log of activeLogs) {
      if (!activePlaceIds.has(log.placeId as string)) {
        console.log(`[LocationService] Schedule ended: ${log.placeId}`);
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

    if (now - lastTime < CONFIG.DEBOUNCE_TIME) {
      console.log(`[LocationService] Debouncing entry: ${placeId}`);
      return;
    }
    this.lastTriggerTime[placeId] = now;

    if (!this.realm) return;

    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !place.isEnabled) return;

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);

    if (activeLogs.length > 0) {
      const firstLog = activeLogs[0] as any;
      const missingOriginal = firstLog.savedVolumeLevel == null || firstLog.savedMediaVolume == null;

      if (missingOriginal) {
        await this.saveAndSilencePhone(placeId);
      } else {
        CheckInService.logCheckIn(this.realm, placeId, firstLog.savedVolumeLevel, firstLog.savedMediaVolume);
      }

      await this.showNotification(
        'Multiple Silent Zones',
        `Entered ${place.name}. Phone remains silent.`,
        'check-in-multi'
      );
    } else {
      await this.saveAndSilencePhone(placeId);
      await this.showNotification(
        'Silent Zone Active',
        `Entered ${place.name}. Phone silenced.`,
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
        'Silent Zone Deactivated',
        `Left ${place?.name || 'location'}. Sound restored.`,
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

  private async showNotification(title: string, body: string, id: string) {
    try {
      await notifee.displayNotification({
        id,
        title,
        body,
        android: {
          channelId: CONFIG.CHANNELS.ALERTS,
          smallIcon: 'ic_launcher',
          color: '#3B82F6',
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
    this.isReady = false;
    this.geofencesActive = false;
    this.lastKnownLocation = null;
    this.upcomingSchedules = [];
  }
}

export const locationService = new LocationService();