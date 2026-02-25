/**
 * Shared App Configuration
 */
export const CONFIG = {
  // Global Features
  LOGGING_ENABLED: true,

  // Debouncing
  DEBOUNCE_TIME: 8000, // 8 seconds

  // Accuracy thresholds
  MIN_ACCURACY_THRESHOLD: 50, // Good for small radius (30m+)
  ACTIVE_MIN_ACCURACY: 80, // For already active places
  MAX_ACCEPTABLE_ACCURACY: 2000, // Loosened from 200m to allow initial network fix (indoors)

  // GPS settings
  GPS_TIMEOUT: 30000, // 30 seconds
  GPS_MAXIMUM_AGE: 30000, // 30 seconds (was 5s) - allow slightly older cached locations
  GPS_WATCHDOG_THRESHOLD: 2 * 60 * 1000, // 2 minutes - force restart if no updates during monitoring

  // Check intervals - ADAPTIVE
  INTERVALS: {
    SCHEDULE_ACTIVE: 10000, // 10 seconds - during scheduled time
    SCHEDULE_APPROACHING: 20000, // 20 seconds - before scheduled time

    // Distance-based (for always-active places)
    VERY_CLOSE: 15000, // 15 seconds - within 100m
    CLOSE: 45000, // 45 seconds - within 500m
    NEAR: 3 * 60 * 1000, // 3 minutes - within 2km
    FAR: 5 * 60 * 1000, // 5 minutes - beyond 2km

    // Deep sleep (no active or upcoming schedules)
    DEEP_SLEEP: 30 * 60 * 1000, // 30 minutes max
  },

  // Distance thresholds
  DISTANCE: {
    VERY_CLOSE: 100, // meters
    CLOSE: 500, // meters
    NEAR: 2000, // meters
  },

  // Schedule settings
  SCHEDULE: {
    PRE_ACTIVATION_MINUTES: 15, // Start monitoring 15 min before schedule (GPS warm-up)
    POST_GRACE_MINUTES: 0, // Strict end time (was 5)
    SMALL_RADIUS_THRESHOLD: 60, // Consider "small" if under this
  },

  // Geofence settings
  GEOFENCE_RADIUS_BUFFER: 15, // meters to add
  MIN_GEOFENCE_RADIUS: 25, // minimum radius
  EXIT_BUFFER_MULTIPLIER: 1.08, // 8% buffer for exit (reduced from 1.15 for better responsiveness)
  EXIT_HYSTERESIS_METERS: 20, // Extra buffer specifically for effective distance calculation

  // Notification channels
  CHANNELS: {
    SERVICE: 'location-tracking-service',
    ALERTS: 'location-alerts',
    TRIGGERS: 'location-triggers',
  },
};
