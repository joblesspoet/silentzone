import { generateUUID } from '../utils/uuid';
import { RealmWriteHelper } from '../database/helpers/RealmWriteHelper';
import Realm from 'realm';

// In-memory buffer to batch writes
const BATCH_SIZE = 10;
let pointBuffer: any[] = [];
let currentSessionId: string | null = null;

export interface TrailPoint {
  latitude: number;
  longitude: number;
  heading: number;
  isStationary: boolean;
  stepCount: number;
  timestamp: number;
  altitude?: number;
  pressure?: number;
}

// Clustering state
let stationaryStartTime: number | null = null;
let lastMovingPoint: TrailPoint | null = null;
const STATIONARY_THRESHOLD_MS = 120000; // 2 minutes

/**
 * Starts a new recording session for a specific place visit.
 */
export const startSession = async (
  realm: Realm,
  placeId: string,
  anchorLat: number,
  anchorLng: number,
): Promise<string> => {
  const sessionId = generateUUID();
  currentSessionId = sessionId;
  pointBuffer = []; // Clear buffer
  stationaryStartTime = null;
  lastMovingPoint = null;

  // Create the session record
  await RealmWriteHelper.safeWrite(
    realm,
    () => {
      realm.create('SessionTrail', {
        id: sessionId,
        placeId: placeId,
        startTime: new Date(),
        anchorLatitude: anchorLat,
        anchorLongitude: anchorLng,
        points: [],
        isClosed: false,
      });
    },
    'startSession',
  );

  console.log(`[TrailRecorder] Started session: ${sessionId}`);
  return sessionId;
};

/**
 * Records a single movement point.
 * Buffers points in memory and flushes to Realm in batches to reduce I/O.
 */
export const recordPoint = async (
  realm: Realm,
  sessionId: string,
  point: TrailPoint,
) => {
  if (sessionId !== currentSessionId) {
    console.warn('[TrailRecorder] Ignored point for non-active session');
    return;
  }

  // Clustering Logic:
  // If user is stationary, don't record every single point (which creates a messy pile).
  // Instead, detect "start" of stationary phase.

  if (point.isStationary) {
    if (!stationaryStartTime) {
      stationaryStartTime = point.timestamp;
    }

    // Check if we've been stationary long enough to mark a cluster?
    // For now, we just don't record repetitive stationary points to save space/noise,
    // OR we update the last point to say "stationary until X".
    // Simple approach: Only record one point every 30 seconds if stationary.

    const timeSinceStart = point.timestamp - stationaryStartTime;
    if (timeSinceStart > STATIONARY_THRESHOLD_MS) {
      // We are in a deep stationary cluster (e.g. praying)
      // Ensure we have at least one point representing this.
    }

    // Optimization: Skip recording if stationary and we just recorded one recently?
    // Let's implement a simple filter:
    // If stationary, only record if > 10 seconds since last recorded point?
    // BUT user wants to see "stationary like cluster".
    // So we should record them, but maybe the UI handles the clustering visual?
    // "save these details on session and then plot the exact movmenets where user was sattionary like cluster"

    // If the user is stationary, the Dead Reckoning won't move the lat/lng much (step count 0).
    // So the points will naturally pile up at the same coordinate.
    // If we simply record them, the UI will draw a lot of dots/lines at one spot.

    // Let's just pass it through for now, relying on DeadReckoningService to NOT change lat/lng if steps=0.
  } else {
    stationaryStartTime = null; // Reset if moving
    lastMovingPoint = point;
  }

  pointBuffer.push({
    ...point,
    timestamp: new Date(point.timestamp), // Ensure Date object for Realm
  });

  if (pointBuffer.length >= BATCH_SIZE) {
    await flushBuffer(realm, sessionId);
  }
};

/**
 * Flushes buffered points to Realm.
 */
const flushBuffer = async (realm: Realm, sessionId: string) => {
  if (pointBuffer.length === 0) return;

  const pointsToWrite = [...pointBuffer];
  pointBuffer = []; // Clear immediately

  await RealmWriteHelper.safeWrite(
    realm,
    () => {
      const session = realm.objectForPrimaryKey('SessionTrail', sessionId);
      if (session) {
        pointsToWrite.forEach(p => {
          // We assume a 'TrailPoint' schema exists or we embed it
          // For performance, maybe we store as a big JSON string or list of objects?
          // Schema definition says "points recorded".
          // Let's assume a 'TrailPoint' object schema.
          (session as any).points.push(p);
        });
      }
    },
    'flushBuffer',
  );
};

/**
 * Ends the session and flushes any remaining points.
 */
export const endSession = async (
  realm: Realm,
  sessionId: string,
  checkoutReason: string = 'unknown',
) => {
  if (sessionId !== currentSessionId) {
    console.warn('[TrailRecorder] Ending non-active session?');
  }

  await flushBuffer(realm, sessionId);

  await RealmWriteHelper.safeWrite(
    realm,
    () => {
      const session = realm.objectForPrimaryKey('SessionTrail', sessionId);
      if (session) {
        (session as any).endTime = new Date();
        (session as any).isClosed = true;
        (session as any).checkoutReason = checkoutReason;
      }
    },
    'endSession',
  );

  currentSessionId = null;
  console.log(`[TrailRecorder] Ended session: ${sessionId}`);
};
