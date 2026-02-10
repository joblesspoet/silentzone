import Geolocation from '@react-native-community/geolocation';
import { Platform } from 'react-native';
import { Logger } from './Logger';
import { CONFIG } from '../config/config';
import { LocationState, LocationValidator } from './LocationValidator';

export type LocationCallback = (location: LocationState) => void;
export type LocationErrorCallback = (error: any) => void;

export interface GPSConfig {
  enableHighAccuracy: boolean;
  distanceFilter: number;
  interval: number;
  fastestInterval: number;
  showLocationDialog: boolean;
  forceRequestLocation: boolean;
}

/**
 * GPSManager - Handles all GPS-related operations
 * Extracted from LocationService to separate concerns
 */
export class GPSManager {
  private watchId: number | null = null;
  private lastKnownLocation: LocationState | null = null;
  private verificationTimeout: ReturnType<typeof setTimeout> | null = null;
  private fallbackPolling: ReturnType<typeof setInterval> | null = null;
  private pollCount: number = 0;

  private onLocationUpdate: LocationCallback | null = null;
  private onError: LocationErrorCallback | null = null;

  /**
   * Start watching position with verification
   */
  async startWatching(
    onLocation: LocationCallback,
    onError: LocationErrorCallback,
    deadline?: number,
    config?: Partial<GPSConfig>
  ): Promise<void> {
    this.onLocationUpdate = onLocation;
    this.onError = onError;

    // Clear any existing watchers
    this.stopWatching();

    // ✅ Add user feedback before waiting
    Logger.info('[GPSManager] 📡 Acquiring GPS signal...');

    // Give time for foreground service to be ready
    await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));

    const defaultConfig: GPSConfig = {
        enableHighAccuracy: true,
        distanceFilter: CONFIG.DISTANCE.VERY_CLOSE / 2,
        interval: 10000,
        fastestInterval: 5000,
        showLocationDialog: true, // ✅ Enable dialog
        forceRequestLocation: true,
        ...config,
    };

    Logger.info('[GPSManager] Starting location watcher');

    // Get immediate location first
    this.getImmediateLocation(onLocation, onError);

    // Start watching
    this.watchId = Geolocation.watchPosition(
      async (position) => {
        try {
          const location: LocationState = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          };

          // Validate location quality
          const quality = LocationValidator.validateLocationQuality(location);
          if (!quality.valid) {
            Logger.warn(`[GPSManager] Poor location quality: ${quality.reason}`);
            return;
          }

          this.lastKnownLocation = location;

          // Clear verification timeout on successful update
          if (this.verificationTimeout) {
            clearTimeout(this.verificationTimeout);
            this.verificationTimeout = null;
          }

          // Stop fallback polling if active
          this.stopFallbackPolling();

          onLocation(location);
        } catch (error) {
          Logger.error('[GPSManager] Error processing location:', error);
        }
      },
      (error) => onError(error),
      defaultConfig
    );

    // Start verification process
    await this.startVerification(deadline);
  }

  /**
   * Get a single immediate location
   */
  getImmediateLocation(
    onLocation: LocationCallback,
    onError: LocationErrorCallback
  ): void {
    Geolocation.getCurrentPosition(
      async (position) => {
        try {
          const location: LocationState = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          };
          
          this.lastKnownLocation = location;
          if (this.verificationTimeout) {
            clearTimeout(this.verificationTimeout);
            this.verificationTimeout = null;
          }
          this.stopFallbackPolling();
          
          onLocation(location);
        } catch (error) {
          Logger.error('[GPSManager] Error processing immediate location:', error);
        }
      },
      (error) => onError(error),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: CONFIG.GPS_MAXIMUM_AGE }
    );
  }

  /**
   * Force a location check with retries
   */
  async forceLocationCheck(
    onLocation: LocationCallback,
    onError: LocationErrorCallback,
    attemptNumber: number = 1,
    maxAttempts: number = 5,
    deadline?: number
  ): Promise<void> {
    if (attemptNumber > 1 && deadline && Date.now() > deadline) {
      Logger.warn('[GPSManager] Force location check cancelled - Deadline passed');
      return;
    }

    Logger.info(`[GPSManager] Forcing location check (attempt ${attemptNumber}/${maxAttempts})`);

    const timeout = attemptNumber === 1 ? 30000 : 60000;

    return new Promise<void>((resolve) => {
      Geolocation.getCurrentPosition(
        async (position) => {
          try {
            const location: LocationState = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
              accuracy: position.coords.accuracy,
              timestamp: position.timestamp,
            };
            
            this.lastKnownLocation = location;
            if (this.verificationTimeout) {
              clearTimeout(this.verificationTimeout);
              this.verificationTimeout = null;
            }
            this.stopFallbackPolling();
            
            Logger.info(`[GPSManager] Forced location acquired on attempt ${attemptNumber}`);
            onLocation(location);
            resolve();
          } catch (error) {
            Logger.error('[GPSManager] Error processing forced location:', error);
            resolve();
          }
        },
        async (error) => {
          Logger.error(`[GPSManager] Attempt ${attemptNumber} failed:`, error);

          if (attemptNumber < maxAttempts) {
            if (deadline && Date.now() > deadline) {
              Logger.warn('[GPSManager] Stop retrying - Deadline passed');
              this.startFallbackPolling(onLocation, onError);
              resolve();
              return;
            }

            Logger.info(`[GPSManager] Retrying location check...`);
            await new Promise<void>(r => setTimeout(() => r(), 1000));
            await this.forceLocationCheck(onLocation, onError, attemptNumber + 1, maxAttempts, deadline);
            resolve();
          } else {
            Logger.error(`[GPSManager] All ${maxAttempts} location check attempts failed`);
            this.startFallbackPolling(onLocation, onError);
            resolve();
          }
        },
        {
          enableHighAccuracy: true,
          timeout,
          maximumAge: 30000,
        }
      );
    });
  }

  /**
   * Start GPS verification with retry logic
   */
  private async startVerification(deadline?: number, attemptNumber: number = 1, maxAttempts: number = 3): Promise<void> {
    if (deadline && Date.now() > deadline) {
      Logger.warn('[GPSManager] GPS verification skipped - Deadline passed');
      return;
    }

    const timeoutDuration = attemptNumber === 1 ? 40000 : 75000; // Loosened from 30/60

    Logger.info(`[GPSManager] GPS verification attempt ${attemptNumber}/${maxAttempts} (${timeoutDuration / 1000}s timeout)`);

    this.verificationTimeout = setTimeout(async () => {
      if (!this.lastKnownLocation) {
        Logger.warn(`[GPSManager] GPS verification attempt ${attemptNumber}/${maxAttempts} failed - No location updates`);

        if (attemptNumber < maxAttempts) {
          if (deadline && Date.now() > deadline) {
            Logger.warn('[GPSManager] Stop retrying - Deadline passed');
            return;
          }

          Logger.info(`[GPSManager] Retrying GPS verification...`);
          this.verificationTimeout = null;
          await this.startVerification(deadline, attemptNumber + 1, maxAttempts);
        } else {
          Logger.error('[GPSManager] GPS verification failed after all attempts');
          if (this.onError) {
            this.onError({ code: 2, message: 'GPS verification failed' });
          }
        }
      } else {
        const age = Date.now() - this.lastKnownLocation.timestamp;
        Logger.info(`[GPSManager] GPS verification passed - location age: ${Math.round(age / 1000)}s`);
        this.verificationTimeout = null;
      }
    }, timeoutDuration);
  }

  /**
   * Start fallback polling when GPS watcher fails
   */
  private startFallbackPolling(onLocation: LocationCallback, onError: LocationErrorCallback): void {
    if (this.fallbackPolling) {
      Logger.info('[GPSManager] Fallback polling already active');
      return;
    }

    this.pollCount = 0;
    const maxFastPolls = 6;

    Logger.info('[GPSManager] Starting fallback GPS polling (progressive: 15s → 30s)');

    const pollGPS = async () => {
      this.pollCount++;
      const currentInterval = this.pollCount <= maxFastPolls ? 15000 : 30000;

      Logger.info(`[GPSManager] Poll attempt #${this.pollCount} (${currentInterval / 1000}s interval)`);

      Geolocation.getCurrentPosition(
        async (position) => {
          Logger.info('[GPSManager] GPS recovered via polling!');
          const location: LocationState = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          };
          this.lastKnownLocation = location;
          onLocation(location);
          this.stopFallbackPolling();
        },
        (error) => {
          Logger.warn(`[GPSManager] Poll #${this.pollCount} failed:`, error.message);
        },
        {
          enableHighAccuracy: true,
          timeout: 25000,
          maximumAge: 5000,
        }
      );
    };

    pollGPS();

    this.fallbackPolling = setInterval(() => {
      if (this.pollCount >= maxFastPolls && this.fallbackPolling) {
        clearInterval(this.fallbackPolling);
        Logger.info('[GPSManager] Switching to slower polling (30s interval)');
        this.fallbackPolling = setInterval(pollGPS, 30000);
      }
      pollGPS();
    }, 15000);
  }

  /**
   * Stop fallback polling
   */
  stopFallbackPolling(): void {
    if (this.fallbackPolling) {
      clearInterval(this.fallbackPolling);
      this.fallbackPolling = null;
      this.pollCount = 0;
      Logger.info('[GPSManager] Stopped fallback polling');
    }
  }

  /**
   * Stop watching position
   */
  stopWatching(): void {
    if (this.verificationTimeout) {
      clearTimeout(this.verificationTimeout);
      this.verificationTimeout = null;
    }

    if (this.watchId !== null) {
      Geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.stopFallbackPolling();
  }

  /**
   * Get last known location
   */
  getLastKnownLocation(): LocationState | null {
    return this.lastKnownLocation;
  }

  /**
   * Check if currently watching
   */
  isWatching(): boolean {
    return this.watchId !== null;
  }
}

export const gpsManager = new GPSManager();
