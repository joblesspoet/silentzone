
import { haversineDistance } from './DeadReckoningService';

export interface GridCell {
  row: number;
  col: number;
  lat: number;
  lng: number;
  isInside: boolean;
  distanceFromCenter: number;
}

/**
 * Generates a coordinate grid around a center point.
 * Marks each cell as inside or outside the radius.
 * 
 * The grid covers a square area of (2 * radius) x (2 * radius) centered on the point.
 * 
 * @param centerLat Latitude of the center point (mosque)
 * @param centerLng Longitude of the center point (mosque)
 * @param radiusMeters Radius of the geofence in meters
 * @param cellSizeMeters Size of each grid cell in meters (default 5m)
 * @returns 2D array of GridCell objects
 */
export const generateGrid = (
  centerLat: number,
  centerLng: number,
  radiusMeters: number,
  cellSizeMeters: number = 5
): GridCell[][] => {
  const EARTH_RADIUS_METERS = 6371000;
  
  // Calculate bounding box in degrees
  // 1 degree latitude is approx 111,320 meters
  // 1 degree longitude is approx 111,320 * cos(lat) meters
  const latDegreeDist = 111320;
  const lngDegreeDist = 111320 * Math.cos(centerLat * (Math.PI / 180));
  
  // Create a grid slightly larger than the radius to ensure coverage
  // We use a square that fully contains the circle
  const gridRadiusMeters = radiusMeters + cellSizeMeters; // Add buffer
  
  const latOffset = gridRadiusMeters / latDegreeDist;
  const lngOffset = gridRadiusMeters / lngDegreeDist;
  
  const minLat = centerLat - latOffset;
  const maxLat = centerLat + latOffset;
  const minLng = centerLng - lngOffset;
  const maxLng = centerLng + lngOffset;
  
  // Calculate number of cells
  const widthMeters = gridRadiusMeters * 2;
  const numCells = Math.ceil(widthMeters / cellSizeMeters);
  
  const grid: GridCell[][] = [];
  
  for (let row = 0; row < numCells; row++) {
    const rowCells: GridCell[] = [];
    // Calculate latitude for this row (from top/North to bottom/South or vice versa)
    // Let's go from South (minLat) to North (maxLat) to align with standard coordinate systems
    // where Y increases upwards (North)
    const cellLat = minLat + (row * cellSizeMeters) / latDegreeDist;
    
    for (let col = 0; col < numCells; col++) {
      // Calculate longitude for this col (from West to East)
      const cellLng = minLng + (col * cellSizeMeters) / lngDegreeDist;
      
      const dist = haversineDistance(centerLat, centerLng, cellLat, cellLng);
      const isInside = dist <= radiusMeters;
      
      rowCells.push({
        row,
        col,
        lat: cellLat,
        lng: cellLng,
        isInside,
        distanceFromCenter: dist
      });
    }
    grid.push(rowCells);
  }
  
  return grid;
};

/**
 * Finds the grid cell that contains the given latitude and longitude.
 * 
 * @param grid The generated grid
 * @param lat Latitude to look up
 * @param lng Longitude to look up
 * @returns The matching GridCell or null if outside the grid bounds
 */
export const getCellForPosition = (
  grid: GridCell[][],
  lat: number,
  lng: number
): GridCell | null => {
  if (!grid.length || !grid[0].length) return null;
  
  // Find the closest cell
  // Since the grid is regular, we could calculate indices directly if we stored the bounds
  // But for robustness with small grids, we can search for the nearest cell center
  
  let closestCell: GridCell | null = null;
  let minDistance = Number.MAX_VALUE;
  
  // Optimization: Check if point is roughly within the grid bounds first
  const firstCell = grid[0][0];
  const lastCell = grid[grid.length - 1][grid[0].length - 1];
  
  // Simple bounding box check (assumes grid is sorted by lat/lng which it is by construction)
  // Note: generateGrid builds from minLat to maxLat (South to North) and minLng to maxLng (West to East)
  const minLat = firstCell.lat;
  const maxLat = lastCell.lat;
  const minLng = firstCell.lng;
  const maxLng = lastCell.lng;
  
  // Allow a small margin of error for "edge of grid" cases
  const margin = 0.0001; // approx 11 meters
  
  if (lat < minLat - margin || lat > maxLat + margin || 
      lng < minLng - margin || lng > maxLng + margin) {
    return null;
  }

  // Iterate to find the closest cell center
  // Optimization: We could use binary search or index calculation, but linear search is fine for typical small geofence grids (e.g., 50m radius = ~20x20 grid = 400 cells)
  for (const row of grid) {
    for (const cell of row) {
      // Euclidean distance in degrees is sufficient for finding the closest grid neighbor locally
      const dLat = cell.lat - lat;
      const dLng = cell.lng - lng;
      const distSq = dLat*dLat + dLng*dLng;
      
      if (distSq < minDistance) {
        minDistance = distSq;
        closestCell = cell;
      }
    }
  }
  
  return closestCell;
};

/**
 * Checks if a cell is marked as inside the radius.
 * 
 * @param cell The grid cell to check
 * @returns true if the cell is inside the radius
 */
export const isInsideRadius = (cell: GridCell): boolean => {
  return cell.isInside;
};
