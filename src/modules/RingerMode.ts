import { NativeModules } from 'react-native';

const { RingerModeModule } = NativeModules;

export const RINGER_MODE = {
  silent: 0,
  vibrate: 1,
  normal: 2,
};

export default {
  getRingerMode: (): Promise<number> => {
    return RingerModeModule.getRingerMode();
  },
  
  setRingerMode: (mode: number): Promise<boolean> => {
    return RingerModeModule.setRingerMode(mode);
  },

  checkDndPermission: (): Promise<boolean> => {
    return RingerModeModule.checkDndPermission();
  },

  requestDndPermission: (): Promise<boolean> => {
    return RingerModeModule.requestDndPermission();
  },
  
  getStreamVolume: (streamType: number): Promise<number> => {
    return RingerModeModule.getStreamVolume(streamType);
  },

  setStreamVolume: (streamType: number, volume: number, flags: number = 0): Promise<boolean> => {
    return RingerModeModule.setStreamVolume(streamType, volume, flags);
  },

  // Constants for stream types
  STREAM_TYPES: {
    VOICE_CALL: 0,
    SYSTEM: 1,
    RING: 2,
    MUSIC: 3,
    ALARM: 4,
    NOTIFICATION: 5,
  }
};
