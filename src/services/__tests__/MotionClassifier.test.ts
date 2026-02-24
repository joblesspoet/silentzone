
import { classifyMotion, getStrideLength, detectCurrentMotion } from '../MotionClassifier';
import { NativeModules } from 'react-native';

// Mock NativeModules
jest.mock('react-native', () => ({
  NativeModules: {
    SZSensorModule: {
      getStepCount: jest.fn(),
      getAcceleration: jest.fn(),
    },
  },
}));

describe('MotionClassifier', () => {
  describe('classifyMotion', () => {
    it('should classify as WALKING when steps > 0', () => {
      expect(classifyMotion(1, 9.8)).toBe('WALKING');
      expect(classifyMotion(10, 15.0)).toBe('WALKING'); // Even with high accel, steps dominate
    });

    it('should classify as STATIONARY when steps = 0 and accel is near gravity (9.8)', () => {
      expect(classifyMotion(0, 9.8)).toBe('STATIONARY');
      expect(classifyMotion(0, 9.8 + 0.4)).toBe('STATIONARY'); // Within 0.5 threshold
      expect(classifyMotion(0, 9.8 - 0.4)).toBe('STATIONARY');
    });

    it('should classify as VEHICLE_CAR when steps = 0 and accel shows moderate movement', () => {
      // Variance > 0.5 but < 2.0
      // 9.8 + 0.6 = 10.4 (diff 0.6)
      expect(classifyMotion(0, 10.4)).toBe('VEHICLE_CAR');
      expect(classifyMotion(0, 9.0)).toBe('VEHICLE_CAR');
    });

    it('should classify as VEHICLE_BIKE when steps = 0 and accel shows heavy movement', () => {
      // Variance > 2.0
      // 9.8 + 2.1 = 11.9
      expect(classifyMotion(0, 12.0)).toBe('VEHICLE_BIKE');
      // 9.8 - 2.1 = 7.7
      expect(classifyMotion(0, 5.0)).toBe('VEHICLE_BIKE');
    });
  });

  describe('getStrideLength', () => {
    it('should return correct stride length for WALKING', () => {
      expect(getStrideLength('WALKING')).toBeCloseTo(0.76);
    });

    it('should return 0 for STATIONARY', () => {
      expect(getStrideLength('STATIONARY')).toBe(0);
    });

    it('should return 0 for VEHICLE types', () => {
      expect(getStrideLength('VEHICLE_CAR')).toBe(0);
      expect(getStrideLength('VEHICLE_BIKE')).toBe(0);
    });
  });

  describe('detectCurrentMotion', () => {
    const mockSensorModule = NativeModules.SZSensorModule;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return correct motion state and step delta', async () => {
      // Mock sensor responses
      mockSensorModule.getStepCount.mockResolvedValue({ steps: 100 });
      mockSensorModule.getAcceleration.mockResolvedValue({ magnitude: 9.8 });

      // Last steps = 90, current = 100 => delta = 10 => WALKING
      const result = await detectCurrentMotion(90);

      expect(result.state).toBe('WALKING');
      expect(result.currentSteps).toBe(100);
      expect(result.stepDelta).toBe(10);
      expect(mockSensorModule.getStepCount).toHaveBeenCalled();
      expect(mockSensorModule.getAcceleration).toHaveBeenCalled();
    });

    it('should handle sensor errors gracefully and return STATIONARY', async () => {
      mockSensorModule.getStepCount.mockRejectedValue(new Error('Sensor fail'));
      
      const result = await detectCurrentMotion(100);
      
      expect(result.state).toBe('STATIONARY');
      expect(result.currentSteps).toBe(100); // Should return last known
      expect(result.stepDelta).toBe(0);
    });
  });
});
