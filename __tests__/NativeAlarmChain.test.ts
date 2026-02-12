import { locationService } from '../src/services/LocationService';
import { PlaceService } from '../src/database/services/PlaceService';
import { alarmService, ALARM_ACTIONS } from '../src/services/AlarmService';
import { ScheduleManager } from '../src/services/ScheduleManager';
import notifee from '@notifee/react-native';
import { gpsManager } from '../src/services/GPSManager';
import { CONFIG } from '../src/config/config';

// --- EXHAUSTIVE MOCKS ---

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  RN.NativeModules.RNCNetInfo = {};
  RN.NativeModules.RNPermissions = {};
  RN.NativeModules.RNGestureHandlerModule = {};
  RN.TurboModuleRegistry.getEnforcing = jest.fn();
  Object.defineProperty(RN, 'Platform', {
    get: () => ({
      OS: 'android',
      select: (objs: any) => objs.android || objs.default,
    }),
  });
  return RN;
});

jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
}));

jest.mock('react-native-geolocation-service', () => ({
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
  stopObserving: jest.fn(),
}));

jest.mock('react-native-permissions', () => ({
  check: jest.fn().mockResolvedValue('granted'),
  request: jest.fn().mockResolvedValue('granted'),
  PERMISSIONS: { ANDROID: {}, IOS: {} },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', BLOCKED: 'blocked' },
}));

jest.mock('@rn-org/react-native-geofencing', () => ({
  __esModule: true,
  default: {
    addGeofence: jest.fn().mockResolvedValue(true),
    removeAllGeofence: jest.fn().mockResolvedValue(true),
    removeGeofence: jest.fn().mockResolvedValue(true),
  }
}));

jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    createTriggerNotification: jest.fn(),
    getTriggerNotifications: jest.fn().mockResolvedValue([]),
    cancelTriggerNotification: jest.fn(),
    createNotificationChannels: jest.fn(),
    startForegroundService: jest.fn(),
    stopForegroundService: jest.fn(),
  },
  EventType: { TRIGGER_NOTIFICATION_CREATED: 0 },
  TriggerType: { TIMESTAMP: 0 },
  AndroidImportance: { MIN: 1 },
  AndroidCategory: { ALARM: 'alarm' },
  AlarmType: { SET_EXACT_AND_ALLOW_WHILE_IDLE: 0 },
}));

