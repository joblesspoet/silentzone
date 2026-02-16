import Geolocation from 'react-native-geolocation-service';
import { Platform, PermissionsAndroid } from 'react-native';
import { Logger } from './Logger';
import { CONFIG } from '../config/config';
import { LocationState, LocationValidator } from './LocationValidator';
import { PermissionsManager } from '../permissions/PermissionsManager';

export type LocationCallback = (location: LocationState) => void | Promise<void>;
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
  private startRequestId: number = 0;

  private onLocationUpdate: LocationCallback | null = null;
  private onError: LocationErrorCallback | null = null;
  private _watchActive: boolean = false;
  private lastUpdateTimestamp: number = 0;
  private watchdogInterval: ReturnType<typeof setInterval> | null = null;

  /**
   * Start watching position with verification
   */
  async startWatching(
    onLocation: LocationCallback,
    onError: LocationErrorCallback,
    deadline?: number,
    config?: Partial<GPSConfig>
  ): Promise<void> {
    // Increment request ID to invalidate any pending starts
    this.startRequestId++;
    const currentRequestId = this.startRequestId;

    this.onLocationUpdate = onLocation;
    this.onError = onError;

    // FIX #1: Call stopWatching() BEFORE setting _watchActive = true.
    // Previously stopWatching() was called AFTER, which immediately set
    // _watchActive back to false for the entire session — killing the
    // watchdog and all verification retries silently.
    this.stopWatching();
    this._watchActive = true;

    Logger.info(`[GPSManager] 📡 Acquiring GPS signal... (req=${currentRequestId})`);

    // Reset watchdog timestamp
    this.lastUpdateTimestamp = Date.now();
    this.startWatchdog(onLocation, onError);

    // Give time for foreground service to be ready
    await new Promise<void>(resolve => setTimeout(() => resolve(), 1000));

    // RACE CONDITION CHECK: If a new request came in during the wait, abort this one.
    if (this.startRequestId !== currentRequestId) {
        Logger.info(`[GPSManager] Aborting start request ${currentRequestId} (superseded by ${this.startRequestId})`);
        return;
    }

    const defaultConfig: GPSConfig = {
        enableHighAccuracy: true,
        distanceFilter: CONFIG.DISTANCE.VERY_CLOSE / 2,
        interval: 10000,
        fastestInterval: 5000,
        showLocationDialog: true,
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

          // Refresh watchdog heartbeat
          this.lastUpdateTimestamp = Date.now();

          onLocation(location);
        } catch (error) {
          Logger.error('[GPSManager] Error processing location:', error);
        }
      },
      (error) => {
        Logger.error('[GPSManager] Watcher error, starting fallback polling:', error);
        this.startFallbackPolling(onLocation, onError);
      },
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
    onError: LocationErrorCallback,
    useHighAccuracy: boolean = true
  ): void {
    // Proactive: Also try a quick network check in parallel if high accuracy might be slow
    if (useHighAccuracy) {
        Geolocation.getCurrentPosition(
            (pos) => {
                const loc: LocationState = {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                    timestamp: pos.timestamp,
                };
                Logger.info(`[GPSManager] Quick Network fix acquired: ±${Math.round(loc.accuracy)}m`);
                // Only provide if it passes basic quality
                if (loc.accuracy < CONFIG.MAX_ACCEPTABLE_ACCURACY) {
                    Promise.resolve(onLocation(loc)).catch(err => 
                      Logger.error('[GPSManager] Quick Network callback error:', err)
                    );
                }
            },
            () => {}, // Silent fail for network fallback
            { enableHighAccuracy: false, timeout: 5000, maximumAge: 60000 }
        );
    }

    Geolocation.getCurrentPosition(
      async (position) => {
        try {
          const location: LocationState = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            timestamp: position.timestamp,
          };

          // FIX #2: Apply the same accuracy filter to the high-accuracy path.
          // Previously this path had NO filter, so a cold/inaccurate fix (500m+)
          // would go straight into processLocationUpdate and cause false check-ins.
          if (location.accuracy >= CONFIG.MAX_ACCEPTABLE_ACCURACY) {
            Logger.warn(`[GPSManager] Immediate fix accuracy too poor (±${Math.round(location.accuracy)}m), skipping`);
            return;
          }

          this.lastKnownLocation = location;
          if (this.verificationTimeout) {
            clearTimeout(this.verificationTimeout);
            this.verificationTimeout = null;
          }
          this.stopFallbackPolling();

          Logger.info(`[GPSManager] Immediate fix acquired: ±${Math.round(location.accuracy)}m`);
          await onLocation(location);
        } catch (error) {
          Logger.error('[GPSManager] Error processing immediate location:', error);
        }
      },
      (error) => {
          Logger.warn(`[GPSManager] Immediate GPS fix failed: ${error.message}`);
          onError(error);
      },
      { enableHighAccuracy: useHighAccuracy, timeout: 20000, maximumAge: CONFIG.GPS_MAXIMUM_AGE }
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
    deadline?: number,
    useHighAccuracy: boolean = true
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
            await onLocation(location);
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
              resolve();
              return;
            }

            Logger.info(`[GPSManager] Retrying location check...`);

            // FIX #3: Renamed local variable from `useHighAccuracy` to `nextUseHighAccuracy`
            // to avoid shadowing the outer parameter. Previously the outer `useHighAccuracy`
            // was only respected on attempt #1 — all retries ignored the caller's intent
            // because the local `const useHighAccuracy` overwrote it in scope.
            const nextUseHighAccuracy = attemptNumber % 2 !== 0; // Alternate strategies

            if (!nextUseHighAccuracy) {
                Logger.info('[GPSManager] ⚠️ Switching to NETWORK/WIFI location (High Accuracy OFF)');
            }

            await new Promise<void>(r => setTimeout(() => r(), 1000));

            await this.forceLocationCheck(
                onLocation,
                onError,
                attemptNumber + 1,
                maxAttempts,
                deadline,
                nextUseHighAccuracy // FIX #3: use the renamed variable
            );
            resolve();
          } else {
            Logger.error(`[GPSManager] All ${maxAttempts} location check attempts failed`);
            // Final fallback: Try one last time with LOW accuracy
            this.getImmediateLocation(onLocation, onError, false);
            resolve();
          }
        },
        {
          enableHighAccuracy: useHighAccuracy,
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

    const timeoutDuration = attemptNumber === 1 ? 40000 : 75000;

    Logger.info(`[GPSManager] GPS verification attempt ${attemptNumber}/${maxAttempts} (${timeoutDuration / 1000}s timeout)`);

    this.verificationTimeout = setTimeout(async () => {
      if (!this._watchActive) return;

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

    // FIX #4: Run the first poll immediately, then start the interval.
    // Previously pollGPS() was called before the interval AND again inside
    // the interval's first tick during the fast→slow switch, causing poll #7
    // to fire twice back-to-back (wasting battery and a GPS request).
    pollGPS();

    this.fallbackPolling = setInterval(() => {
      // FIX #4 (cont): Check BEFORE calling pollGPS so we don't fire an extra
      // poll at the exact tick of the fast→slow transition.
      if (this.pollCount >= maxFastPolls && this.fallbackPolling) {
        clearInterval(this.fallbackPolling);
        Logger.info('[GPSManager] Switching to slower polling (30s interval)');
        this.fallbackPolling = setInterval(pollGPS, 30000);
        return; // Don't fire pollGPS here — the new interval handles it
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

    this._watchActive = false;
    this.stopFallbackPolling();
    this.stopWatchdog();
  }

  /**
   * Watchdog: Periodically monitors for "GPS silence" and kicks the stream if it stalls.
   */
  private startWatchdog(onLocation: LocationCallback, onError: LocationErrorCallback) {
    this.stopWatchdog(); // Ensure only one exists

    // Check every 2 minutes
    this.watchdogInterval = setInterval(() => {
        if (!this._watchActive) return;

        const now = Date.now();
        const diff = now - this.lastUpdateTimestamp;

        if (diff > CONFIG.GPS_WATCHDOG_THRESHOLD) {
            Logger.warn(`[GPSManager] ⚠️ WATCHDOG: No GPS update for ${Math.round(diff / 1000)}s. Kicking driver...`);

            this.forceLocationCheck(onLocation, onError, 1, 1).catch(e =>
                Logger.error('[GPSManager] Watchdog kick failed:', e)
            );

            // Update timestamp so we don't kick repeatedly too fast
            this.lastUpdateTimestamp = now;
        }
    }, 120 * 1000);
  }

  private stopWatchdog() {
    if (this.watchdogInterval) {
        clearInterval(this.watchdogInterval);
        this.watchdogInterval = null;
    }
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