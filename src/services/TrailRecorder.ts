
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
}

/**
 * Starts a new recording session for a specific place visit.
 */
export const startSession = async (
  realm: Realm, 
  placeId: string, 
  anchorLat: number, 
  anchorLng: number
): Promise<string> => {
  const sessionId = generateUUID();
  currentSessionId = sessionId;
  pointBuffer = []; // Clear buffer

  // Create the session record
  await RealmWriteHelper.safeWrite(realm, () => {
    realm.create('SessionTrail', {
      id: sessionId,
      placeId: placeId,
      startTime: new Date(),
      anchorLatitude: anchorLat,
      anchorLongitude: anchorLng,
      points: [],
      isClosed: false
    });
  }, 'startSession');

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
  point: TrailPoint
) => {
  if (sessionId !== currentSessionId) {
    console.warn('[TrailRecorder] Ignored point for non-active session');
    return;
  }

  pointBuffer.push({
    ...point,
    timestamp: new Date(point.timestamp) // Ensure Date object for Realm
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

  await RealmWriteHelper.safeWrite(realm, () => {
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
  }, 'flushBuffer');
};

/**
 * Ends the session and flushes any remaining points.
 */
export const endSession = async (
  realm: Realm,
  sessionId: string,
  checkoutReason: string = 'unknown'
) => {
  if (sessionId !== currentSessionId) {
     console.warn('[TrailRecorder] Ending non-active session?');
  }

  await flushBuffer(realm, sessionId);
  
  await RealmWriteHelper.safeWrite(realm, () => {
    const session = realm.objectForPrimaryKey('SessionTrail', sessionId);
    if (session) {
      (session as any).endTime = new Date();
      (session as any).isClosed = true;
      (session as any).checkoutReason = checkoutReason;
    }
  }, 'endSession');

  currentSessionId = null;
  console.log(`[TrailRecorder] Ended session: ${sessionId}`);
};
