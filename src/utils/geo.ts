export const getDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371e3; // metres
  const φ1 = (lat1 * Math.PI) / 180; // φ, λ in radians
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in metres
};

export const formatDistance = (distanceInMeters: number): string => {
  if (distanceInMeters < 20) {
    return 'Inside location';
  }
  if (distanceInMeters < 1000) {
    return `${Math.round(distanceInMeters)}m away`;
  }
  return `${(distanceInMeters / 1000).toFixed(1)} km away`;
};


/**
 * Format coordinates in human-readable format
 * Example: 38.8951° N, 77.0364° W
 */
export const formatCoordinates = (lat: number, lng: number): string => {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}° ${latDir}, ${Math.abs(lng).toFixed(4)}° ${lngDir}`;
};

/**
 * Reverse geocode using OpenStreetMap Nominatim (FREE API)
 * Rate limit: 1 request per second
 */
export const reverseGeocode = async (
  lat: number,
  lng: number
): Promise<string> => {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: {
          'User-Agent': 'SilenceZoneApp/1.0', // Required by Nominatim
        },
      }
    );

    if (!response.ok) {
      throw new Error('Geocoding failed');
    }

    const data = await response.json();

    // Build readable address from components
    const parts: string[] = [];
    
    if (data.address) {
      // Priority: road/street -> neighborhood/suburb -> city/town
      if (data.address.road) parts.push(data.address.road);
      else if (data.address.street) parts.push(data.address.street);
      
      if (data.address.suburb) parts.push(data.address.suburb);
      else if (data.address.neighbourhood) parts.push(data.address.neighbourhood);
      else if (data.address.quarter) parts.push(data.address.quarter);
      
      if (data.address.city) parts.push(data.address.city);
      else if (data.address.town) parts.push(data.address.town);
      else if (data.address.village) parts.push(data.address.village);
    }

    return parts.length > 0 ? parts.join(', ') : 'Location found';
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return ''; // Return empty string on error, will show coordinates instead
  }
};

/**
 * Debounced reverse geocode to avoid hitting rate limits
 */
let geocodeTimeout: ReturnType<typeof setTimeout> | null = null;

export const debouncedReverseGeocode = (
  lat: number,
  lng: number,
  callback: (address: string) => void,
  delay: number = 800
): void => {
  if (geocodeTimeout) {
    clearTimeout(geocodeTimeout);
  }

  geocodeTimeout = setTimeout(async () => {
    const address = await reverseGeocode(lat, lng);
    callback(address);
  }, delay);
};