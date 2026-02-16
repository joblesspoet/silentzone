import { PersistentAlarmService } from '../src/services/PersistentAlarmService';
import { NativeModules, Platform } from 'react-native';

// --- MOCKS ---

jest.mock('react-native', () => {
  const RN = jest.requireActual('react-native');
  
  // Create a stable mock object for the native module
  const mockModule = {
    scheduleAlarm: jest.fn(),
    cancelAlarm: jest.fn(),
    getAllAlarms: jest.fn(),
    verifyAlarms: jest.fn(),
    isAlarmScheduled: jest.fn(),
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };

  // Inject into NativeModules
  RN.NativeModules.PersistentAlarmModule = mockModule;

  // Mock NativeEventEmitter
  RN.NativeEventEmitter = jest.fn().mockImplementation(() => ({
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
  }));

  // Define Platform
  RN.Platform = {
    OS: 'android',
    select: jest.fn().mockImplementation((objs: any) => objs.android || objs.default),
  };

  return RN;
});

jest.mock('../src/services/Logger', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('PersistentAlarmService', () => {
  const { PersistentAlarmModule } = NativeModules;

  beforeEach(() => {
    jest.clearAllMocks();
    Platform.OS = 'android';
    
    // Default mock behavior
    (PersistentAlarmModule.scheduleAlarm as jest.Mock).mockResolvedValue(true);
    (PersistentAlarmModule.cancelAlarm as jest.Mock).mockResolvedValue(true);
    (PersistentAlarmModule.verifyAlarms as jest.Mock).mockResolvedValue(0);
    (PersistentAlarmModule.getAllAlarms as jest.Mock).mockResolvedValue([]);
  });

  describe('scheduleAlarm', () => {
    test('should call native scheduleAlarm with correct parameters', async () => {
      const alarmId = 'test-alarm-1';
      const triggerTime = new Date('2026-02-17T08:00:00Z');
      const title = 'Test Title';
      const body = 'Test Body';
      const data = { placeId: '123', action: 'START' };

      const result = await PersistentAlarmService.scheduleAlarm(alarmId, triggerTime, title, body, data);

      expect(result).toBe(true);
      expect(PersistentAlarmModule.scheduleAlarm).toHaveBeenCalledWith(
        alarmId,
        triggerTime.getTime(),
        title,
        body,
        data
      );
    });

    test('should return false if native module fails', async () => {
      (PersistentAlarmModule.scheduleAlarm as jest.Mock).mockResolvedValue(false);
      const result = await PersistentAlarmService.scheduleAlarm('id', Date.now(), 't', 'b', { placeId: '1', action: 'X' });
      expect(result).toBe(false);
    });

    test('should return false on non-android platforms', async () => {
      Platform.OS = 'ios';
      const result = await PersistentAlarmService.scheduleAlarm('id', Date.now(), 't', 'b', { placeId: '1', action: 'X' });
      expect(result).toBe(false);
      expect(PersistentAlarmModule.scheduleAlarm).not.toHaveBeenCalled();
    });
  });

  describe('cancelAlarm', () => {
    test('should call native cancelAlarm', async () => {
      const result = await PersistentAlarmService.cancelAlarm('test-id');
      expect(result).toBe(true);
      expect(PersistentAlarmModule.cancelAlarm).toHaveBeenCalledWith('test-id');
    });

    test('should skip native call on non-android', async () => {
      Platform.OS = 'ios';
      const result = await PersistentAlarmService.cancelAlarm('test-id');
      expect(result).toBe(true);
      expect(PersistentAlarmModule.cancelAlarm).not.toHaveBeenCalled();
    });
  });

  describe('getAllAlarms', () => {
    test('should return list of alarms from native module', async () => {
      const mockAlarms = [
        { id: '1', triggerTime: 123456789, title: 'T1', body: 'B1', minutesUntilFire: 10 },
        { id: '2', triggerTime: 987654321, title: 'T2', body: 'B2', minutesUntilFire: 60 },
      ];
      (PersistentAlarmModule.getAllAlarms as jest.Mock).mockResolvedValue(mockAlarms);

      const result = await PersistentAlarmService.getAllAlarms();

      expect(result).toEqual(mockAlarms);
      expect(PersistentAlarmModule.getAllAlarms).toHaveBeenCalled();
    });
  });

  describe('verifyAlarms', () => {
    test('should call native verifyAlarms and return missing count', async () => {
      (PersistentAlarmModule.verifyAlarms as jest.Mock).mockResolvedValue(2);
      const result = await PersistentAlarmService.verifyAlarms();
      expect(result).toBe(2);
      expect(PersistentAlarmModule.verifyAlarms).toHaveBeenCalled();
    });
  });

  describe('getDiagnosticReport', () => {
    test('should generate a report when alarms exist', async () => {
      const now = Date.now();
      const mockAlarms = [
        { id: '1', triggerTime: now + 600000, title: 'Active Alarm', body: 'Body', minutesUntilFire: 10 },
      ];
      (PersistentAlarmModule.getAllAlarms as jest.Mock).mockResolvedValue(mockAlarms);

      const report = await PersistentAlarmService.getDiagnosticReport();

      expect(report).toContain('Active Alarm');
      expect(report).toContain('Total Scheduled: 1');
      expect(report).toContain('10 min from now');
    });

    test('should generate a "no alarms" message when list is empty', async () => {
      (PersistentAlarmModule.getAllAlarms as jest.Mock).mockResolvedValue([]);

      const report = await PersistentAlarmService.getDiagnosticReport();

      expect(report).toContain('NO alarms currently scheduled');
      expect(report).toContain('Total Scheduled: 0');
    });
  });
});
