import Geofencing from '@rn-org/react-native-geofencing';
import notifee, { AndroidImportance } from '@notifee/react-native';
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
  private geofenceCheckInterval: ReturnType<typeof setInterval> | null = null;
  private savedRingerMode: number | null = null; // Store original ringer mode
  private lastEnabledIds: string = ''; // For change detection

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
    if (!this.realm) return;

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
    // Check geofences every 30 seconds
    if (this.geofenceCheckInterval) {
      clearInterval(this.geofenceCheckInterval);
    }

    this.geofenceCheckInterval = setInterval(() => {
      this.checkGeofences();
    }, 15000); // 15 seconds

    // Also check immediately
    this.checkGeofences();
  }

  private stopGeofenceMonitoring() {
    if (this.geofenceCheckInterval) {
      clearInterval(this.geofenceCheckInterval);
      this.geofenceCheckInterval = null;
    }
  }

  private async checkGeofences() {
    // Safety Check: Verify permissions and GPS status
    const hasPermissions = await PermissionsManager.hasScanningPermissions();
    const gpsEnabled = await PermissionsManager.isGpsEnabled();

    if (!hasPermissions || !gpsEnabled) {
        console.warn(`[LocationService] Missing requirements: permissions=${hasPermissions}, gps=${gpsEnabled}. Skipping check.`);
        return;
    }

    if (!this.realm) return;

    try {
      // Get current location
      Geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude, accuracy } = position.coords;

          // Relaxed accuracy check (100m instead of 50m) for indoor reliability
          if (accuracy > 100) {
            console.log(`[LocationService] Ignoring very low accuracy: ${accuracy}m`);
            return;
          }

          console.log(`[LocationService] Check: lat=${latitude.toFixed(4)}, lon=${longitude.toFixed(4)}, acc=${accuracy.toFixed(1)}m`);

          const enabledPlaces = PlaceService.getEnabledPlaces(this.realm!);
          const currentCheckIn = CheckInService.getCurrentCheckIn(this.realm!);

          // 1. Explicitly check if we are still inside the CURRENT place (fixes "stuck" status)
          if (currentCheckIn) {
             const place = PlaceService.getPlaceById(this.realm!, currentCheckIn.placeId as string);
             if (place) {
               const dist = this.calculateDistance(latitude, longitude, place.latitude as number, place.longitude as number);
               const threshold = (place.radius as number) * 1.1; // 10% buffer
               if (dist > threshold) {
                 console.log(`[LocationService] Explicit EXIT detected for ${place.name} (dist: ${Math.round(dist)}m)`);
                 await this.handleGeofenceExit(place.id as string);
               }
             } else {
               // Place was deleted or invalid? Clean up.
               await this.handleGeofenceExit(currentCheckIn.placeId as string);
             }
          }
          
          const activePlaces = enabledPlaces.filter(place => {
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
              console.log(`[LocationService] No longer in any silent zone. Restoring sound for ${currentActiveLogs.length} logs.`);
              for (const log of currentActiveLogs) {
                  await this.handleGeofenceExit(log.placeId as string, true); // Force restore
              }
              return;
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
}

export const locationService = new LocationService();
