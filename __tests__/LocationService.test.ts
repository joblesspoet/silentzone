import { locationService } from '../src/services/LocationService';
import { PlaceService } from '../src/database/services/PlaceService';
import { CheckInService } from '../src/database/services/CheckInService';
import notifee from '@notifee/react-native';
import Geolocation from '@react-native-community/geolocation';

// --- MOCKS ---

// 1. Mock Realm
const mockRealm = {
  active: true,
  isClosed: false,
  write: jest.fn((callback) => callback()),
  create: jest.fn(),
  delete: jest.fn(),
  objects: jest.fn(),
  objectForPrimaryKey: jest.fn(),
};

// 2. Mock PlaceService keys
jest.mock('../src/database/services/PlaceService', () => ({
  PlaceService: {
    getEnabledPlaces: jest.fn(),
    getPlaceById: jest.fn(),
  },
}));

// 3. Mock CheckInService keys
jest.mock('../src/database/services/CheckInService', () => ({
  CheckInService: {
    getActiveCheckIns: jest.fn(),
    isPlaceActive: jest.fn(),
    logCheckIn: jest.fn(),
    logCheckOut: jest.fn(),
  },
}));

// 4. Mock Notifee
jest.mock('@notifee/react-native', () => ({
  displayNotification: jest.fn(),
  createTriggerNotification: jest.fn(),
  cancelTriggerNotification: jest.fn(),
  TriggerType: { TIMESTAMP: 0 },
  AndroidImportance: { HIGH: 4 },
  AndroidCategory: { ALARM: 'alarm' },
}));

// 4.5. Mock Geofencing
jest.mock('@rn-org/react-native-geofencing', () => ({
  init: jest.fn(),
  addGeofence: jest.fn(),
  removeGeofence: jest.fn(),
  onGeofenceEvent: jest.fn(),
}));

// Mock React Native Platform
jest.mock('react-native', () => {
    const RN = jest.requireActual('react-native');
    Object.defineProperty(RN, 'Platform', {
        get: () => ({
            OS: 'android',
            select: (objs: any) => objs.android || objs.default,
        }),
    });
    return RN;
});

// 5. Mock Geolocation
jest.mock('@react-native-community/geolocation', () => ({
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
}));

// 5.5 Mock Async Storage
jest.mock('@react-native-async-storage/async-storage', () => ({
  setItem: jest.fn(),
  getItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  getAllKeys: jest.fn(),
  multiGet: jest.fn(),
  multiSet: jest.fn(),
  multiRemove: jest.fn(),
}));

// 5.6 Mock RingerMode (Custom Module)
jest.mock('../src/modules/RingerMode', () => ({
  getRingerMode: jest.fn(),
  setRingerMode: jest.fn(),
  checkDndPermission: jest.fn(),
  requestDndPermission: jest.fn(),
  getStreamVolume: jest.fn(),
  setStreamVolume: jest.fn(),
  STREAM_TYPES: { MUSIC: 3, RING: 2, NOTIFICATION: 5, ALARM: 4 },
}));

// Mock new service modules
jest.mock('../src/services/SilentZoneManager', () => ({
  silentZoneManager: {
    setRealm: jest.fn(),
    activateSilentZone: jest.fn().mockResolvedValue(true),
    handleExit: jest.fn().mockResolvedValue(true),
    isPlaceActive: jest.fn().mockReturnValue(false),
    getActiveCheckInCount: jest.fn().mockReturnValue(0),
  },
  SilentZoneManager: jest.fn().mockImplementation(() => ({
    setRealm: jest.fn(),
    activateSilentZone: jest.fn().mockResolvedValue(true),
    handleExit: jest.fn().mockResolvedValue(true),
  })),
}));