jest.mock('../src/permissions/PermissionsManager', () => ({
  PermissionsManager: {
    hasCriticalPermissions: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('../src/database/services/PlaceService');
jest.mock('../src/database/services/CheckInService');
jest.mock('../src/database/services/PreferencesService');

jest.mock('../src/services/GPSManager', () => ({
  gpsManager: {
    startWatching: jest.fn(),
    stopWatching: jest.fn(),
    forceLocationCheck: jest.fn(),
  },
}));

jest.mock('../src/services/SilentZoneManager', () => ({
  silentZoneManager: {
    setRealm: jest.fn(),
    activateSilentZone: jest.fn(),
    handleExit: jest.fn(),
  },
}));

jest.mock('../src/services/NotificationManager', () => ({
  notificationManager: {
    createNotificationChannels: jest.fn(),
    startForegroundService: jest.fn(),
    stopForegroundService: jest.fn(),
  },
}));

jest.mock('../src/services/Logger');

jest.mock('../src/modules/RingerMode', () => ({
  getRingerMode: jest.fn(),
  setRingerMode: jest.fn(),
}));

jest.mock('../src/services/LocationValidator', () => ({
  LocationValidator: {
    determineInsidePlaces: jest.fn().mockReturnValue([]),
    calculateDistance: jest.fn().mockReturnValue(0),
  },
}));

const mockRealm = {
  isClosed: false,
  objectForPrimaryKey: jest.fn(),
  objects: jest.fn().mockReturnValue({ addListener: jest.fn() }),
};

describe('Native Alarm Chaining Logic', () => {
  const mockPlace = {
    id: 'real-place-uuid',
    name: 'Main Mosque',
    isEnabled: true,
    schedules: [
      { id: '1', startTime: '05:00', endTime: '06:00', days: [], label: 'Fajr' },
      { id: '2', startTime: '12:30', endTime: '13:30', days: [], label: 'Dhuhr' },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (locationService as any).realm = mockRealm;
    (locationService as any).geofencesActive = false; // Reset to false to test activation
    mockRealm.objectForPrimaryKey.mockReturnValue({ trackingEnabled: true });
    // IMPORTANT: Ensure Jest is using fake timers for the whole describe block
    jest.useFakeTimers();
  });

  test('Logical Case 1: All prayers passed for today (22:00)', async () => {
    // GIVEN: 22:00 local time
    const now = new Date();
    now.setHours(22, 0, 0, 0);
    jest.setSystemTime(now);

    (PlaceService.getEnabledPlaces as jest.Mock).mockReturnValue([mockPlace]);

    await locationService.syncGeofences();

    // EXPECT: Tomorrow Fajr (05:00 - 10m)
    const expectedTime = new Date(now);
    expectedTime.setDate(expectedTime.getDate() + 1);
    expectedTime.setHours(5, 0, 0, 0);
    const expectedTrigger = expectedTime.getTime() - (CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000);
    
    expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'place-real-place-uuid-start' }),
      expect.objectContaining({ timestamp: expectedTrigger })
    );
  });

  test('Logical Case 2: Join during ongoing prayer (13:00)', async () => {
    // GIVEN: 13:00 local time (During Dhuhr 12:30-13:30)
    const now = new Date();
    now.setHours(13, 0, 0, 0);
    jest.setSystemTime(now);

    (PlaceService.getEnabledPlaces as jest.Mock).mockReturnValue([mockPlace]);

    await locationService.syncGeofences();

    // 1. Dhuhr END for today
    const endTime = new Date(now);
    endTime.setHours(13, 30, 0, 0);
    expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'place-real-place-uuid-end' }),
      expect.objectContaining({ timestamp: endTime.getTime() })
    );

    // 2. Tomorrow Fajr START
    const nextStart = new Date(now);
    nextStart.setDate(nextStart.getDate() + 1);
    nextStart.setHours(5, 0, 0, 0);
    const expectedStartTrigger = nextStart.getTime() - (CONFIG.SCHEDULE.PRE_ACTIVATION_MINUTES * 60 * 1000);
    expect(notifee.createTriggerNotification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'place-real-place-uuid-start' }),
      expect.objectContaining({ timestamp: expectedStartTrigger })
    );

    expect(gpsManager.startWatching).toHaveBeenCalled();
  });

  test('Stability: Stable IDs overwrite existing alarms', async () => {
    (PlaceService.getEnabledPlaces as jest.Mock).mockReturnValue([mockPlace]);
    
    (notifee.getTriggerNotifications as jest.Mock).mockResolvedValue([
      { notification: { id: 'place-real-place-uuid-start' }, trigger: { timestamp: 12345 } }
    ]);

    const newTime = Date.now() + 100000;
    await alarmService.scheduleNativeAlarm('place-real-place-uuid-start', newTime, 'real-place-uuid', 'START');

    expect(notifee.createTriggerNotification).toHaveBeenCalled();
  });

  test('Resilience: Duplicate alarm prevention (Same ID + Same Time)', async () => {
    const targetTime = Date.now() + 500000;
    
    (notifee.getTriggerNotifications as jest.Mock).mockResolvedValue([
      { notification: { id: 'place-real-place-uuid-start' }, trigger: { timestamp: targetTime } }
    ]);

    await alarmService.scheduleNativeAlarm('place-real-place-uuid-start', targetTime, 'real-place-uuid', 'START');

    expect(notifee.createTriggerNotification).not.toHaveBeenCalled();
  });
});
