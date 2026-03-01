
import { getInitialAnchor, requestNetworkAnchor, shouldReAnchor, Place } from '../AnchorManager';
import Geolocation from 'react-native-geolocation-service';

// Mock Geolocation
jest.mock('react-native-geolocation-service', () => ({
  getCurrentPosition: jest.fn(),
}));

describe('AnchorManager', () => {
  describe('shouldReAnchor', () => {
    it('should return false when distance < 300m', () => {
      expect(shouldReAnchor(0)).toBe(false);
      expect(shouldReAnchor(100)).toBe(false);
      expect(shouldReAnchor(299)).toBe(false);
    });

    it('should return true when distance >= 300m', () => {
      expect(shouldReAnchor(300)).toBe(true);
      expect(shouldReAnchor(500)).toBe(true);
    });
  });

  describe('requestNetworkAnchor', () => {
    it('should resolve with network position when successful', async () => {
      const mockPosition = {
        coords: {
          latitude: 10,
          longitude: 20,
          accuracy: 50,
        },
        timestamp: 123456789,
      };

      (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((success, error, options) => {
        // Verify options favor network/low power
        expect(options.enableHighAccuracy).toBe(false);
        success(mockPosition);
      });

      const result = await requestNetworkAnchor();

      expect(result.lat).toBe(10);
      expect(result.lng).toBe(20);
      expect(result.accuracy).toBe(50);
      expect(result.source).toBe('NETWORK');
    });

    it('should reject when geolocation fails', async () => {
      const mockError = new Error('Location disabled');

      (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((success, error, options) => {
        error(mockError);
      });

      await expect(requestNetworkAnchor()).rejects.toThrow('Location disabled');
    });
  });

  describe('getInitialAnchor', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return network anchor when successful', async () => {
      // Mock successful network request
      const mockPosition = {
        coords: { latitude: 10, longitude: 20, accuracy: 50 },
        timestamp: 12345,
      };
      (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((success) => success(mockPosition));

      const result = await getInitialAnchor([]);

      expect(result).not.toBeNull();
      expect(result?.lat).toBe(10);
      expect(result?.source).toBe('NETWORK');
    });

    it('should snap to saved place when within 100m of network fix', async () => {
      // Mock network returning a position close to a saved place
      const mockPosition = {
        coords: { latitude: 10.0005, longitude: 20.0005, accuracy: 50 },
        timestamp: 12345,
      };
      (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((success) => success(mockPosition));

      // Place is at (10, 20) — about 78m from (10.0005, 20.0005)
      const places: Place[] = [
        { id: '1', name: 'Home Mosque', latitude: 10.0, longitude: 20.0, radius: 50 },
      ];

      const result = await getInitialAnchor(places);

      expect(result).not.toBeNull();
      expect(result?.lat).toBe(10.0);
      expect(result?.lng).toBe(20.0);
      expect(result?.source).toBe('HOME');
      expect(result?.accuracy).toBe(5); // High precision from saved coords
    });

    it('should NOT snap when saved place is far from network fix', async () => {
      // Mock network returning position far from any saved place  
      const mockPosition = {
        coords: { latitude: 11.0, longitude: 21.0, accuracy: 50 },
        timestamp: 12345,
      };
      (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((success) => success(mockPosition));

      const places: Place[] = [
        { id: '1', name: 'Far Mosque', latitude: 10.0, longitude: 20.0, radius: 50 },
      ];

      const result = await getInitialAnchor(places);

      expect(result).not.toBeNull();
      expect(result?.lat).toBe(11.0); // Returns network position, not place
      expect(result?.source).toBe('NETWORK');
    });

    it('should return null when network anchor fails (and no fallback implemented yet)', async () => {
       (Geolocation.getCurrentPosition as jest.Mock).mockImplementation((s, error) => error(new Error('Fail')));
       
       const result = await getInitialAnchor([]);
       
       expect(result).toBeNull();
    });
  });
});