jest.mock('../src/services/GPSManager', () => ({
  gpsManager: {
    startWatching: jest.fn(),
    stopWatching: jest.fn(),
    forceLocationCheck: jest.fn().mockResolvedValue(undefined),
    isWatching: jest.fn().mockReturnValue(false),
    getLastKnownLocation: jest.fn().mockReturnValue(null),
  },
  GPSManager: jest.fn().mockImplementation(() => ({
    startWatching: jest.fn(),
    stopWatching: jest.fn(),
    forceLocationCheck: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../src/services/TimerManager', () => ({
  timerManager: {
    schedule: jest.fn(),
    clear: jest.fn(),
    clearAll: jest.fn(),
    hasTimer: jest.fn().mockReturnValue(false),
  },
  TimerManager: jest.fn().mockImplementation(() => ({
    schedule: jest.fn(),
    clear: jest.fn(),
    clearAll: jest.fn(),
    hasTimer: jest.fn().mockReturnValue(false),
  })),
}));

// 5.7 Mock Permissions
jest.mock('react-native-permissions', () => ({
  check: jest.fn(),
  request: jest.fn(),
  PERMISSIONS: { ANDROID: {}, IOS: {} },
  RESULTS: { GRANTED: 'granted', DENIED: 'denied', BLOCKED: 'blocked' },
}));

// 6. Mock Logger to avoid clutter
jest.mock('../src/services/Logger', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// 7. Mock Config
jest.mock('../src/config/config', () => ({
  CONFIG: {
    DISTANCE: { VERY_CLOSE: 50 },
    MAX_ACCEPTABLE_ACCURACY: 50,
    EXIT_BUFFER_MULTIPLIER: 1.2,
    SCHEDULE: {
      PRE_ACTIVATION_MINUTES: 15,
      SMALL_RADIUS_THRESHOLD: 100,
    },
    DEBOUNCE_TIME: 2000,
    CHANNELS: { ALERTS: 'alerts', SERVICE: 'service' },
  },
}));

describe('LocationService Logic', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset service state if possible (we might need a reset method in LocationService for pure testing)
    (locationService as any).realm = mockRealm;
    (locationService as any).lastTriggerTime = {};
    (locationService as any).isChecking = false;
    (locationService as any).geofencesActive = true; // Set to true so processing happens
  });

  test('should determine user is INSIDE a place', async () => {
    // Import the mocked SilentZoneManager
    const { silentZoneManager } = require('../src/services/SilentZoneManager');

    // GIVEN a place at (0,0) with radius 100m
    const mockPlace = {
      id: 'place-1',
      name: 'Test Zone',
      latitude: 0,
      longitude: 0,
      radius: 100,
      isEnabled: true,
      schedules: [], // 24/7
    };

    (PlaceService.getEnabledPlaces as jest.Mock).mockReturnValue([mockPlace]);
    (PlaceService.getPlaceById as jest.Mock).mockReturnValue(mockPlace);
    (CheckInService.getActiveCheckIns as jest.Mock).mockReturnValue([]);
    (CheckInService.isPlaceActive as jest.Mock).mockReturnValue(false);

    // Mock SilentZoneManager
    (silentZoneManager.activateSilentZone as jest.Mock).mockResolvedValue(true);

    // WHEN user is at (0, 0) (Distance = 0)
    const mockPosition = {
      coords: {
        latitude: 0.0001, // Very close
        longitude: 0,
        accuracy: 10,
      },
      timestamp: Date.now(),
    };

    // Trigger private method via "any" cast or improved testability
    await (locationService as any).processLocationUpdate(mockPosition);

    // THEN
    // SilentZoneManager should be called to activate the zone
    expect(silentZoneManager.activateSilentZone).toHaveBeenCalledWith(mockPlace);

    // 2. Notification should be displayed
    expect(notifee.displayNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Phone Silenced 🔕' })
    );
  });

  test('should determine user is OUTSIDE a place', async () => {
    // Import the mocked SilentZoneManager
    const { silentZoneManager } = require('../src/services/SilentZoneManager');

    // GIVEN user is checked in
    const mockPlace = {
      id: 'place-1',
      latitude: 0,
      longitude: 0,
      radius: 100,
      schedules: [],
    };

    const mockLog = { id: 'log-1', placeId: 'place-1' };

    (PlaceService.getEnabledPlaces as jest.Mock).mockReturnValue([mockPlace]);
    (PlaceService.getPlaceById as jest.Mock).mockReturnValue(mockPlace);
    (CheckInService.getActiveCheckIns as jest.Mock).mockReturnValue([mockLog]);
    (CheckInService.isPlaceActive as jest.Mock).mockReturnValue(true);

    // Mock SilentZoneManager
    (silentZoneManager.handleExit as jest.Mock).mockResolvedValue(true);

    // WHEN user moves far away (e.g. 1km)
    const mockPosition = {
      coords: {
        latitude: 0.01, // ~1.1km away
        longitude: 0,
        accuracy: 10,
      },
      timestamp: Date.now(),
    };

    await (locationService as any).processLocationUpdate(mockPosition);

    // THEN
    // SilentZoneManager should be called to handle exit
    expect(silentZoneManager.handleExit).toHaveBeenCalledWith('place-1', false);
  });
});
