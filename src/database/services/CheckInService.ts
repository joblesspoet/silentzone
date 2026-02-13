// database/services/CheckInService.ts

import Realm from 'realm';
import { generateUUID } from '../../utils/uuid';
import { RealmWriteHelper } from '../helpers/RealmWriteHelper';

export const CheckInService = {
  /**
   * Log check-in - THREAD SAFE
   * Allows overlapping zones to both be "Active"
   */
  logCheckIn: (
    realm: Realm,
    placeId: string,
    volumeLevel?: number,
    mediaVolume?: number
  ) => {
    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        // FIX: Idempotency Check - Prevent Duplicate "Active" Logs
        const existingActive = realm
          .objects('CheckInLog')
          .filtered('placeId == $0 AND checkOutTime == null', placeId);
        
        if (existingActive.length > 0) {
          console.log(`[CheckInService] 🛑 Idempotent check: Place ${placeId} is already active. Ignoring.`);
          return existingActive[0];
        }

        const log = realm.create('CheckInLog', {
          id: generateUUID(),
          placeId,
          checkInTime: new Date(),
          savedVolumeLevel: volumeLevel,
          savedMediaVolume: mediaVolume,
          wasAutomatic: true,
        });

        // Update place stats
        const place = realm.objectForPrimaryKey('Place', placeId) as any;
        if (place) {
          place.lastCheckInAt = new Date();
          place.totalCheckIns += 1;
          place.isInside = true; // Mark as active
        }

        console.log(`[CheckInService] ✅ PERSISTED check-in: ${placeId} (ID: ${log.id})`);
        return log;
      },
      `logCheckIn:${placeId}`
    );
  },

  /**
   * Log check-out - THREAD SAFE
   */
  logCheckOut: (realm: Realm, logId: string): boolean => {
    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        const log = realm.objectForPrimaryKey('CheckInLog', logId) as any;
        if (!log) {
          console.warn(`[CheckInService] Log not found: ${logId}`);
          return false;
        }

        const now = new Date();
        const checkInTime = log.checkInTime as Date;
        const durationMs = now.getTime() - checkInTime.getTime();

        log.checkOutTime = now;
        log.durationMinutes = Math.round(durationMs / 60000);

        // Reset isInside
        const place = realm.objectForPrimaryKey('Place', log.placeId) as any;
        if (place) {
          place.isInside = false;
        }

        console.log(
          `[CheckInService] ✅ PERSISTED check-out: ${log.placeId} (ID: ${logId})`
        );
        return true;
      },
      `logCheckOut:${logId}`
    ) ?? false;
  },

  /**
   * Get current check-in - READ ONLY
   */
  getCurrentCheckIn: (realm: Realm) => {
    return realm.objects('CheckInLog').filtered('checkOutTime == null')[0];
  },

  /**
   * Check if place is active - READ ONLY
   */
  isPlaceActive: (realm: Realm, placeId: string): boolean => {
    return (
      realm
        .objects('CheckInLog')
        .filtered('placeId == $0 AND checkOutTime == null', placeId).length > 0
    );
  },

  /**
   * Get all active check-ins - READ ONLY
   */
  getActiveCheckIns: (realm: Realm) => {
    return realm.objects('CheckInLog').filtered('checkOutTime == null');
  },

  /**
   * Get recent check-ins - READ ONLY
   */
  getRecentCheckIns: (realm: Realm, limit: number = 10) => {
    return realm
      .objects('CheckInLog')
      .sorted('checkInTime', true)
      .slice(0, limit);
  },

  /**
   * Get check-ins for a specific place - READ ONLY
   */
  getCheckInsForPlace: (realm: Realm, placeId: string) => {
    return realm
      .objects('CheckInLog')
      .filtered('placeId == $0', placeId)
      .sorted('checkInTime', true);
  },

  /**
   * Close all active check-ins - THREAD SAFE
   * Used for emergency cleanup
   */
  closeAllCheckIns: (realm: Realm): boolean => {
    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        const activeCheckIns = realm
          .objects('CheckInLog')
          .filtered('checkOutTime == null');

        if (activeCheckIns.length === 0) {
          console.log('[CheckInService] No active check-ins to close');
          return false;
        }

        const now = new Date();
        let count = 0;

        activeCheckIns.forEach((log: any) => {
          log.checkOutTime = now;
          const checkInTime = log.checkInTime as Date;
          const durationMs = now.getTime() - checkInTime.getTime();
          log.durationMinutes = Math.round(durationMs / 60000);

          // Reset isInside
          const place = realm.objectForPrimaryKey('Place', log.placeId) as any;
          if (place) {
            place.isInside = false;
          }
          count++;
        });

        console.log(`[CheckInService] Closed ${count} active check-ins`);
        return true;
      },
      'closeAllCheckIns'
    ) ?? false;
  },

  /**
   * Batch close specific check-ins by place IDs
   * More efficient than calling logCheckOut multiple times
   */
  batchCloseCheckIns: (realm: Realm, placeIds: string[]): boolean => {
    if (placeIds.length === 0) return false;

    return RealmWriteHelper.safeWrite(
      realm,
      () => {
        const now = new Date();
        let closedCount = 0;

        for (const placeId of placeIds) {
          const activeLogs = realm
            .objects('CheckInLog')
            .filtered('placeId == $0 AND checkOutTime == null', placeId);

          activeLogs.forEach((log: any) => {
            const checkInTime = log.checkInTime as Date;
            const durationMs = now.getTime() - checkInTime.getTime();
            
            log.checkOutTime = now;
            log.durationMinutes = Math.round(durationMs / 60000);

            const place = realm.objectForPrimaryKey('Place', placeId) as any;
            if (place) {
              place.isInside = false;
            }
            closedCount++;
          });
        }

        console.log(`[CheckInService] Batch closed ${closedCount} check-ins`);
        return true;
      },
      `batchCloseCheckIns:${placeIds.length}`
    ) ?? false;
  },
};