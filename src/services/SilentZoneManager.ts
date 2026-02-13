import { Realm } from 'realm';
import { Platform } from 'react-native';
import RingerMode, { RINGER_MODE } from '../modules/RingerMode';
import { CheckInService } from '../database/services/CheckInService';
import { PlaceService } from '../database/services/PlaceService';
import { Logger } from './Logger';
import { notificationManager } from './NotificationManager';
import { notificationBus } from './NotificationEventBus';
import { ScheduleManager, UpcomingSchedule } from './ScheduleManager';

export interface SilentZoneState {
  placeId: string;
  placeName: string;
  isOverlapping: boolean;
  savedMode: number | null;
  savedVolume: number | null;
}

/**
 * SilentZoneManager - Handles all silent zone activation/deactivation logic
 * Extracted from LocationService to separate concerns
 */
export class SilentZoneManager {
  private realm: Realm | null = null;
  private lastSoundRestoredTime: { [key: string]: number } = {};

  setRealm(realm: Realm | null): void {
    this.realm = realm;
  }

  /**
   * Activate silent zone for a place
   * Handles both first entry and overlapping zones
   */
  async activateSilentZone(place: any): Promise<boolean> {
    if (!this.realm) {
      Logger.error('[SilentZoneManager] Cannot activate: realm not available');
      return false;
    }

    const placeId = place.id;
    const placeName = place.name;

    // Check if we're already in any silent zones
    const activeLogs = Array.from(CheckInService.getActiveCheckIns(this.realm));
    const isOverlapping = activeLogs.length > 0;

    if (isOverlapping) {
      return await this.handleOverlappingEntry(place, activeLogs);
    } else {
      return await this.handleFirstEntry(place);
    }
  }

  /**
   * Handle first entry into a silent zone
   */
  private async handleFirstEntry(place: any): Promise<boolean> {
    const placeId = place.id;
    const placeName = place.name;

    Logger.info(`[SilentZoneManager] First entry into ${placeName}`);

    try {
      if (Platform.OS === 'android') {
        await this.saveAndSilencePhone(placeId);
      } else {
        // Non-Android: just log check-in
        CheckInService.logCheckIn(this.realm!, placeId);
      }

      const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm!));
      const { upcomingSchedules } = ScheduleManager.categorizeBySchedule(enabledPlaces);
      
      await notificationManager.startForegroundService(
        enabledPlaces.length,
        upcomingSchedules,
        placeName,
        true
      );

      // ✅ Emit check-in notification
      notificationBus.emit({
        type: 'CHECK_IN',
        placeId: placeId,
        placeName: placeName,
        timestamp: Date.now(),
        source: 'geofence'
      });

