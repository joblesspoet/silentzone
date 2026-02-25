import Geofencing from '@rn-org/react-native-geofencing';
import { Realm } from 'realm';
import { PlaceService } from '../database/services/PlaceService';
import {
  Preferences,
  PreferencesService,
} from '../database/services/PreferencesService';
import { CheckInService } from '../database/services/CheckInService';
import { Platform } from 'react-native';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { Logger } from './Logger';
import { ScheduleManager, UpcomingSchedule } from './ScheduleManager';
import { LocationValidator } from './LocationValidator';
import { ALARM_ACTIONS } from './AlarmService';
import { PersistentAlarmService } from './PersistentAlarmService';
import { notificationManager } from './NotificationManager';
import { CONFIG } from '../config/config';
import { GPSManager, gpsManager } from './GPSManager';
import { SilentZoneManager, silentZoneManager } from './SilentZoneManager';
import { DeviceEventEmitter } from 'react-native';
import * as SZSensorModule from '../native/SZSensorModule';
import * as DeadReckoningService from './DeadReckoningService';
import * as GridEngine from './GridEngine';
import * as MotionClassifier from './MotionClassifier';
import * as AnchorManager from './AnchorManager';
import * as PlaceFingerprinter from './PlaceFingerprinter';
import * as TrailRecorder from './TrailRecorder';

/**
 * LocationService - The "Brain" of Silent Zone.
 *
 * Implements a "Self-Perpetuating Chain" logic (Native Alarm Style).
 * Each alarm trigger performs its task and immediately schedules the NEXT one.
 */
class LocationService {
  private realm: Realm | null = null;
  private isReady = false;
  private isInitializing = false;
  private geofencesActive = false;
  private lastTriggerTime: { [key: string]: number } = {};

  // SFPE State
  private isSFPEActive = false;
  private currentAnchor: AnchorManager.AnchorPosition | null = null;
  private sfpeSubscription: any = null;
  private headingBuffer: number[] = [];
  private currentSessionId: string | null = null;
  private lastKnownMotion: MotionClassifier.MotionState = 'STATIONARY';
  private lastStepTime: number = 0;
  private stationaryCheckInterval: any = null;
  private distanceSinceLastAnchor: number = 0;

  /**
   * Starts the SFPE (Sensor Fusion Proximity Engine).
   * Used when we are INSIDE a zone to track movement without GPS.
   */
  private async startSFPE(initialAnchor: any, targetPlaceId?: string) {
    if (this.isSFPEActive) {
      Logger.info('[SFPE] Already active, updating anchor.');
      this.currentAnchor = {
        lat: initialAnchor.latitude,
        lng: initialAnchor.longitude,
        accuracy: initialAnchor.accuracy || 10,
        timestamp: Date.now(),
        source: 'GPS',
      };
      this.distanceSinceLastAnchor = 0;
      return;
    }

    Logger.info('[SFPE] 🚀 Starting Engine (Dead Reckoning Mode)...');
    this.isSFPEActive = true;
    this.distanceSinceLastAnchor = 0;

    // Stop high-power GPS watching while SFPE is active
    gpsManager.stopWatching();

    // 1. Set Initial Anchor
    this.currentAnchor = {
      lat: initialAnchor.latitude,
      lng: initialAnchor.longitude,
      accuracy: initialAnchor.accuracy || 10,
      timestamp: Date.now(),
      source: 'GPS',
    };

    // 2. Start Trail Recording
    try {
      let placeId = targetPlaceId;
      // Find which place we are in (first active) if not provided
      if (!placeId && this.realm) {
        const activeCheckIns = CheckInService.getActiveCheckIns(this.realm);
        if (activeCheckIns.length > 0) {
          placeId = activeCheckIns[0].placeId as string;
        }
      }

      if (placeId && this.realm) {
        this.currentSessionId = await TrailRecorder.startSession(
          this.realm,
          placeId,
          this.currentAnchor.lat,
          this.currentAnchor.lng,
        );
        Logger.info(`[SFPE] Started Trail Session: ${this.currentSessionId}`);
      }
    } catch (e) {
      Logger.error('[SFPE] Failed to start trail session:', e);
    }

    // 3. Subscribe to Step Events
    this.sfpeSubscription = DeviceEventEmitter.addListener(
      'onStepDetected',
      this.handleStepEvent.bind(this),
    );
    await SZSensorModule.startStepDetection();

    // 4. Start Stationary Monitoring Loop (since step detector only fires on movement)
    this.lastStepTime = Date.now();
    this.stationaryCheckInterval = setInterval(
      () => this.checkStationaryStatus(),
      10000,
    );
  }

  /**
   * Stops the SFPE.
   */
  private async stopSFPE() {
    if (!this.isSFPEActive) return;

    Logger.info('[SFPE] 🛑 Stopping Engine...');
    this.isSFPEActive = false;

    // 1. Unsubscribe
    if (this.sfpeSubscription) {
      this.sfpeSubscription.remove();
      this.sfpeSubscription = null;
    }
    await SZSensorModule.stopStepDetection();

    // 2. Stop Stationary Loop
    if (this.stationaryCheckInterval) {
      clearInterval(this.stationaryCheckInterval);
      this.stationaryCheckInterval = null;
    }

    // 3. End Trail Session
    if (this.currentSessionId && this.realm) {
      await TrailRecorder.endSession(
        this.realm,
        this.currentSessionId,
        'checkout',
      );
      this.currentSessionId = null;
    }
  }

