import Realm from 'realm';
import { generateUUID } from '../../utils/uuid';

export const CheckInService = {
  logCheckIn: (realm: Realm, placeId: string, volumeLevel?: number, mediaVolume?: number) => {
    // 1. We no longer force-close other check-ins. 
    // This allows overlapping zones to both be "Active".
    
    let log;
    realm.write(() => {
      log = realm.create('CheckInLog', {
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
        
        // Reset isInside
        const place = realm.objectForPrimaryKey('Place', log.placeId) as any;
        if (place) place.isInside = false;
      });
      return true;
    }
    return false;
  },

  getCurrentCheckIn: (realm: Realm) => {
    // Find logs where checkOutTime is null
    return realm.objects('CheckInLog').filtered('checkOutTime == null')[0];
  },

  isPlaceActive: (realm: Realm, placeId: string) => {
    return realm.objects('CheckInLog').filtered('placeId == $0 AND checkOutTime == null', placeId).length > 0;
  },

  getActiveCheckIns: (realm: Realm) => {
    return realm.objects('CheckInLog').filtered('checkOutTime == null');
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
  },

  closeAllCheckIns: (realm: Realm) => {
    const activeCheckIns = realm.objects('CheckInLog').filtered('checkOutTime == null');
    if (activeCheckIns.length > 0) {
      realm.write(() => {
        const now = new Date();
        activeCheckIns.forEach((log: any) => {
          log.checkOutTime = now;
          const checkInTime = log.checkInTime as Date;
          const durationMs = now.getTime() - checkInTime.getTime();
          log.durationMinutes = Math.round(durationMs / 60000);

          // Reset isInside
          const place = realm.objectForPrimaryKey('Place', log.placeId) as any;
          if (place) place.isInside = false;
        });
      });
      return true;
    }
    return false;
  }
};
