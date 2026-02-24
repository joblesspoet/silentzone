
export interface Coordinate {
  lat: number;
  lng: number;
}

/**
 * Calculates a new latitude and longitude based on a starting point,
 * distance traveled (steps * stride), and bearing (heading).
 * 
 * Uses the formula for "Destination point given distance and bearing from start point"
 * on a sphere (Earth).
 * 
 * @param anchor Starting coordinate { lat, lng }
 * @param steps Number of steps taken
 * @param headingDegrees Compass heading in degrees (0-360, 0=North, 90=East)
 * @param strideLengthMeters Length of a single step in meters
 * @returns The new estimated coordinate { lat, lng }
 */
export const calculateNewPosition = (
  anchor: Coordinate,
  steps: number,
  headingDegrees: number,
  strideLengthMeters: number
): Coordinate => {
  const EARTH_RADIUS_METERS = 6371000;
  // Reduce noise: If steps are very few (like 1-2 false positives), maybe ignore or dampen?
  // But for now, trust the input.
  
  const distanceMeters = steps * strideLengthMeters;
  
  // Convert inputs to radians
  const lat1 = toRadians(anchor.lat);
  const lng1 = toRadians(anchor.lng);
  const bearing = toRadians(headingDegrees);
  
  // Angular distance in radians
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS;
  
  // Calculate new latitude
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing)
  );
  
  // Calculate new longitude
  const lng2 = lng1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
  );
  
  // Convert back to degrees
  return {
    lat: toDegrees(lat2),
    lng: toDegrees(lng2)
  };
};

/**
 * Smooths a sequence of headings to reduce jitter.
 * Simple average of angles logic (handling 359 -> 1 crossover).
 */
export const smoothHeading = (headings: number[]): number => {
  if (headings.length === 0) return 0;
  
  // Convert to vectors (sin, cos) to handle circular average
  let sumSin = 0;
  let sumCos = 0;
  
  headings.forEach(h => {
    const rad = toRadians(h);
    sumSin += Math.sin(rad);
    sumCos += Math.cos(rad);
  });
  
  const avgRad = Math.atan2(sumSin / headings.length, sumCos / headings.length);
  let avgDeg = toDegrees(avgRad);
  
  if (avgDeg < 0) avgDeg += 360;
  return avgDeg;
};

/**
 * Calculates the great-circle distance between two points on a sphere
 * given their longitudes and latitudes.
 * 
 * @param lat1 Latitude of first point
 * @param lng1 Longitude of first point
 * @param lat2 Latitude of second point
 * @param lng2 Longitude of second point
 * @returns Distance in meters
 */
export const haversineDistance = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number => {
  const EARTH_RADIUS_METERS = 6371000;
  
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
    
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return EARTH_RADIUS_METERS * c;
};

// Helper functions
const toRadians = (degrees: number): number => {
  return degrees * (Math.PI / 180);
};

const toDegrees = (radians: number): number => {
  return radians * (180 / Math.PI);
};