  /**
   * Periodic check to detect if user is stationary.
   * Updates TrailRecorder if no steps detected for a while.
   */
  private async checkStationaryStatus() {
    const now = Date.now();
    const timeSinceLastStep = now - this.lastStepTime;

    if (timeSinceLastStep > 5000) {
      // 5 seconds without steps = stationary
      this.lastKnownMotion = 'STATIONARY';

      // Update TrailRecorder (it handles clustering logic internally)
      if (this.currentSessionId && this.realm && this.currentAnchor) {
        // We record a point at the SAME location to indicate time passing
        // Get current heading if possible, or use 0
        let heading = 0;
        let altitude = 0;
        let pressure = 0;

        try {
          const [h, p] = await Promise.all([
            SZSensorModule.getMagneticHeading(),
            SZSensorModule.getBarometricPressure().catch(() => ({
              pressureHPa: 0,
              altitudeM: 0,
            })),
          ]);
          heading = h.heading;
          altitude = p.altitudeM;
          pressure = p.pressureHPa;

          // Verify Floor if checked in
          const activeCheckIns = CheckInService.getActiveCheckIns(this.realm);
          if (activeCheckIns.length > 0) {
            const placeId = activeCheckIns[0].placeId as string;
            const place = PlaceService.getPlaceById(this.realm, placeId) as any;
            if (place && place.avgPressure) {
              const score = await PlaceFingerprinter.matchFingerprint({
                placeId: place.id,
                avgPressure: place.avgPressure,
                altitude: place.altitude,
                timestamp: 0,
              });
              if (score < 0.5) {
                Logger.warn(
                  `[SFPE] Stationary Floor Mismatch: ${score.toFixed(
                    2,
                  )} (Current: ${pressure}hPa vs Saved: ${
                    place.avgPressure
                  }hPa)`,
                );
              }
            }
          }
        } catch {}

        await TrailRecorder.recordPoint(this.realm, this.currentSessionId, {
          latitude: this.currentAnchor.lat,
          longitude: this.currentAnchor.lng,
          heading: heading,
          isStationary: true,
          stepCount: 0,
          timestamp: now,
          altitude: altitude,
          pressure: pressure,
        });
      }
    }
  }

  /**
   * Handles a single step event from the native module.
   * This is the "Heartbeat" of the SFPE system.
   */
  private async handleStepEvent(event: any) {
    if (!this.isSFPEActive || !this.currentAnchor || !this.realm) return;

    this.lastStepTime = Date.now();

    try {
      // 1. Gather Sensor Data
      const [headingData, accelData, pressureData] = await Promise.all([
        SZSensorModule.getMagneticHeading().catch(() => ({ heading: 0 })),
        SZSensorModule.getAcceleration().catch(() => ({ magnitude: 9.8 })),
        SZSensorModule.getBarometricPressure().catch(() => ({
          pressureHPa: 0,
          altitudeM: 0,
        })),
      ]);

      // 2. Classify Motion & Get Stride
      const motionState = MotionClassifier.classifyMotion(
        1,
        accelData.magnitude,
      ); // 1 step delta
      this.lastKnownMotion = motionState;
      const strideLength = MotionClassifier.getStrideLength(motionState);
      this.distanceSinceLastAnchor += strideLength;

      // 3. Smooth Heading
      this.headingBuffer.push(headingData.heading);
      if (this.headingBuffer.length > 5) this.headingBuffer.shift();
      const smoothedHeading = DeadReckoningService.smoothHeading(
        this.headingBuffer,
      );

      // 3.5 Check Re-Anchor
      if (AnchorManager.shouldReAnchor(this.distanceSinceLastAnchor)) {
        Logger.info('[SFPE] Re-anchoring triggered...');
        try {
          // Try Network first (fast, low power)
          const netAnchor = await AnchorManager.requestNetworkAnchor();
          this.currentAnchor = {
            ...this.currentAnchor,
            lat: netAnchor.lat,
            lng: netAnchor.lng,
            accuracy: netAnchor.accuracy,
            timestamp: Date.now(),
            source: 'NETWORK',
          };
          this.distanceSinceLastAnchor = 0;
          Logger.info('[SFPE] Re-anchored via Network');
        } catch (e) {
          // Fallback to GPS Single Fix
          try {
            const gpsLoc = await gpsManager.getSingleFix(10000, true);
            this.currentAnchor = {
              ...this.currentAnchor,
              lat: gpsLoc.latitude,
              lng: gpsLoc.longitude,
              accuracy: gpsLoc.accuracy,
              timestamp: Date.now(),
              source: 'GPS',
            };
            this.distanceSinceLastAnchor = 0;
            Logger.info('[SFPE] Re-anchored via GPS');
          } catch (err) {
            Logger.warn('[SFPE] Re-anchor failed, continuing with DR');
          }
        }
      }

      // 4. Calculate New Position (Dead Reckoning)
      const newPos = DeadReckoningService.calculateNewPosition(
        this.currentAnchor,
        1, // 1 step
        smoothedHeading,
        strideLength,
      );

      // 5. Update Anchor
      this.currentAnchor = {
        ...this.currentAnchor,
        lat: newPos.lat,
        lng: newPos.lng,
        timestamp: Date.now(),
      };

      // 6. Record Point
      if (this.currentSessionId) {
        await TrailRecorder.recordPoint(this.realm, this.currentSessionId, {
          latitude: newPos.lat,
          longitude: newPos.lng,
          heading: smoothedHeading,
          isStationary: false,
          stepCount: 1,
          timestamp: Date.now(),
          altitude: pressureData.altitudeM,
          pressure: pressureData.pressureHPa,
        });
      }

      // 7. Check for Exit / Entry via ProcessLocationUpdate
      // We feed the calculated Dead Reckoning position back into the main engine
      // This allows the engine to detect if we've walked INTO or OUT OF a zone.
      const virtualLocation = {
        latitude: newPos.lat,
        longitude: newPos.lng,
        accuracy: this.currentAnchor.accuracy,
        timestamp: Date.now(),
        speed: strideLength, // approximate speed (m/s if 1 step/sec, but good enough proxy)
        heading: smoothedHeading,
        altitude: pressureData.altitudeM,
      };

      await this.processLocationUpdate(virtualLocation);
    } catch (e) {
      Logger.error('[SFPE] Step processing error:', e);
    }
  }

