import Geofencing from '@rn-org/react-native-geofencing';
import notifee, { AndroidImportance, AndroidForegroundServiceType } from '@notifee/react-native';
import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import { CheckInService } from '../database/services/CheckInService';
import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import RingerMode, { RINGER_MODE } from '../modules/RingerMode';
import { PermissionsManager } from '../permissions/PermissionsManager';

class LocationService {
  private realm: Realm | null = null;
  private isReady = false;
  private lastTriggerTime: { [key: string]: number } = {};
  private readonly DEBOUNCE_TIME = 10000; // 10 seconds
  private savedRingerMode: number | null = null; // Store original ringer mode
  private lastEnabledIds: string = ''; // For change detection
  private isChecking = false;
  private isSyncing = false;
  private monitoringTimeout: ReturnType<typeof setTimeout> | null = null;

  // Initialize service
  async initialize(realmInstance: Realm) {
    if (this.isReady) return;
    this.realm = realmInstance;

    // 1. Request Location Permissions
    await this.requestLocationPermissions();

    // 2. Request Notification Permissions
    await notifee.requestPermission();
    
    // Create channel for service
    if (Platform.OS === 'android') {
        await notifee.createChannel({
            id: 'silent-zone-service-channel',
            name: 'Silent Zone Service',
            importance: AndroidImportance.LOW, // Low priority for ongoing service
        });
    }

    // 3. Request DND Permission (required to change ringer mode)
    // We already handle this in the onboarding, but good to have as backup
    const hasPermission = await RingerMode.checkDndPermission();
    if (!hasPermission) {
        console.log('[LocationService] DND permission not granted, requesting...');
        await RingerMode.requestDndPermission();
    }

    // 4. Sync and listen for database changes
    this.syncGeofences();
    this.setupReactiveSync();

    // 5. Start monitoring geofences with Foreground Service
    if (this.isPreferenceTrackingEnabled()) {
        await this.startForegroundService();
    }

    this.isReady = true;
    console.log('[LocationService] Initialized and monitoring (Foreground Service)');
  }

  private async startForegroundService() {
    if (Platform.OS !== 'android') {
        this.startGeofenceMonitoring(); // Fallback for iOS
        return;
    }

    try {
        await notifee.displayNotification({
            id: 'silent-zone-service',
            title: 'Silent Zone Active',
            body: 'Monitoring your location for silent zones...',
            android: {
                channelId: 'silent-zone-service-channel',
                asForegroundService: true,
                color: '#3B82F6', // theme.colors.primary
                ongoing: true,
                foregroundServiceTypes: [AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_LOCATION],
                pressAction: {
                    id: 'default',
                },
            },
        });

        this.startGeofenceMonitoring();
    } catch (error) {
        console.error('[LocationService] Failed to start foreground service:', error);
    }
  }

  private async stopForegroundService() {
    if (Platform.OS === 'android') {
        try {
            await notifee.stopForegroundService();
            await notifee.cancelNotification('silent-zone-service');
            console.log('[LocationService] Foreground Service notification cleared');
        } catch (e) {
            console.error('[LocationService] Error stopping service:', e);
        }
    }
    this.stopGeofenceMonitoring();
  }

  /**
   * Emergency cleanup used by CrashHandler
   * Attempts to restore sound and stop the service if the JS engine fails.
   */
  async cleanupOnCrash() {
    console.log('[LocationService] Emergency cleanup triggered...');
    try {
        if (!this.realm) return; // Cannot restore if DB is inaccessible
        
        const activeLogs = CheckInService.getActiveCheckIns(this.realm);
        if (activeLogs.length > 0) {
            console.log(`[LocationService] Restoring sound for ${activeLogs.length} active zones before exit.`);
            for (const log of activeLogs) {
                // We use a try-catch for each to ensure we try as many as possible
                try {
                    await this.restoreRingerMode(log.id as string);
                    CheckInService.logCheckOut(this.realm, log.id as string);
                } catch (e) {
                    console.error('[LocationService] Failed to restore specific zone during crash:', e);
                }
            }
        }
    } catch (error) {
        console.error('[LocationService] Emergency restore failed:', error);
    } finally {
        await this.stopForegroundService();
    }
  }

