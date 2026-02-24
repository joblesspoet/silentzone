
import { generateGrid, getCellForPosition, isInsideRadius } from '../GridEngine';
import { haversineDistance } from '../DeadReckoningService';

// Mock haversineDistance if needed, but since it's pure logic, real one is fine
// We'll test GridEngine functionality assuming haversine works correctly (tested in TASK-01)

describe('GridEngine', () => {
  describe('generateGrid', () => {
    it('should generate a grid of correct dimensions', () => {
      const center = { lat: 0, lng: 0 };
      const radius = 50; // 50m
      const cellSize = 10; // 10m
      
      // Grid should cover roughly 2 * (radius + buffer)
      // Buffer logic in implementation is `gridRadiusMeters = radius + cellSize`
      // So width ~ 2 * (50 + 10) = 120m
      // numCells ~ 120 / 10 = 12
      
      const grid = generateGrid(center.lat, center.lng, radius, cellSize);
      
      expect(grid.length).toBeGreaterThan(0);
      expect(grid[0].length).toBeGreaterThan(0);
      
      // Check if grid is square
      const rows = grid.length;
      const cols = grid[0].length;
      expect(rows).toBe(cols);
      
      // Check if center cell is marked inside
      const centerCell = getCellForPosition(grid, 0, 0);
      expect(centerCell).not.toBeNull();
      expect(centerCell?.isInside).toBe(true);
      expect(centerCell?.distanceFromCenter).toBeLessThan(cellSize); // Should be very close to 0
    });

    it('should mark cells correctly as inside/outside radius', () => {
      const center = { lat: 0, lng: 0 };
      const radius = 50; // 50m
      const cellSize = 10; // 10m
      
      const grid = generateGrid(center.lat, center.lng, radius, cellSize);
      
      // Find a cell definitely outside (e.g., at 60m distance)
      // Since we generate a square grid bounding the circle, corners should be outside
      const cornerCell = grid[0][0];
      expect(cornerCell.isInside).toBe(false);
      
      // Find a cell definitely inside (center)
      // We can use getCellForPosition to find the center cell
      const centerCell = getCellForPosition(grid, 0, 0);
      expect(centerCell?.isInside).toBe(true);
    });
  });

  describe('getCellForPosition', () => {
    it('should return correct cell for a given position', () => {
      const center = { lat: 0, lng: 0 };
      const radius = 100;
      const cellSize = 10;
      const grid = generateGrid(center.lat, center.lng, radius, cellSize);
      
      // Pick a random cell from the grid
      const targetCell = grid[5][5];
      
      // Ask for the cell at that exact location
      const result = getCellForPosition(grid, targetCell.lat, targetCell.lng);
      
      expect(result).toBe(targetCell);
    });

    it('should return null for position far outside grid', () => {
      const center = { lat: 0, lng: 0 };
      const radius = 10;
      const cellSize = 5;
      const grid = generateGrid(center.lat, center.lng, radius, cellSize);
      
      // Position far away (1 degree away is ~111km)
      const result = getCellForPosition(grid, 1, 1);
      
      expect(result).toBeNull();
    });

    it('should return nearest cell for position slightly off-center of a cell', () => {
      const center = { lat: 0, lng: 0 };
      const radius = 50;
      const cellSize = 10;
      const grid = generateGrid(center.lat, center.lng, radius, cellSize);
      
      // Get center cell
      const centerCell = getCellForPosition(grid, 0, 0);
      
      // Add a tiny offset (0.00001 deg is ~1.1m) which is < cellSize/2 (5m)
      // So it should still map to the same cell or a neighbor, but specifically the closest one
      const offsetLat = 0.00001;
      const result = getCellForPosition(grid, offsetLat, 0);
      
      // Calculate expected closest cell manually
      let closest = null;
      let minDst = Infinity;
      grid.flat().forEach(c => {
        const d = (c.lat - offsetLat)**2 + (c.lng - 0)**2;
        if (d < minDst) {
          minDst = d;
          closest = c;
        }
      });
      
      expect(result).toBe(closest);
    });
  });

  describe('isInsideRadius', () => {
    it('should return true for cells marked inside', () => {
      const cell = {
        row: 0, col: 0, lat: 0, lng: 0,
        isInside: true,
        distanceFromCenter: 0
      };
      expect(isInsideRadius(cell)).toBe(true);
    });

    it('should return false for cells marked outside', () => {
      const cell = {
        row: 0, col: 0, lat: 0, lng: 0,
        isInside: false,
        distanceFromCenter: 100
      };
      expect(isInsideRadius(cell)).toBe(false);
    });
  });
});
