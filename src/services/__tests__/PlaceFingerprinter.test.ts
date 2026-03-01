
import { captureFingerprint, matchFingerprint } from '../PlaceFingerprinter';
import { NativeModules } from 'react-native';

// Mock NativeModules
jest.mock('react-native', () => ({
  NativeModules: {
    SZSensorModule: {
      // Mock methods if we add them later
    },
  },
}));

describe('PlaceFingerprinter', () => {
  describe('captureFingerprint', () => {
    it('should return null when sensor module is missing capability', async () => {
      // Currently our implementation just returns null and logs warning
      const result = await captureFingerprint('some-uuid');
      expect(result).toBeNull();
    });

    // When we implement actual sensor reading, we will add test case:
    // it('should return fingerprint data when sensors are available', ...)
  });

  describe('matchFingerprint', () => {
    it('should return 0.0 when sensor module methods are not available (error fallback)', async () => {
      const mockFingerprint = {
        placeId: '123',
        avgPressure: 1013,
        timestamp: Date.now(),
      };
      const score = await matchFingerprint(mockFingerprint);
      expect(score).toBe(0.0); // catch block returns 0.0 when native module throws
    });
  });
});
