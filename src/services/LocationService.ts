import BackgroundGeolocation, {
  GeofenceEvent,
} from 'react-native-background-geolocation';
import notifee, { AndroidImportance } from '@notifee/react-native';
import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import { CheckInService } from '../database/services/CheckInService';
import { Platform } from 'react-native';

class LocationService {
  private realm: Realm | null = null;
  private isReady = false;
  private lastTriggerTime: { [key: string]: number } = {};
  private readonly DEBOUNCE_TIME = 10000; // 10 seconds

  // Initialize service
  async initialize(realmInstance: Realm) {
    if (this.isReady) return;
    this.realm = realmInstance;

    // 1. Request Notification Permissions
    await notifee.requestPermission();

    // 2. Configure BackgroundGeolocation
    await BackgroundGeolocation.ready({
      // Geolocation Config
      desiredAccuracy: BackgroundGeolocation.DESIRED_ACCURACY_HIGH,
      distanceFilter: 10,
      
      // Activity Recognition
      stopTimeout: 5,
      debug: false, // Set to false for production feel
      logLevel: BackgroundGeolocation.LOG_LEVEL_VERBOSE,
      stopOnTerminate: false,
      startOnBoot: true,
      
      // Geofence Config
      geofenceProximityRadius: 1000,
      geofenceInitialTriggerEntry: true,

      // Android specific
      foregroundService: true,
      notification: {
          title: "Silent Zone Active",
          text: "Monitoring your silent places",
          priority: BackgroundGeolocation.NOTIFICATION_PRIORITY_DEFAULT
      }
    });

    // 3. Set listeners
    BackgroundGeolocation.onGeofence(this.handleGeofenceEvent.bind(this));

    // 4. Start monitoring
    await BackgroundGeolocation.startGeofences();
    
    // 5. Sync and listen for database changes
    this.syncGeofences();
    this.setupReactiveSync();

    this.isReady = true;
    console.log('[LocationService] Initialized and monitoring');
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
      
      // Clear and re-add for consistency
      await BackgroundGeolocation.removeGeofences();

      for (const place of enabledPlaces) {
         await BackgroundGeolocation.addGeofence({
            identifier: place.id as string,
            radius: (place.radius as number) + 20,
            latitude: place.latitude as number,
            longitude: place.longitude as number,
            notifyOnEntry: true,
            notifyOnExit: true,
            notifyOnDwell: false,
         });
      }
      
      console.log(`[LocationService] Synced ${enabledPlaces.length} geofences`);
    } catch (error) {
      console.error('[LocationService] Sync failed:', error);
    }
  }

  // Handle Entry/Exit
  private async handleGeofenceEvent(event: GeofenceEvent) {
    const now = Date.now();
    const placeId = event.identifier;
    const action = event.action;

    // 1. Debounce check
    const lastTime = this.lastTriggerTime[placeId] || 0;
    if (now - lastTime < this.DEBOUNCE_TIME) {
        console.log(`[LocationService] Debouncing ${action} for ${placeId}`);
        return;
    }
    this.lastTriggerTime[placeId] = now;

    if (!this.realm) return;

    // 2. Fetch current location to verify accuracy
    // Geofence events give the location, but we want to ensure < 30m
    const location = event.location;
    if (location.coords.accuracy > 30) {
        console.log(`[LocationService] Ignoring event due to low accuracy: ${location.coords.accuracy}m`);
        return;
    }

    if (action === 'ENTER') {
        const place = PlaceService.getPlaceById(this.realm, placeId);
        if (place && place.isEnabled) {
            // Check out of any other place first
            const currentCheckIn = CheckInService.getCurrentCheckIn(this.realm);
            if (currentCheckIn && currentCheckIn.placeId !== placeId) {
                CheckInService.logCheckOut(this.realm, currentCheckIn.id as string);
            }

            if (!currentCheckIn || currentCheckIn.placeId !== placeId) {
                CheckInService.logCheckIn(this.realm, placeId, 50); // Volume logic in Step 10
                await this.showNotification(
                    'Silent Zone Active',
                    `Now in ${place.name}. Phone is being silenced.`,
                    'check-in'
                );
            }
        }
    } else if (action === 'EXIT') {
        const place = PlaceService.getPlaceById(this.realm, placeId);
        const currentCheckIn = CheckInService.getCurrentCheckIn(this.realm);
        
        if (currentCheckIn && currentCheckIn.placeId === placeId) {
            CheckInService.logCheckOut(this.realm, currentCheckIn.id as string);
            await this.showNotification(
                'Silent Zone Deactivated',
                `Exited ${place?.name || 'Silent Zone'}. Status restored.`,
                'check-out'
            );
        }
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
                smallIcon: 'ic_launcher', // Ensure this exists or use default
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
}

export const locationService = new LocationService();
