
import { calculateNewPosition, haversineDistance } from '../DeadReckoningService';

describe('DeadReckoningService', () => {
  describe('calculateNewPosition', () => {
    it('should calculate correct position moving North', () => {
      // Start at 0,0
      const start = { lat: 0, lng: 0 };
      // Move 1000 meters North (1000 steps * 1m stride)
      const result = calculateNewPosition(start, 1000, 0, 1);
      
      // Expected: lat increases, lng stays same
      // 1000m is approx 0.00899 degrees (1000 / 111320)
      expect(result.lat).toBeGreaterThan(0);
      expect(result.lng).toBeCloseTo(0, 5);
      expect(result.lat).toBeCloseTo(0.00899, 4);
    });

    it('should calculate correct position moving East', () => {
      // Start at 0,0
      const start = { lat: 0, lng: 0 };
      // Move 1000 meters East
      const result = calculateNewPosition(start, 1000, 90, 1);
      
      expect(result.lat).toBeCloseTo(0, 5);
      expect(result.lng).toBeGreaterThan(0);
      expect(result.lng).toBeCloseTo(0.00899, 4);
    });

    it('should calculate correct position moving South', () => {
      const start = { lat: 0, lng: 0 };
      const result = calculateNewPosition(start, 1000, 180, 1);
      
      expect(result.lat).toBeLessThan(0);
      expect(result.lng).toBeCloseTo(0, 5);
    });

    it('should calculate correct position moving West', () => {
      const start = { lat: 0, lng: 0 };
      const result = calculateNewPosition(start, 1000, 270, 1);
      
      expect(result.lat).toBeCloseTo(0, 5);
      expect(result.lng).toBeLessThan(0);
    });
  });

  describe('haversineDistance', () => {
    it('should calculate distance correctly between two points', () => {
      // Distance between (0,0) and (1,0) is approx 111.19 km
      // Earth radius 6371km -> circumference 40030km -> 1 deg = 111.19km
      const dist = haversineDistance(0, 0, 1, 0);
      expect(dist).toBeCloseTo(111195, -2); // Allow 100m variance due to slightly different constants
    });

    it('should match calculateNewPosition result', () => {
      const start = { lat: 10, lng: 10 };
      const steps = 500;
      const stride = 0.8; // 400 meters
      const heading = 45; // North-East
      
      const end = calculateNewPosition(start, steps, heading, stride);
      const dist = haversineDistance(start.lat, start.lng, end.lat, end.lng);
      
      // The distance between start and end should be very close to steps * stride
      expect(dist).toBeCloseTo(steps * stride, 0);
    });
  });
});
