
import { startSession, recordPoint, endSession, TrailPoint } from '../TrailRecorder';
import { RealmWriteHelper } from '../../database/helpers/RealmWriteHelper';
import Realm from 'realm';

// Mock Realm
const mockRealm = {
  create: jest.fn(),
  objectForPrimaryKey: jest.fn(),
  write: jest.fn((callback) => callback()),
} as unknown as Realm;

// Mock RealmWriteHelper
jest.mock('../../database/helpers/RealmWriteHelper', () => ({
  RealmWriteHelper: {
    safeWrite: jest.fn(async (realm, callback) => callback()),
  },
}));

describe('TrailRecorder', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockRealm.create as jest.Mock).mockReturnValue({ points: [] });
    (mockRealm.objectForPrimaryKey as jest.Mock).mockReturnValue({ points: [] });
  });

  it('should start a session', async () => {
    const sessionId = await startSession(mockRealm, 'place-123', 10, 20);
    
    expect(sessionId).toBeDefined();
    expect(mockRealm.create).toHaveBeenCalledWith('SessionTrail', expect.objectContaining({
      placeId: 'place-123',
      anchorLatitude: 10,
      anchorLongitude: 20,
      isClosed: false,
    }));
  });

  it('should buffer points and flush when batch size reached', async () => {
    const sessionId = await startSession(mockRealm, 'place-123', 10, 20);
    const point: TrailPoint = {
      latitude: 10.0001,
      longitude: 20.0001,
      heading: 90,
      isStationary: false,
      stepCount: 10,
      timestamp: Date.now(),
    };

    // Add 9 points (buffer size is 10)
    for (let i = 0; i < 9; i++) {
      await recordPoint(mockRealm, sessionId, point);
    }
    // Should not have flushed yet (create called only once for startSession)
    expect(mockRealm.objectForPrimaryKey).not.toHaveBeenCalled();

    // Add 10th point
    await recordPoint(mockRealm, sessionId, point);
    
    // Should flush now
    expect(mockRealm.objectForPrimaryKey).toHaveBeenCalledWith('SessionTrail', sessionId);
  });

  it('should flush remaining points on endSession', async () => {
    const sessionId = await startSession(mockRealm, 'place-123', 10, 20);
    const point: TrailPoint = {
      latitude: 10, longitude: 20, heading: 0, isStationary: true, stepCount: 0, timestamp: Date.now()
    };

    await recordPoint(mockRealm, sessionId, point);
    
    // End session
    await endSession(mockRealm, sessionId, 'manual');

    // Should flush buffer then close session
    expect(mockRealm.objectForPrimaryKey).toHaveBeenCalledTimes(2); // 1 for flush, 1 for close
  });
});
