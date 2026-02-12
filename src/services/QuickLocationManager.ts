import Geolocation from 'react-native-geolocation-service';
import { Logger } from './Logger';
import { gpsManager } from './GPSManager';

interface QuickLocationOptions {
  timeout?: number;           // Total timeout (default: 10000ms)
  highAccuracyTimeout?: number;  // How long to wait for GPS (default: 3000ms)
  desiredAccuracy?: number;   // Acceptable accuracy in meters (default: 100)
}

interface LocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  source: 'gps' | 'network' | 'passive' | 'lastKnown';
  timestamp: number;
}

class QuickLocationManager {
  private lastKnownLocation: LocationResult | null = null;
  
  /**
   * FAST sequential location - tries multiple sources without killing the bridge
   * Now prefers stability over speed by avoiding parallel requests
   */
  async getQuickLocation(options: QuickLocationOptions = {}): Promise<LocationResult | null> {
    const {
      timeout = 10000,
      desiredAccuracy = 100
    } = options;

    if (!Geolocation) {
        Logger.warn('[QuickLocation] Geolocation module not found');
        return null;
    }

    Logger.info(`[QuickLocation] Starting sequential quick location check`);

    try {
        // 1. Check GPSManager cache VERY first (Immediate)
        const managerLoc = gpsManager.getLastKnownLocation();
        if (managerLoc && Date.now() - managerLoc.timestamp < 30000) { // Fresh (< 30s)
            Logger.info(`[QuickLocation] Using fresh background location: ${Math.round((Date.now() - managerLoc.timestamp)/1000)}s old`);
            return {
                ...managerLoc,
                source: 'lastKnown'
            };
        }

        // 2. Try PASSIVE/CACHED from system (Fastest native call)
        const passiveLoc = await this.getSystemLastKnown();
        if (passiveLoc && Date.now() - passiveLoc.timestamp < 60000) { // < 1 min old
            Logger.info(`[QuickLocation] Found fresh system passive location: ${passiveLoc.accuracy}m`);
            if (passiveLoc.accuracy <= desiredAccuracy) return passiveLoc;
        }

        // 3. Try NETWORK (Fast & efficient)
        Logger.info('[QuickLocation] Requesting network-based location...');
        const networkLoc = await this.getLocationInner(false, 5000);
        if (networkLoc && networkLoc.accuracy <= desiredAccuracy * 1.5) {
            Logger.info(`[QuickLocation] Network location acquired: ${networkLoc.accuracy}m`);
            return networkLoc;
        }

        // 4. Try GPS (Highest power, but only if others failed or were poor)
        Logger.info('[QuickLocation] Requesting GPS location...');
        const gpsLoc = await this.getLocationInner(true, timeout / 2); // Use half the remaining time
        if (gpsLoc) {
            Logger.info(`[QuickLocation] GPS location acquired: ${gpsLoc.accuracy}m`);
            return gpsLoc;
        }

        // 5. Absolute fallback: return whatever we found last (even if old)
        return passiveLoc || networkLoc || null;

    } catch (err) {
        Logger.error('[QuickLocation] Error during sequential check:', err);
        return null;
    }
  }

  /**
   * Internal wrapper for getCurrentPosition
   */
  private getLocationInner(highAccuracy: boolean, timeout: number): Promise<LocationResult | null> {
    return new Promise((resolve) => {
      Geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: pos.timestamp,
            source: highAccuracy ? 'gps' : 'network'
          });
        },
        (err) => {
          Logger.warn(`[QuickLocation] ${highAccuracy ? 'GPS' : 'Network'} attempt failed: ${err.message}`);
          resolve(null);
        },
        {
          enableHighAccuracy: highAccuracy,
          timeout: timeout,
          maximumAge: highAccuracy ? 0 : 30000,
          forceRequestLocation: true
        }
      );
    });
  }

  /**
   * Get system's last known location
   */
  private getSystemLastKnown(): Promise<LocationResult | null> {
    return new Promise((resolve) => {
      Geolocation.getCurrentPosition(
        (pos) => resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
          source: 'passive'
        }),
        () => resolve(null),
        {
          enableHighAccuracy: false,
          timeout: 2000,
          maximumAge: 300000 // 5 minutes
        }
      );
    });
  }
}

export const quickLocation = new QuickLocationManager();