  private isPreferenceTrackingEnabled(): boolean {
    if (!this.realm) return false;
    const prefs = this.realm.objectForPrimaryKey('Preferences', 'USER_PREFS') as any;
    return prefs ? prefs.trackingEnabled : true;
  }

  private async requestLocationPermissions() {
    await PermissionsManager.requestLocationAlways();
  }

  private setupReactiveSync() {
    if (!this.realm) return;

    // 1. Listen for Places
    const places = this.realm.objects('Place');
    places.addListener((collection, changes) => {
        // Broad check for structural changes OR modifications
        if (changes.insertions.length > 0 || changes.deletions.length > 0 || changes.newModifications.length > 0) {
            this.syncGeofences();
        }
    });

    // 2. Listen for Preferences (Global Pause/Resume)
    const prefs = this.realm.objectForPrimaryKey('Preferences', 'USER_PREFS');
    if (prefs) {
        prefs.addListener(() => {
            console.log('[LocationService] Preferences changed, syncing...');
            this.syncGeofences();
        });
    }
  }

  async syncGeofences() {
    if (!this.realm || this.realm.isClosed) return;
    if (this.isSyncing) return;

    this.isSyncing = true;
    try {
      const trackingEnabled = this.isPreferenceTrackingEnabled();
      const enabledPlaces = trackingEnabled ? PlaceService.getEnabledPlaces(this.realm) : [];
      const enabledIdsArray = enabledPlaces.map(p => p.id as string);
      const enabledIdsString = enabledIdsArray.sort().join(',');
      const enabledIdsSet = new Set(enabledIdsArray);
      
      // 1. Check for redundant syncs (prevent loops from isInside toggle)
      if (enabledIdsString === this.lastEnabledIds) {
          // If the list of enabled places hasn't changed, 
          // we should still handle Force CheckOut in case singular places were toggled
          // but if nothing actually structural changed, we can exit early.
          this.handleManualDisableCleanup(enabledIdsSet);
          return;
      }
      this.lastEnabledIds = enabledIdsString;
      console.log('[LocationService] Syncing geofences...');

      // 2. Handle "Force CheckOut" for any active zones that were just disabled/deleted/paused
      await this.handleManualDisableCleanup(enabledIdsSet);

      // 3. Clear and re-add geofences
      await Geofencing.removeAllGeofence();

      if (enabledPlaces.length === 0 || !trackingEnabled) {
          console.log('[LocationService] Tracking stopped (pause or no places).');
          await this.stopForegroundService();
          return;
      }

      // 4. Add Geofences
      for (const place of enabledPlaces) {
         await Geofencing.addGeofence({
            id: place.id as string,
            latitude: place.latitude as number,
            longitude: place.longitude as number,
            radius: Math.max(100, (place.radius as number) + 20),
         });
      }
      
      console.log(`[LocationService] Monitoring ${enabledPlaces.length} geofences`);
      await this.startForegroundService();

    } catch (error) {
      console.error('[LocationService] Sync failed:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  private async handleManualDisableCleanup(enabledIdsSet: Set<string>) {
      if (!this.realm) return;
      const activeLogs = CheckInService.getActiveCheckIns(this.realm);
      for (const log of activeLogs) {
          if (!enabledIdsSet.has(log.placeId as string)) {
              console.log(`[LocationService] Manual disable detected for: ${log.placeId}`);
              // Use force=true to bypass debounce
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

  private async runMonitoringCycle() {
    await this.checkGeofences();
    
    // Schedule next run
    if (this.isPreferenceTrackingEnabled()) {
        const interval = await this.getDynamicCheckInterval();
        console.log(`[LocationService] Next check in ${Math.round(interval / 1000)}s`);
        this.monitoringTimeout = setTimeout(() => this.runMonitoringCycle(), interval);
    }
  }

  private async getDynamicCheckInterval(): Promise<number> {
    if (!this.realm || this.realm.isClosed) return 60000; // Default 1m if closed

    const enabledPlaces = PlaceService.getEnabledPlaces(this.realm);
    const activeScheduledPlaces = enabledPlaces.filter(p => this.isWithinSchedule(p));

    // 1. "Deep Sleep": If no places are scheduled for NOW
    if (activeScheduledPlaces.length === 0) {
        // Calculate exact time until the next schedule starts to wake up precisely
        const timeToNext = this.getTimeToNextSchedule(Array.from(enabledPlaces));
        
        // Cap the sleep at 30 minutes. 
        // If the next schedule is in 7 minutes, we sleep 7 minutes.
        // If it's in 4 hours, we sleep 30 minutes and check again.
        const sleepDuration = Math.min(timeToNext, 30 * 60 * 1000);
        
        // Ensure we don't sleep for tiny intervals (min 1 minute)
        const finalSleep = Math.max(sleepDuration, 60000);
        
        console.log(`[LocationService] Deep Sleep: ${Math.round(finalSleep / 60000)}m (Next schedule in ${Math.round(timeToNext / 60000)}m)`);
        return finalSleep;
    }

    // 2. "Distance-Aware Polling"
    // We need the last known position to decide distance.
    // If we don't have it, we default to 1 minute.
    return new Promise((resolve) => {
        Geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                let minDistance = Infinity;

                activeScheduledPlaces.forEach(place => {
                    const dist = this.calculateDistance(
                        latitude,
                        longitude,
                        place.latitude as number,
                        place.longitude as number
                    );
                    if (dist < minDistance) minDistance = dist;
                });

                if (minDistance <= 500) {
                    resolve(15000); // 15 seconds (Close or Inside)
                } else if (minDistance <= 2000) {
                    resolve(60000); // 1 minute (Near)
                } else if (minDistance <= 5000) {
                    resolve(5 * 60 * 1000); // 5 minutes (Approaching)
                } else {
                    resolve(10 * 60 * 1000); // 10 minutes (Far)
                }
            },
            (error) => {
                console.warn('[LocationService] Could not get position for interval calc:', error);
                resolve(60000); // fallback to 1m
            },
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 30000 }
        );
    });
  }

  private isWithinSchedule(place: any): boolean {
    if (!place.schedules || place.schedules.length === 0) return true; // Always Active if no schedule

    const now = new Date();
    const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

    return place.schedules.some((s: any) => {
        // Day match
        const dayMatch = s.days.length === 0 || s.days.includes(currentDay);
        if (!dayMatch) return false;

        // Time match
        const [startHours, startMins] = s.startTime.split(':').map(Number);
        const [endHours, endMins] = s.endTime.split(':').map(Number);
        const startTimeMinutes = startHours * 60 + startMins;
        const endTimeMinutes = endHours * 60 + endMins;

        // Handle overnight schedules (e.g. 22:00 to 02:00)
        if (startTimeMinutes <= endTimeMinutes) {
            return currentTimeMinutes >= startTimeMinutes && currentTimeMinutes <= endTimeMinutes;
        } else {
            // Overnight window
            return currentTimeMinutes >= startTimeMinutes || currentTimeMinutes <= endTimeMinutes;
        }
    });
  }

  private async checkGeofences() {
    // Safety Check: Verify permissions and GPS status
    const hasPermissions = await PermissionsManager.hasScanningPermissions();
    const gpsEnabled = await PermissionsManager.isGpsEnabled();

    if (!hasPermissions || !gpsEnabled) {
        console.warn(`[LocationService] Missing requirements: permissions=${hasPermissions}, gps=${gpsEnabled}. Skipping check.`);
        return;
    }

    if (!this.realm || this.realm.isClosed) return;
    if (this.isChecking) return;

    this.isChecking = true;
    try {
      // Get current location
      Geolocation.getCurrentPosition(
        async (position) => {
          try {
            const { latitude, longitude, accuracy } = position.coords;

            if (!this.realm || this.realm.isClosed) return;

            console.log(`[LocationService] Check: lat=${latitude.toFixed(4)}, lon=${longitude.toFixed(4)}, acc=${accuracy.toFixed(1)}m`);

            const allEnabledPlaces = PlaceService.getEnabledPlaces(this.realm!);
            // FILTER BY SCHEDULE
            const enabledPlaces = allEnabledPlaces.filter(p => this.isWithinSchedule(p));
            
            const currentCheckIn = CheckInService.getCurrentCheckIn(this.realm!);

            // 1. Explicitly check if we are still inside the CURRENT place (fixes "stuck" status)
            if (currentCheckIn) {
               const place = PlaceService.getPlaceById(this.realm!, currentCheckIn.placeId as string);
               if (place) {
                 const dist = this.calculateDistance(latitude, longitude, place.latitude as number, place.longitude as number);
                 const threshold = (place.radius as number) * 1.1; // 10% buffer
                 
                 // Smart Exit Strategy:
                 // If clearly outside (distance > threshold + accuracy), exit even with poor accuracy.
                 // If accuracy is good (< 60m), trust the distance directly.
                 const confidenceExit = (dist > threshold + accuracy) || (accuracy < 60 && dist > threshold);

                 if (confidenceExit) {
                   console.log(`[LocationService] Explicit EXIT detected for ${place.name} (dist: ${Math.round(dist)}m, acc: ${Math.round(accuracy)}m)`);
                   await this.handleGeofenceExit(place.id as string);
                 } else if (dist > threshold) {
                    console.log(`[LocationService] Potential EXIT ignored due to low accuracy (dist: ${Math.round(dist)}m, acc: ${Math.round(accuracy)}m)`);
                 }
               } else {
                 // Place was deleted or invalid? Clean up.
                 await this.handleGeofenceExit(currentCheckIn.placeId as string);
               }
            }
            
            // 2. Scan for entries (and maintain active states)
            const activePlaces = enabledPlaces.filter(place => {
              // If we are already checked in, we trust Step 1 to have handled the Exit logic.
              // We should KEEP it in the active list so Step 5 doesn't force-kill it.
              if (CheckInService.isPlaceActive(this.realm!, place.id as string)) {
                  return true;
              }

              // For NEW entries, we require good accuracy to prevent false positives
              if (accuracy > 100) return false;

              const distance = this.calculateDistance(
                latitude,
                longitude,
                place.latitude as number,
                place.longitude as number
              );
              return distance <= (place.radius as number) * 1.1;
            });

            const activePlaceIds = new Set(activePlaces.map(p => p.id));

            // 3. Global Restore Check: If we are NO LONGER in ANY zone, but have active logs
            const currentActiveLogs = CheckInService.getActiveCheckIns(this.realm!);
            
            if (activePlaces.length === 0 && currentActiveLogs.length > 0) {
                // Only force restore if we didn't just handle a specific exit above
                // or if we are cleaning up phantom states
                // activePlaces is empty because of our filter or accuracy
            }

            // 4. Handle Specific Entries
            for (const place of activePlaces) {
              if (!CheckInService.isPlaceActive(this.realm!, place.id as string)) {
                 console.log(`[LocationService] ENTER detected for ${place.name}`);
                 await this.handleGeofenceEntry(place.id as string);
              }
            }

            // 5. Handle Specific Exits
            for (const log of currentActiveLogs) {
               if (!activePlaceIds.has(log.placeId as string)) {
                  console.log(`[LocationService] EXIT detected for placeId: ${log.placeId}`);
                  await this.handleGeofenceExit(log.placeId as string);
               }
            }
          } catch (internalError) {
            console.error('[LocationService] Crashed inside Geolocation success callback:', internalError);
          }
        },
        (error) => {
          console.error('[LocationService] Geofence check location error:', error);
          // If location is failing, we might want to check if we're "stuck" silenced and offer a timeout recovery
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 5000, // Fresher location for better transition response
        }
      );
    } catch (error) {
      console.error('[LocationService] Geofence check failed:', error);
    } finally {
      this.isChecking = false;
    }
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    // Haversine formula
    const R = 6371e3; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  private async handleGeofenceEntry(placeId: string) {
    const now = Date.now();
    const lastTime = this.lastTriggerTime[placeId] || 0;
    
    // Debounce check
    if (now - lastTime < this.DEBOUNCE_TIME) {
        console.log(`[LocationService] Debouncing ENTER for ${placeId}`);
        return;
    }
    this.lastTriggerTime[placeId] = now;

    if (!this.realm) return;

    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (place && place.isEnabled) {
        const activeLogs = CheckInService.getActiveCheckIns(this.realm);
        
        if (activeLogs.length > 0) {
            // Already in another zone. Just log this one without silencing again.
            // We want to preserve the "Original Volume" from the very first zone.
            const firstLog = activeLogs[0] as any;
            CheckInService.logCheckIn(
                this.realm, 
                placeId, 
                firstLog.savedVolumeLevel, 
                firstLog.savedMediaVolume
            );
            
            await this.showNotification(
                'Silent Zone Updated',
                `Also inside ${place.name}. Remaining silent.`,
                'check-in-multi'
            );
        } else {
            // Fresh entry into the FIRST silent zone
            await this.saveAndSilencePhone(placeId);
            
            await this.showNotification(
                'Silent Zone Active',
                `Now in ${place.name}. Phone is being silenced.`,
                'check-in'
            );
        }
    }
  }

  private async handleGeofenceExit(placeId: string, force: boolean = false) {
    const now = Date.now();
    const lastTime = this.lastTriggerTime[placeId] || 0;
    
    // Debounce check - skip if forced (e.g. manual disable)
    if (!force && now - lastTime < this.DEBOUNCE_TIME) {
        console.log(`[LocationService] Debouncing EXIT for ${placeId}`);
        return;
    }
    this.lastTriggerTime[placeId] = now;

    if (!this.realm) return;

    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!CheckInService.isPlaceActive(this.realm, placeId)) return;

    const activeLogs = CheckInService.getActiveCheckIns(this.realm);
    const thisLog = activeLogs.find(l => l.placeId === placeId);

    if (activeLogs.length === 1 && thisLog) {
        // This is the LAST active zone. Restore sound.
        await this.restoreRingerMode(thisLog.id as string);
        CheckInService.logCheckOut(this.realm, thisLog.id as string);
        
        await this.showNotification(
            'Silent Zone Deactivated',
            `Exited ${place?.name || 'Silent Zone'}. Sound restored.`,
            'check-out'
        );
    } else if (thisLog) {
        // Still in other zones. Don't restore sound yet.
        CheckInService.logCheckOut(this.realm, thisLog.id as string);
        
        await this.showNotification(
            'Silent Zone Partial Exit',
            `Exited ${place?.name || 'area'}. Still in other active zones.`,
            'check-out-partial'
        );
    }
  }

  // Save current ringer mode and silence the phone
  private async saveAndSilencePhone(placeId: string) {
    try {
      if (Platform.OS === 'android') {
        // Check DND permission first
        const hasPermission = await RingerMode.checkDndPermission();
        
        if (!hasPermission) {
          console.warn('[LocationService] No DND permission, cannot silence phone');
          await this.showNotification(
            'Permission Required',
            'Grant "Do Not Disturb" access in settings to enable automatic silencing',
            'dnd-required'
          );
          // Still log check-in
          CheckInService.logCheckIn(this.realm!, placeId);
          return;
        }

        // Get current ringer mode and media volume
        const currentMode = await RingerMode.getRingerMode();
        const currentMediaVolume = await RingerMode.getStreamVolume(RingerMode.STREAM_TYPES.MUSIC);
        console.log(`[LocationService] Current mode: ${currentMode}, Media volume: ${currentMediaVolume}`);
        
        // Save them to the check-in log
        CheckInService.logCheckIn(this.realm!, placeId, currentMode, currentMediaVolume);
        
        // Set phone to silent and media to 0
        try {
          await RingerMode.setRingerMode(RINGER_MODE.silent);
          await RingerMode.setStreamVolume(RingerMode.STREAM_TYPES.MUSIC, 0);
          console.log('[LocationService] Phone silenced and media muted successfully');
        } catch (error: any) {
          if (error.code === 'NO_PERMISSION') {
            console.warn('[LocationService] DND permission was revoked');
            await RingerMode.requestDndPermission();
          } else {
            console.error('[LocationService] Failed to silence phone:', error);
          }
        }
      }
    } catch (error) {
      console.error('[LocationService] Failed to silence phone:', error);
      // Still log check-in even if silencing fails
      CheckInService.logCheckIn(this.realm!, placeId);
    }
  }

  // Restore the saved ringer mode
  private async restoreRingerMode(checkInLogId: string) {
    try {
      if (Platform.OS === 'android') {
        const log = this.realm!.objectForPrimaryKey('CheckInLog', checkInLogId);
        if (log) {
          const savedMode = (log as any).savedVolumeLevel;
          const savedMediaVolume = (log as any).savedMediaVolume;

          if (savedMode !== null && savedMode !== undefined) {
             console.log('[LocationService] Restoring ringer mode to:', savedMode);
             await RingerMode.setRingerMode(savedMode as any);
          } else {
             await RingerMode.setRingerMode(RINGER_MODE.normal);
          }

          if (savedMediaVolume !== null && savedMediaVolume !== undefined) {
             console.log('[LocationService] Restoring media volume to:', savedMediaVolume);
             await RingerMode.setStreamVolume(RingerMode.STREAM_TYPES.MUSIC, savedMediaVolume);
          }
          
          console.log('[LocationService] Sound and media volume restored');
        }
      }
    } catch (error) {
      console.error('[LocationService] Failed to restore ringer mode:', error);
    }
  }

  private async showNotification(title: string, body: string, id: string) {
    try {
        if (Platform.OS === 'android') {
            await notifee.createChannel({
                id: 'silent-zone-alerts',
                name: 'Silent Zone Alerts',
                importance: AndroidImportance.HIGH,
            });
        }

        await notifee.displayNotification({
            title,
            body,
            android: {
                channelId: 'silent-zone-alerts',
                smallIcon: 'ic_launcher',
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

  // Cleanup method
  destroy() {
    this.stopGeofenceMonitoring();
    this.isReady = false;
  }
  private getTimeToNextSchedule(places: any[]): number {
    let minDiff = Infinity;
    const now = new Date();
    const currentDay = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()];
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

    places.forEach(place => {
        if (!place.schedules || place.schedules.length === 0) return;
        
        place.schedules.forEach((s: any) => {
            // Check if schedule applies today
            if (s.days.length > 0 && !s.days.includes(currentDay)) return;

            const [startHours, startMins] = s.startTime.split(':').map(Number);
            const startTimeMinutes = startHours * 60 + startMins;

            if (startTimeMinutes > currentTimeMinutes) {
                const diffMinutes = startTimeMinutes - currentTimeMinutes;
                const diffMs = diffMinutes * 60 * 1000;
                if (diffMs < minDiff) minDiff = diffMs;
            }
        });
    });

    return minDiff === Infinity ? 30 * 60 * 1000 : minDiff;
  }
}

export const locationService = new LocationService();
