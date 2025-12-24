import Realm from 'realm';
import { generateUUID } from '../../utils/uuid';

export const CheckInService = {
  logCheckIn: (realm: Realm, placeId: string, volumeLevel?: number) => {
    let log;
    realm.write(() => {
      log = realm.create('CheckInLog', {
        id: generateUUID(),
        placeId,
        checkInTime: new Date(),
        savedVolumeLevel: volumeLevel,
        wasAutomatic: true,
      });
      
      // Update place stats
      const place = realm.objectForPrimaryKey('Place', placeId);
      if (place) {
        place.lastCheckInAt = new Date();
        place.totalCheckIns += 1;
      }
    });
    return log;
  },

  logCheckOut: (realm: Realm, logId: string) => {
    const log = realm.objectForPrimaryKey('CheckInLog', logId);
    if (log) {
      const now = new Date();
      const checkInTime = log.checkInTime as Date;
      const durationMs = now.getTime() - checkInTime.getTime();
      
      realm.write(() => {
        log.checkOutTime = now;
        log.durationMinutes = Math.round(durationMs / 60000); // milliseconds to minutes
      });
      return true;
    }
    return false;
  },

  getCurrentCheckIn: (realm: Realm) => {
    // Find logs where checkOutTime is null
    return realm.objects('CheckInLog').filtered('checkOutTime == null')[0];
  },

  getRecentCheckIns: (realm: Realm, limit: number = 10) => {
    return realm.objects('CheckInLog')
      .sorted('checkInTime', true)
      .slice(0, limit);
  },

  getCheckInsForPlace: (realm: Realm, placeId: string) => {
    return realm.objects('CheckInLog')
      .filtered('placeId == $0', placeId)
      .sorted('checkInTime', true);
  }
};