  /**
   * Initialize the service with the active database instance.
   * Restores the engine state and seeds initial alarms.
   *
   * @param realmInstance The active Realm database instance
   */
  async initialize(realmInstance: Realm) {
    if (!realmInstance || realmInstance.isClosed) {
      Logger.warn(
        '[LocationService] Cannot initialize with null or closed Realm',
      );
      return;
    }

    if (this.isReady && this.realm === realmInstance) {
      console.log(
        '[LocationService] Already initialized and Realm instance matches.',
      );
      return;
    }

    if (this.isInitializing) {
      console.log(
        '[LocationService] Initialization already in progress, skipping redundant call.',
      );
      return;
    }

    this.isInitializing = true;

    try {
      console.log('[LocationService] Engine initialization started...');
      this.realm = realmInstance;

      // Ensure manager has the realm immediately
      silentZoneManager.setRealm(realmInstance);

      if (Platform.OS === 'android') {
        Logger.info('[LocationService] Setting up notification channels...');
        await notificationManager.createNotificationChannels();
      }

      const placesCount = PlaceService.getPlacesCount(realmInstance as any);
      if (placesCount === 0) {
        Logger.info(
          '[LocationService] No places found. Skipping watcher refresh during onboarding.',
        );
        this.isReady = true;
        return;
      }

      // Initial sanity check: Clear any STUCK sessions (past end time)
      await this.checkSessionExpiry();

      // Initial boot sync
      Logger.info('[LocationService] Performing initial dependency sync...');
      await this.refreshAllWatchers();

      this.isReady = true;
      Logger.info('[LocationService] Engine Initialized Successfully ✅');
    } catch (error) {
      this.isReady = false;
      console.error(
        '[LocationService] CRITICAL INITIALIZATION FAILURE:',
        error,
      );
      Logger.error('[LocationService] Init failed:', error);
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Public check: Is the engine currently in the middle of initializing?
   * Used by PermissionsContext to avoid duplicate concurrent init calls.
   */
  isCurrentlyInitializing(): boolean {
    return this.isInitializing;
  }

  /**
   * Set the realm reference without triggering a full initialization.
   * Used during first-time onboarding when there are no places to sync yet.
   */
  setRealmReference(realmInstance: Realm) {
    this.realm = realmInstance;
    try {
      silentZoneManager.setRealm(realmInstance);
    } catch (e) {
      Logger.error('[LocationService] Failed to set realm on manager:', e);
    }
    console.log('[LocationService] Realm reference set (deferred init).');
  }

  /**
   * Emergency cleanup called during JS crashes to restore phone state
   */
  async cleanupOnCrash() {
    try {
      console.log('[LocationService] EMERGENCY CLEANUP INITIATED');

      if (this.realm && !this.realm.isClosed) {
        silentZoneManager.setRealm(this.realm);
        CheckInService.closeAllCheckIns(this.realm);
      }

      const { notificationManager: nm } = require('./NotificationManager');
      await nm.stopForegroundService();
    } catch (e) {
      console.error('[LocationService] Emergency cleanup failed', e);
    }
  }

  /**
   * Non-destructive initialization for background events.
   * Validates Realm is open and not closed before proceeding.
   */
  async initializeLight(realmInstance: Realm) {
    if (this.isInitializing) {
      const MAX_WAIT_MS = 5000;
      const start = Date.now();
      while (this.isInitializing) {
        if (Date.now() - start > MAX_WAIT_MS) {
          Logger.warn(
            '[LocationService] initializeLight timed out waiting for init — forcing clear',
          );
          this.isInitializing = false;
          break;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 100));
      }
    }

    if (this.realm && !this.realm.isClosed) {
      this.isReady = true;
      return;
    }

    if (!realmInstance || realmInstance.isClosed) {
      Logger.error(
        '[LocationService] Cannot initialize light with closed Realm',
      );
      return;
    }

    this.realm = realmInstance;
    try {
      silentZoneManager.setRealm(realmInstance);
    } catch (e) {
      Logger.warn('[LocationService] Manager setup failed:', e);
    }
    this.isReady = true;
  }

  /**
   * EVENT HANDLER: Place Added
   */
  async onPlaceAdded(place: any) {
    if (!this.realm || this.realm.isClosed) return;
    if (place.isValid && !place.isValid()) return;
    Logger.info(`[Event] Place Added: ${place.name}`);
    await this.seedNextAlarmForPlace(place);
    await this.refreshMonitoringState();
  }

  /**
   * EVENT HANDLER: Place Updated
   */
  async onPlaceUpdated(place: any) {
    if (!this.realm || this.realm.isClosed) return;
    if (place.isValid && !place.isValid()) return;
    Logger.info(`[Event] Place Updated: ${place.name}`);

    // 1. Always cancel existing alarms first (in case schedules were removed)
    await PersistentAlarmService.cancelAlarm(`place-${place.id}-start`);
    await PersistentAlarmService.cancelAlarm(`place-${place.id}-end`);

    // 2. Seed new alarms if applicable
    await this.seedNextAlarmForPlace(place);

    await this.refreshMonitoringState();
  }

  /**
   * EVENT HANDLER: Place Deleted
   */
  async onPlaceDeleted(placeId: string) {
    if (!this.realm || this.realm.isClosed) return;
    Logger.info(`[Event] Place Deleted: ${placeId}`);
    await PersistentAlarmService.cancelAlarm(`place-${placeId}-start`);
    await PersistentAlarmService.cancelAlarm(`place-${placeId}-end`);
    await this.refreshMonitoringState();
  }

  /**
   * EVENT HANDLER: Place Toggled
   */
  async onPlaceToggled(placeId: string, isEnabled: boolean) {
    if (!this.realm || this.realm.isClosed) return;
    Logger.info(`[Event] Place Toggled: ${placeId} -> ${isEnabled}`);

    if (isEnabled) {
      const place = PlaceService.getPlaceById(this.realm, placeId);
      if (place) await this.seedNextAlarmForPlace(place);
    } else {
      await PersistentAlarmService.cancelAlarm(`place-${placeId}-start`);
      await PersistentAlarmService.cancelAlarm(`place-${placeId}-end`);
      // If we were inside, handle exit
      if (CheckInService.isPlaceActive(this.realm, placeId)) {
        await silentZoneManager.handleExit(placeId);
      }
    }
    await this.refreshMonitoringState();
  }

  /**
   * EVENT HANDLER: Global Tracking Toggled
   */
  async onGlobalTrackingChanged(enabled: boolean) {
    if (!this.realm || this.realm.isClosed) return;
    Logger.info(`[Event] Global Tracking Changed -> ${enabled}`);

    if (!enabled) {
      await this.purgeAllAlarms();
      await this.stopMonitoring();
    } else {
      await this.refreshAllWatchers();
    }
  }

  /**
   * Refreshes all alarms and monitoring state from scratch.
   * Used ONLY during initial boot or global resume.
   */
  async refreshAllWatchers() {
    if (!this.realm || this.realm.isClosed) return;

    try {
      const prefs = PreferencesService.getPreferences(this.realm);
      const trackingEnabled = prefs?.trackingEnabled ?? true;

      // Handle Global Disable
      if (!trackingEnabled) {
        Logger.info('[LocationService] Tracking disabled. Cleaning up.');
        await this.purgeAllAlarms();
        await this.stopMonitoring();
        return;
      }

      const enabledPlaces = Array.from(
        PlaceService.getEnabledPlaces(this.realm),
      );
      Logger.info(
        `[LocationService] Refreshing ${enabledPlaces.length} enabled places...`,
      );

      for (const place of enabledPlaces) {
        await this.seedNextAlarmForPlace(place);
      }

      await this.refreshMonitoringState();
    } catch (error) {
      Logger.error('[LocationService] Refresh failed:', error);
    }
  }

  /**
   * For a specific place, find the very next START and END alarms and set them.
   * This is the "Daisy Chain" engine.
   */
  private async seedNextAlarmForPlace(placeData: any) {
    if (!this.realm || this.realm.isClosed) return;
    if (placeData.isValid && !placeData.isValid()) return;

    // RE-FETCH: Always use a fresh reference in the current thread/context
    const place = PlaceService.getPlaceById(this.realm, placeData.id) as any;
    if (!place) return;

    const schedules = place.schedules || [];
    if (schedules.length === 0) return;

    // Get all upcoming schedule windows (Yesterday, Today, Tomorrow)
    const { upcomingSchedules } = ScheduleManager.categorizeBySchedule([place]);

    const startId = `place-${place.id}-start`;
    const endId = `place-${place.id}-end`;

    // 1. Find the first START trigger window
    const firstUpcoming = upcomingSchedules[0];
    if (firstUpcoming) {
      const startTime = firstUpcoming.startTime.getTime();
      const warmUpTime =
        startTime - CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000;
      const lastChanceTime = startTime - 60000; // T-1 minute

      let finalTrigger: number | null = null;

      if (warmUpTime > Date.now() + 60000) {
        finalTrigger = warmUpTime;
      } else if (lastChanceTime > Date.now() + 10000) {
        finalTrigger = lastChanceTime;
      } else if (startTime > Date.now() + 2000) {
        // NEW: Precision trigger for exactly the start time
        // This acts as a final high-priority wake-up if we arrived after warm-ups.
        finalTrigger = startTime;
      }

      if (finalTrigger) {
        await PersistentAlarmService.scheduleAlarm(
          startId,
          finalTrigger,
          'Silent Zone Engine',
          'Optimizing background sync...',
          { placeId: place.id, action: ALARM_ACTIONS.START_SILENCE },
        );
      }
    }

    // 2. Find the first END trigger that is still in the FUTURE (relaxed to 10s)
    const nextTriggerableEnd = upcomingSchedules.find(s => {
      const timeToRoll = s.endTime.getTime() - Date.now();
      return timeToRoll > 10000; // 10 seconds minimum
    });

    if (nextTriggerableEnd) {
      const triggerEnd = nextTriggerableEnd.endTime.getTime();
      await PersistentAlarmService.scheduleAlarm(
        endId,
        triggerEnd,
        'Silent Zone Engine',
        'Finalizing session...',
        { placeId: place.id, action: ALARM_ACTIONS.STOP_SILENCE },
      );
    }
  }

  /**
   * Core logic for when an OS alarm fires.
   * Performs Phase 1 (Immediate Reschedule) and Phase 2 (Execution).
   *
   * CRITICAL FIX: For START_SILENCE alarms, we DON'T return immediately.
   * Instead, we keep the function alive to prevent React Native from killing
   * the headless task and terminating GPS. The foreground service needs the
   * process to stay alive to continue monitoring.
   */
  async handleAlarmFired(data: any) {
    const alarmId = data?.notification?.id;
    let action =
      data?.notification?.data?.action ||
      data?.notification?.data?.data?.action;
    let placeId =
      data?.notification?.data?.placeId ||
      data?.notification?.data?.data?.placeId;

    // Fallback: Parse from ID if data missing (place-UUID-start/end)
    if (!action || !placeId) {
      if (alarmId?.startsWith('place-')) {
        const parts = alarmId.split('-');
        // Format is place-UUID-start or place-UUID-end
        // UUID might have dashes, so we take the last part as action and middle as ID
        action =
          parts[parts.length - 1] === 'start'
            ? ALARM_ACTIONS.START_SILENCE
            : ALARM_ACTIONS.STOP_SILENCE;
        placeId = alarmId.replace('place-', '').replace(/-(start|end)$/, '');
        Logger.info(
          `[Engine] 🧩 Reconstructed action=${action}, placeId=${placeId} from ID=${alarmId}`,
        );
      }
    }

    if (!this.realm || this.realm.isClosed) {
      Logger.error(
        `[Engine] ❌ Cannot handle alarm: Realm is null or closed (Action: ${action})`,
      );
      return;
    }

    Logger.info(`[Engine] ⚡ Fire: ${action} for ${placeId}`);

    // FETCH FRESH: Always fetch a fresh object in the current execution context
    // This prevents "thread-isolation" crashes from stale/thawed objects.
    const place = PlaceService.getPlaceById(this.realm, placeId) as any;

    if (!place) {
      Logger.warn(
        `[Engine] ⚠️ Place ${placeId} not found in DB during alarm fire.`,
      );
      return;
    }

    if (!place.isEnabled) {
      Logger.info(`[Engine] ⏭️ Skipping disabled place: ${place.name}`);
      return;
    }

    try {
      // PHASE 2: Execute Action
      if (action === ALARM_ACTIONS.START_SILENCE) {
        await this.handleStartAction(place);
      } else if (action === ALARM_ACTIONS.STOP_SILENCE) {
        await this.handleStopAction(placeId);
      }

      // PHASE 1: Immediate Reschedule (DAISY CHAIN)
      // Moved to AFTER execution so the engine state (geofencesActive) is correctly set
      // before we decide if we need an immediate backup alarm.
      await this.seedNextAlarmForPlace(place);
    } catch (error) {
      Logger.error(`[Engine] Action failed for ${placeId}:`, error);
    }
  }

  /**
   * Handles the 'START_SILENCE' action: Activates GPS and verifies location.
   */
  private async handleStartAction(placeData: any) {
    if (!this.realm || this.realm.isClosed) return;

    // RE-FETCH: Ensure we have a "live" object for this specific method call
    const place = PlaceService.getPlaceById(this.realm, placeData.id) as any;
    if (!place) {
      Logger.error('[Engine] Failed to re-fetch place in handleStartAction');
      return;
    }

    Logger.info(`[Engine] 📍 Starting monitoring for ${place.name}`);

    // 1. Activate Foreground Service & GPS
    this.geofencesActive = true; // Set explicitly before starting monitoring
    await this.startMonitoring();

    // 2. Immediate check: Are we already there?
    const deadline = this.calculateDeadlineForPlace(place.id);

    // FIX: Wrap processLocationUpdate in .catch() so any throw inside it
    // (Realm conflict, null ref, etc.) is caught and logged instead of
    // silently swallowing the entire check-in on alarm fire.
    // This is the most critical GPS callback — it must never fail silently.
    await gpsManager.forceLocationCheck(
      async loc => {
        try {
          await this.processLocationUpdate(loc);
        } catch (err) {
          Logger.error(
            '[GPS] handleStartAction processLocationUpdate failed:',
            err,
          );
        }
      },
      err => Logger.error('[GPS] Start check failed:', err),
      1,
      2,
      deadline,
    );
  }

  /**
   * Handles the 'STOP_SILENCE' action: Restores sound and refreshes monitoring.
   */
  private async handleStopAction(placeId: string) {
    Logger.info(`[Engine] 🧹 Cleaning up for ${placeId}`);

    // 1. Restore sound if checked in
    await silentZoneManager.handleExit(placeId, true);

    // 2. Refresh monitoring state (Stop GPS if no other active zones)
    await this.refreshMonitoringState();
  }

  /**
   * Decides whether to keep the background service and GPS active
   * based on current active sessions and upcoming schedules.
   */
  private async refreshMonitoringState() {
    if (!this.realm) return;

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    const { activePlaces, upcomingSchedules } =
      ScheduleManager.categorizeBySchedule(enabledPlaces);

    Logger.info(
      `[LocationService] Refresh: active=${activePlaces.length}, upcoming=${upcomingSchedules.length}`,
    );
    if (activePlaces.length > 0) {
      Logger.info(
        `[LocationService] Active zones: ${activePlaces
          .map(p => p.name)
          .join(', ')}`,
      );
    }

    const needsMonitoring =
      activePlaces.length > 0 ||
      (upcomingSchedules.length > 0 &&
        upcomingSchedules[0].minutesUntilStart <=
          CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES);

    if (needsMonitoring) {
      Logger.info(
        '[LocationService] Monitoring needs active. Starting service...',
      );
      await this.startMonitoring();

      // PROACTIVE: If we have active zones, force an immediate check to catch entries
      if (activePlaces.length > 0) {
        Logger.info(
          '[LocationService] Proactive check initiated for active zones',
        );
        this.forceLocationCheck().catch(err => {
          Logger.error('[LocationService] Proactive check failed:', err);
        });
      }
    } else {
      Logger.info(
        '[LocationService] No active or imminent zones. Stopping service.',
      );
      await this.stopMonitoring();
    }
  }

  /**
   * Activates the foreground service, GPS watcher, and native geofences.
   */
  private async startMonitoring() {
    const hasPerms = await PermissionsManager.hasCriticalPermissions();
    if (!hasPerms) {
      Logger.error('[Service] Cannot start: Missing permissions');
      return;
    }

    // SURGICAL SYNC: If already active, we don't restart GPS, but we still force sync geofences/notifications.
    const isAlreadyWatching = this.geofencesActive && gpsManager.isWatching();

    if (isAlreadyWatching) {
      Logger.info(
        '[Service] Surgical Sync: Refreshing geofences without restarting GPS',
      );
    } else {
      Logger.info('[Service] Full Start: Activating GPS and Monitoring');
    }

    this.geofencesActive = true;
    try {
      if (!isAlreadyWatching) {
        await gpsManager.startWatching(
          async loc => {
            // Wrap in .catch() so any throw inside processLocationUpdate
            // never becomes a fatal unhandled promise rejection.
            try {
              await this.processLocationUpdate(loc);
            } catch (err) {
              Logger.error('[GPS] processLocationUpdate unhandled error:', err);
            }
          },
          err => Logger.error('[GPS] Watcher error:', err),
        );
      }

      // Sync native geofences as a secondary layer
      await this.syncNativeGeofences();
      await this.updateForegroundService();
    } catch (e) {
      Logger.error('[LocationService] Failed to start or sync monitoring:', e);
      if (!isAlreadyWatching) {
        this.geofencesActive = false;
      }
    }
  }

  /**
   * Deactivates all background monitoring components.
   */
  private async stopMonitoring() {
    this.geofencesActive = false;
    gpsManager.stopWatching();
    await Geofencing.removeAllGeofence();
    await notificationManager.stopForegroundService();
  }

  /**
   * Synchronizes the native Android geofences with our database's enabled places.
   */
  private async syncNativeGeofences() {
    if (!this.realm) return;
    await Geofencing.removeAllGeofence();

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm));
    for (const place of enabledPlaces) {
      await Geofencing.addGeofence({
        id: (place as any).id,
        latitude: (place as any).latitude,
        longitude: (place as any).longitude,
        radius: (place as any).radius + CONFIG.GEOFENCE_RADIUS_BUFFER,
      });
    }
  }

  /**
   * Processes a GPS location update. Handles zone entries and exits.
   */
  private async processLocationUpdate(location: any) {
    if (!this.realm) return;

    // 1. Determine which zones we are INSIDE
    const insideIds = LocationValidator.determineInsidePlaces(
      location,
      this.realm,
    );

    // Time-Based Expiry Check: ensure we aren't stuck in a session that should have ended.
    await this.checkSessionExpiry();

    // 2. Handle Entries
    for (const id of insideIds) {
      if (!CheckInService.isPlaceActive(this.realm, id)) {
        await this.handleGeofenceEntry(id, location);
      }
    }

    // 3. Handle Exits for active zones
    const activeLogs = CheckInService.getActiveCheckIns(this.realm).snapshot();
    for (const log of activeLogs) {
      if (log.isValid && !log.isValid()) continue;
      const placeId = log.placeId as string;
      if (!insideIds.includes(placeId)) {
        // Double check distance with hysteresis
        const place = PlaceService.getPlaceById(this.realm, placeId) as any;
        if (place && place.isValid && !place.isValid()) continue;
        if (place) {
          const isDefinitelyOutside = LocationValidator.isOutsidePlace(
            location,
            place,
            CONFIG.EXIT_HYSTERESIS_METERS || 20,
          );

          if (isDefinitelyOutside) {
            await silentZoneManager.handleExit(placeId);
          }
        }
      }
    }

    // 4. Handle Approaching (Start SFPE if near target)
    // Only if not already active and not inside any place
    if (
      insideIds.length === 0 &&
      !this.isSFPEActive &&
      this.realm &&
      !this.isCurrentlyInitializing()
    ) {
      try {
        const enabledPlaces = Array.from(
          PlaceService.getEnabledPlaces(this.realm),
        );
        const { activePlaces, upcomingSchedules } =
          ScheduleManager.categorizeBySchedule(enabledPlaces);

        // Candidates: Active places OR Upcoming (approaching)
        // We only care about upcoming schedules that are imminent (< 30 mins)
        // or active places we might be walking towards
        const upcomingPlaces = upcomingSchedules
          .filter(s => s.minutesUntilStart <= 30)
          .map(s => PlaceService.getPlaceById(this.realm!, s.placeId));

        const candidates = [...activePlaces, ...upcomingPlaces].filter(
          p => p !== null && p !== undefined,
        );

        for (const place of candidates) {
          const p = place as any;
          const dist = LocationValidator.calculateDistance(
            location.latitude,
            location.longitude,
            p.latitude,
            p.longitude,
          );

          // If within 1km (walking distance)
          if (dist < 1000) {
            Logger.info(
              `[SFPE] Approaching ${p.name} (${Math.round(
                dist,
              )}m). Starting Engine.`,
            );
            // Pass the place ID so we can start recording the session immediately
            await this.startSFPE(location, p.id);
            break; // Start for the first valid candidate
          }
        }
      } catch (e) {
        Logger.error('[SFPE] Error checking approaching places:', e);
      }
    }
  }

  /**
   * Handles a geofence entry event (either from GPS manager or native geofence).
   * Verifies if the entry is within a valid schedule window before activating silence.
   */
  async handleGeofenceEntry(placeId: string, location?: any) {
    if (!this.realm) return;
    const place = PlaceService.getPlaceById(this.realm, placeId);
    if (!place || !place.isEnabled) return;

    // Check if we are within the schedule window for this place
    const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
    const now = Date.now();

    // FIX: Removed the 15-minute PRE_ACTIVATION buffer from silence activation.
    // Monitoring starts 15m early (warm-up), but silence only triggers at the exact start time.
    // We add a tiny 5s grace for clock drift.
    const startBuffer = 5000;
    const isInsideWindow =
      schedule &&
      now >= schedule.startTime.getTime() - startBuffer &&
      now < schedule.endTime.getTime();

    Logger.info(
      `[LocationService] Verifying entry for ${place.name}: ` +
        `schedule=${
          schedule ? schedule.startTime.toLocaleTimeString() : 'None'
        }, ` +
        `isInsideWindow=${isInsideWindow}`,
    );

    if (isInsideWindow && schedule) {
      Logger.info(
        `[LocationService] Window matched for ${place.name}. Activating silence.`,
      );

      // Check Floor Fingerprint (Barometer)
      const placeAny = place as any;
      const sensorData: any = {};

      if (placeAny.avgPressure) {
        try {
          // Capture current pressure for logging
          const current = await SZSensorModule.getBarometricPressure().catch(
            () => null,
          );

          if (current) {
            sensorData.detectedPressure = current.pressureHPa;
            sensorData.detectedAltitude = current.altitudeM;

            const score = await PlaceFingerprinter.matchFingerprint({
              placeId: placeAny.id,
              avgPressure: placeAny.avgPressure,
              altitude: placeAny.altitude,
              timestamp: 0, // Not used for matching
            });
            sensorData.floorMatchScore = score;

            Logger.info(
              `[SFPE] Floor Match Score: ${score.toFixed(2)} (Pressure: ${
                placeAny.avgPressure
              }hPa)`,
            );
            if (score < 0.5) {
              Logger.warn(
                '[SFPE] Floor mismatch detected! User might be on different floor.',
              );
            }
          }
        } catch (err) {
          Logger.warn('[SFPE] Failed to check floor fingerprint:', err);
        }
      }

      await silentZoneManager.activateSilentZone(place, sensorData);
      await this.updateForegroundService();

      // START SFPE (Dead Reckoning)
      // If we don't have location (e.g. from native trigger), try to get one quickly
      let startLocation = location;
      if (!startLocation) {
        try {
          startLocation = await gpsManager.getSingleFix(5000, true);
        } catch (e) {
          Logger.warn(
            '[SFPE] Could not get fix for start. Using place center.',
          );
          startLocation = {
            latitude: (place as any).latitude,
            longitude: (place as any).longitude,
            accuracy: (place as any).radius, // High uncertainty
          };
        }
      }

      if (startLocation) {
        await this.startSFPE(startLocation);
      }
    } else {
      if (schedule) {
        Logger.info(
          `[LocationService] Window NOT matched for ${
            place.name
          }: now=${new Date(now).toLocaleTimeString()}, ` +
            `start=${schedule.startTime.toLocaleTimeString()}, end=${schedule.endTime.toLocaleTimeString()}`,
        );
      } else {
        Logger.info(
          `[LocationService] No upcoming schedule found for ${place.name}`,
        );
      }
    }
  }

  /**
   * Handles a geofence exit event: Restores sound and updates status.
   */
  async handleGeofenceExit(placeId: string) {
    await silentZoneManager.handleExit(placeId);

    // STOP SFPE
    await this.stopSFPE();

    await this.refreshMonitoringState();
    await this.updateForegroundService();
  }

  /**
   * Updates the foreground service notification text and icon.
   */
  private async updateForegroundService() {
    if (!this.realm || this.realm.isClosed) return;
    const enabledCount = PlaceService.getEnabledPlaces(this.realm).length;
    const activeCheckIns = Array.from(
      CheckInService.getActiveCheckIns(this.realm),
    );
    const activeName =
      activeCheckIns.length > 0
        ? (
            PlaceService.getPlaceById(
              this.realm,
              activeCheckIns[0].placeId as string,
            ) as any
          )?.name
        : null;

    await notificationManager.startForegroundService(
      enabledCount,
      [],
      activeName,
      activeCheckIns.length > 0,
    );
  }

  /**
   * Public API: Purges all scheduled alarms for all places.
   */
  async purgeAllAlarms() {
    if (!this.realm || this.realm.isClosed) return;
    const all = Array.from(PlaceService.getAllPlaces(this.realm));
    for (const p of all) {
      const id = (p as any).id;
      await PersistentAlarmService.cancelAlarm(`place-${id}-start`);
      await PersistentAlarmService.cancelAlarm(`place-${id}-end`);
    }
  }

  /**
   * Public API: Force a location check immediately.
   */
  async forceLocationCheck(): Promise<void> {
    return gpsManager.forceLocationCheck(
      async location => {
        try {
          await this.processLocationUpdate(location);
        } catch (err) {
          Logger.error(
            '[GPS] forceLocationCheck processLocationUpdate failed:',
            err,
          );
        }
      },
      error => Logger.error('[GPS] Force check failed:', error),
      1,
      3,
    );
  }

  /**
   * Helper to find the end time of the current or next schedule for a place.
   */
  private calculateDeadlineForPlace(placeId: string): number | undefined {
    if (!this.realm) return undefined;
    const place = PlaceService.getPlaceById(this.realm, placeId);
    const schedule = ScheduleManager.getCurrentOrNextSchedule(place);
    return schedule?.endTime.getTime();
  }

  /**
   * Safety Net: Checks if any active sessions have exceeded their schedule end time.
   */
  private async checkSessionExpiry() {
    if (!this.realm) return;

    const activeCheckIns = CheckInService.getActiveCheckIns(
      this.realm,
    ).snapshot();
    const now = Date.now();
    const EXPIRY_BUFFER_MS = 2 * 60 * 1000; // 2 minutes grace period

    for (const log of activeCheckIns) {
      const placeId = log.placeId as string;
      const place = PlaceService.getPlaceById(this.realm, placeId) as any;

      if (!place) continue;

      const isCurrentlyValid = ScheduleManager.isCurrentScheduleActive(place);

      if (!isCurrentlyValid) {
        Logger.warn(
          `[LocationService] ⏳ Session Expiry: active session for ${place.name} is past schedule. Forcing exit.`,
        );
        await silentZoneManager.handleExit(placeId, true);
        await this.updateForegroundService();
      }
    }
  }
}

export const locationService = new LocationService();
