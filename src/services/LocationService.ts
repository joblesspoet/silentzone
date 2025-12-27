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

  // Initialize service
  async initialize(realmInstance: Realm) {
    if (this.isReady) return;
    this.realm = realmInstance;

    // 1. Request Location Permissions
    await this.requestLocationPermissions();

    // 2. Request Notification Permissions
    await notifee.requestPermission();

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

    // 5. Start monitoring geofences
    this.startGeofenceMonitoring();

    this.isReady = true;
    console.log('[LocationService] Initialized and monitoring');
  }

  private async requestDndPermission() {
    // Redundant now, removed
  }

  private async requestLocationPermissions() {
    await PermissionsManager.requestLocationAlways();
  }

  private setupReactiveSync() {
    if (!this.realm) return;

    const places = this.realm.objects('Place');
    places.addListener((collection, changes) => {
        if (changes.insertions.length > 0 || changes.deletions.length > 0 || changes.newModifications.length > 0) {
            console.log('[LocationService] Places modified, resyncing geofences...');
            this.syncGeofences();
        }
    });
  }

  async syncGeofences() {
    if (!this.realm) return;

    try {
      const enabledPlaces = PlaceService.getEnabledPlaces(this.realm);
      const enabledIds = new Set(enabledPlaces.map(p => p.id));
      
      // 1. Handle "Force CheckOut" if the current place was disabled
      const currentCheckIn = CheckInService.getCurrentCheckIn(this.realm);
      if (currentCheckIn && !enabledIds.has(currentCheckIn.placeId as string)) {
          console.log(`[LocationService] Force check-out: ${currentCheckIn.placeId} is no longer enabled.`);
          const place = PlaceService.getPlaceById(this.realm, currentCheckIn.placeId as string);
          
          // CRITICAL: Restore sound before closing log
          await this.restoreRingerMode(currentCheckIn.id as string);
          
          CheckInService.logCheckOut(this.realm, currentCheckIn.id as string);
          await this.showNotification(
              'Silent Zone Disabled',
              `Tracking disabled for ${place?.name || 'current place'}. Status restored.`,
              'check-out-force'
          );
      }

      // 2. Clear and re-add geofences
      await Geofencing.removeAllGeofence();

      if (enabledPlaces.length === 0) {
          console.log('[LocationService] No enabled places. Stopping tracking.');
          this.stopGeofenceMonitoring();
          return;
      }

      // 3. Add Geofences
      for (const place of enabledPlaces) {
         await Geofencing.addGeofence({
            id: place.id as string,
            latitude: place.latitude as number,
            longitude: place.longitude as number,
            radius: Math.max(100, (place.radius as number) + 20), // Minimum 100m for reliability
         });
      }
      
      console.log(`[LocationService] Synced ${enabledPlaces.length} geofences`);

    } catch (error) {
      console.error('[LocationService] Sync failed:', error);
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

          for (const place of enabledPlaces) {
            const distance = this.calculateDistance(
              latitude,
              longitude,
              place.latitude as number,
              place.longitude as number
            );

            const placeId = place.id as string;
            // Add a small buffer (10%) to the radius to prevent flapping
            const threshold = (place.radius as number) * 1.1;
            const isInside = distance <= threshold;

            if (isInside) {
              // User is inside this geofence
              if (!currentCheckIn || currentCheckIn.placeId !== placeId) {
                console.log(`[LocationService] ENTER detected for ${place.name} (dist: ${Math.round(distance)}m)`);
                await this.handleGeofenceEntry(placeId);
              }
            } else {
              // User is outside this geofence
              if (currentCheckIn && currentCheckIn.placeId === placeId) {
                console.log(`[LocationService] EXIT detected for ${place.name} (dist: ${Math.round(distance)}m)`);
                await this.handleGeofenceExit(placeId);
              }
            }
          }
        },
        (error) => {
          console.error('[LocationService] Location error:', error);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 10000,
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
        // Check out of any other place first
        const currentCheckIn = CheckInService.getCurrentCheckIn(this.realm);
        if (currentCheckIn && currentCheckIn.placeId !== placeId) {
            console.log(`[LocationService] Moving from ${currentCheckIn.placeId} to ${placeId}`);
            // Transfer saved volumes from previous check-in log to preserve the "Original" pre-silence level
            const originalRinger = (currentCheckIn as any).savedVolumeLevel;
            const originalMedia = (currentCheckIn as any).savedMediaVolume;
            
            // Close old check-in WITHOUT restoring sound
            CheckInService.logCheckOut(this.realm, currentCheckIn.id as string);
            
            // Start new check-in with the original levels
            CheckInService.logCheckIn(this.realm, placeId, originalRinger, originalMedia);
            
            await this.showNotification(
                'Silent Zone Updated',
                `Moved to ${place.name}. Remaining silent.`,
                'check-in-transition'
            );
        } else if (!currentCheckIn) {
            // Fresh entry into a silent zone
            await this.saveAndSilencePhone(placeId);
            
            await this.showNotification(
                'Silent Zone Active',
                `Now in ${place.name}. Phone is being silenced.`,
                'check-in'
            );
        }
    }
  }

  private async handleGeofenceExit(placeId: string) {
    const now = Date.now();
    const lastTime = this.lastTriggerTime[placeId] || 0;
    
    // Debounce check
    if (now - lastTime < this.DEBOUNCE_TIME) {
        console.log(`[LocationService] Debouncing EXIT for ${placeId}`);
        return;
    }
    this.lastTriggerTime[placeId] = now;

    if (!this.realm) return;

    const place = PlaceService.getPlaceById(this.realm, placeId);
    const currentCheckIn = CheckInService.getCurrentCheckIn(this.realm);
    
    if (currentCheckIn && currentCheckIn.placeId === placeId) {
        // Restore ringer mode before checking out
        await this.restoreRingerMode(currentCheckIn.id as string);
        
        CheckInService.logCheckOut(this.realm, currentCheckIn.id as string);
        await this.showNotification(
            'Silent Zone Deactivated',
            `Exited ${place?.name || 'Silent Zone'}. Sound restored.`,
            'check-out'
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