      Logger.info(`[SilentZoneManager] Phone silenced for ${placeName}`);
      return true;
    } catch (error) {
      Logger.error(`[SilentZoneManager] Failed to silence phone for ${placeName}:`, error);
      return false;
    }
  }

  /**
   * Handle entry when already in another silent zone
   */
  private async handleOverlappingEntry(place: any, activeLogs: any[]): Promise<boolean> {
    const placeId = place.id;
    const placeName = place.name;

    Logger.info(`[SilentZoneManager] Entering ${placeName} (already in ${activeLogs.length} zone(s))`);

    // List which zones we're already in
    activeLogs.forEach((log: any, index: number) => {
      const existingPlace = PlaceService.getPlaceById(this.realm!, log.placeId);
      const existingName = existingPlace ? (existingPlace as any).name : 'Unknown';
      Logger.info(`  └─ Zone ${index + 1}: ${existingName}`);
    });

    try {
      if (Platform.OS === 'android') {
        const currentMode = await RingerMode.getRingerMode();
        const currentVolume = await RingerMode.getStreamVolume(RingerMode.STREAM_TYPES.MUSIC);

        // ✅ OVERLAPPING LOGIC: Inherit the ORIGINAL sound state from the 
        // oldest active zone. This ensures that when we exit this new zone,
        // we don't accidentally "restore" a silent state.
        let restoreMode = currentMode;
        let restoreVolume = currentVolume;

        if (activeLogs.length > 0) {
          const oldestLog = activeLogs[0];
          if (oldestLog.savedVolumeLevel !== null && oldestLog.savedVolumeLevel !== undefined) {
             restoreMode = oldestLog.savedVolumeLevel;
             Logger.info(`[SilentZoneManager] Overlapping: Inheriting restore mode ${restoreMode} from ${oldestLog.placeId}`);
          }
          if (oldestLog.savedMediaVolume !== null && oldestLog.savedMediaVolume !== undefined) {
             restoreVolume = oldestLog.savedMediaVolume;
          }
        }

        const log = CheckInService.logCheckIn(
          this.realm!,
          placeId,
          restoreMode,
          restoreVolume
        );

        if (!log) {
          Logger.error(`[SilentZoneManager] Failed to log overlapping check-in for ${placeName}`);
          return false;
        }
      } else {
        CheckInService.logCheckIn(this.realm!, placeId);
      }

      const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm!));
      const { upcomingSchedules } = ScheduleManager.categorizeBySchedule(enabledPlaces);

      await notificationManager.startForegroundService(
        enabledPlaces.length,
        upcomingSchedules,
        placeName,
        true
      );

      // After startForegroundService call, add:
      notificationBus.emit({
        type: 'CHECK_IN',
        placeId: placeId,
        placeName: placeName,
        timestamp: Date.now(),
        source: 'geofence'
      });

      Logger.info(`[SilentZoneManager] Overlapping check-in logged for ${placeName}`);
      return true;
    } catch (error) {
      Logger.error('[SilentZoneManager] Failed to save overlapping state:', error);
      CheckInService.logCheckIn(this.realm!, placeId);
      return false;
    }
  }

  /**
   * Handle exit from a silent zone.
   * 
   * @param placeId ID of the place exited
   * @param isScheduledEnd True if this is a natural end of a schedule (from Alarm)
   */
  async handleExit(placeId: string, isScheduledEnd: boolean = false): Promise<boolean> {
    if (!this.realm) {
      Logger.error('[SilentZoneManager] Cannot handle exit: realm not available');
      return false;
    }

    const place = PlaceService.getPlaceById(this.realm, placeId);
    const placeName = place ? (place as any).name : 'Unknown';

    // Check if this place has an active check-in
    if (!CheckInService.isPlaceActive(this.realm, placeId)) {
      Logger.info(`[SilentZoneManager] No active check-in for ${placeName}, ignoring exit`);
      return false;
    }

    // Get all active logs and find this one
    const activeLogs = Array.from(CheckInService.getActiveCheckIns(this.realm));
    const thisLog = activeLogs.find(l => l.placeId === placeId);

    if (!thisLog) {
      Logger.warn(`[SilentZoneManager] Active check-in for ${placeName} not found`);
      return false;
    }

    const totalActive = activeLogs.length;
    Logger.info(`[SilentZoneManager] Exiting ${placeName} (${totalActive} total active zones, scheduledEnd=${isScheduledEnd})`);

    if (totalActive === 1) {
      // LAST ZONE: Restore sound
      return await this.handleLastZoneExit(thisLog.id as string, placeId, placeName, isScheduledEnd);
    } else {
      // OVERLAPPING: Still in other zones, stay silent
      return await this.handlePartialExit(thisLog.id as string, placeName, activeLogs, placeId);
    }
  }

  /**
   * Handle exit from the last active zone
   */
  private async handleLastZoneExit(
    logId: string, 
    placeId: string, 
    placeName: string, 
    isScheduledEnd: boolean
  ): Promise<boolean> {
    Logger.info(`[SilentZoneManager] Last zone exit - restoring sound`);

    try {
      if (Platform.OS === 'android') {
        await this.restoreRingerMode(logId);
      }
      CheckInService.logCheckOut(this.realm!, logId);

      // Only notify if this is NOT a scheduled end (i.e., user left early)
      const now = Date.now();
      const lastRestored = this.lastSoundRestoredTime[placeId] || 0;
      
      if (!isScheduledEnd && (now - lastRestored > 60000)) {
         this.lastSoundRestoredTime[placeId] = now;
         notificationBus.emit({
            type: 'SOUND_RESTORED',
            placeId: placeId,
            placeName,
            timestamp: now,
            source: 'manual'
         });
      }

      Logger.info(`[SilentZoneManager] Sound restored after exiting ${placeName}`);
      return true;
    } catch (error) {
      Logger.error('[SilentZoneManager] Failed to restore sound:', error);
      return false;
    }
  }

  /**
   * Handle partial exit (still in other zones)
   */
  private async handlePartialExit(
    logId: string,
    placeName: string,
    activeLogs: any[],
    exitingPlaceId: string
  ): Promise<boolean> {
    Logger.info(
      `[SilentZoneManager] Still in ${activeLogs.length - 1} other zone(s), staying silent`
    );

    // Log which zones we're still in
    activeLogs.forEach((log: any) => {
      if (log.placeId !== exitingPlaceId) {
        const otherPlace = PlaceService.getPlaceById(this.realm!, log.placeId);
        const otherName = otherPlace ? (otherPlace as any).name : 'Unknown';
        Logger.info(`  └─ Still in: ${otherName}`);
      }
    });

    // Close this check-in but DON'T restore sound
    CheckInService.logCheckOut(this.realm!, logId);

    const enabledPlaces = Array.from(PlaceService.getEnabledPlaces(this.realm!));
    const { upcomingSchedules } = ScheduleManager.categorizeBySchedule(enabledPlaces);

    // Update persistent notification to show we are still in OTHER zones
    const activeLogsRemaining = Array.from(CheckInService.getActiveCheckIns(this.realm!));
    const nextPlaceName = activeLogsRemaining.length > 0 
      ? (PlaceService.getPlaceById(this.realm!, activeLogsRemaining[0].placeId as string)?.name as string || 'Another Zone')
      : null;

    await notificationManager.startForegroundService(
      enabledPlaces.length,
      upcomingSchedules,
      nextPlaceName,
      activeLogsRemaining.length > 0
    );

    Logger.info(`[SilentZoneManager] Partial exit from ${placeName}`);
    return true;
  }

  /**
   * Save current ringer mode and silence phone
   */
  private async saveAndSilencePhone(placeId: string): Promise<void> {
    try {
      const hasPermission = await RingerMode.checkDndPermission();

      if (!hasPermission) {
        Logger.warn('[SilentZoneManager] No DND permission');
        await notificationManager.showNotification(
          'Permission Required',
          'Grant "Do Not Disturb" access in settings for automatic silencing',
          'dnd-required'
        );
        CheckInService.logCheckIn(this.realm!, placeId);
        return;
      }

      const currentMode = await RingerMode.getRingerMode();
      const currentMediaVolume = await RingerMode.getStreamVolume(RingerMode.STREAM_TYPES.MUSIC);

      Logger.info(`[SilentZoneManager] Saving: mode=${currentMode}, volume=${currentMediaVolume}`);

      const log = CheckInService.logCheckIn(
        this.realm!,
        placeId,
        currentMode,
        currentMediaVolume
      );

      if (!log) {
        Logger.error(`[SilentZoneManager] Failed to persist check-in for ${placeId}`);
        return;
      }

      try {
        await RingerMode.setRingerMode(RINGER_MODE.silent);
        await RingerMode.setStreamVolume(RingerMode.STREAM_TYPES.MUSIC, 0);
        Logger.info('[SilentZoneManager] Phone silenced');
      } catch (error: any) {
        if (error.code === 'NO_PERMISSION') {
          Logger.warn('[SilentZoneManager] DND permission revoked');
          await RingerMode.requestDndPermission();
        } else {
          Logger.error('[SilentZoneManager] Failed to silence:', error);
        }
      }
    } catch (error) {
      Logger.error('[SilentZoneManager] Save and silence failed:', error);
      CheckInService.logCheckIn(this.realm!, placeId);
    }
  }

  /**
   * Restore ringer mode from check-in log
   */
  private async restoreRingerMode(checkInLogId: string): Promise<void> {
    try {
      const log = this.realm!.objectForPrimaryKey('CheckInLog', checkInLogId) as any;
      if (!log) return;

      const savedMode = log.savedVolumeLevel;
      const savedMediaVolume = log.savedMediaVolume;

      if (savedMode !== null && savedMode !== undefined) {
        Logger.info(`[SilentZoneManager] Restoring mode: ${savedMode}`);
        await RingerMode.setRingerMode(savedMode);
      } else {
        await RingerMode.setRingerMode(RINGER_MODE.normal);
      }

      if (savedMediaVolume !== null && savedMediaVolume !== undefined) {
        Logger.info(`[SilentZoneManager] Restoring volume: ${savedMediaVolume}`);
        await RingerMode.setStreamVolume(RingerMode.STREAM_TYPES.MUSIC, savedMediaVolume);
      }

      Logger.info('[SilentZoneManager] Sound restored');
    } catch (error) {
      Logger.error('[SilentZoneManager] Failed to restore:', error);
    }
  }

  /**
   * Check if a place is currently active
   */
  isPlaceActive(placeId: string): boolean {
    if (!this.realm) return false;
    return CheckInService.isPlaceActive(this.realm, placeId);
  }
}

export const silentZoneManager = new SilentZoneManager();
