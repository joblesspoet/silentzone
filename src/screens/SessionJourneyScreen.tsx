import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRoute, RouteProp } from '@react-navigation/native';
import Realm from 'realm';
import { schemas, SCHEMA_VERSION } from '../database/schemas';
import TrailCanvas from '../components/TrailCanvas';
import { TrailPoint } from '../services/TrailRecorder';
import { format } from 'date-fns';

type RootStackParamList = {
  SessionJourney: { sessionId: string };
};

type SessionJourneyRouteProp = RouteProp<RootStackParamList, 'SessionJourney'>;

interface SessionStats {
  duration: string;
  totalPoints: number;
  stationaryPoints: number;
  startTime: string;
  endTime: string;
  stationaryDuration: string;
}

const SessionJourneyScreen: React.FC = () => {
  const route = useRoute<SessionJourneyRouteProp>();
  const { sessionId } = route.params;
  const [session, setSession] = useState<any>(null);
  const [points, setPoints] = useState<TrailPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<SessionStats | null>(null);

  useEffect(() => {
    let realm: Realm;

    const loadSession = async () => {
      try {
        realm = await Realm.open({
          schema: schemas,
          schemaVersion: SCHEMA_VERSION,
        });

        const sessionData = realm.objectForPrimaryKey(
          'SessionTrail',
          sessionId,
        );

        if (sessionData) {
          // Convert Realm List to JS Array to avoid access issues
          const pointsList = (sessionData as any).points.map((p: any) => ({
            latitude: p.latitude,
            longitude: p.longitude,
            heading: p.heading,
            isStationary: p.isStationary,
            stepCount: p.stepCount,
            timestamp: p.timestamp,
          }));

          setSession(sessionData);
          setPoints(pointsList);

          // Calculate stats
          const start = new Date((sessionData as any).startTime);
          const end = (sessionData as any).endTime
            ? new Date((sessionData as any).endTime)
            : new Date();
          const durationMs = end.getTime() - start.getTime();
          const durationMin = Math.floor(durationMs / 60000);
          const durationSec = Math.floor((durationMs % 60000) / 1000);

          // Calculate stationary duration
          let stationaryDurationMs = 0;
          const sortedPoints = pointsList.sort(
            (a: any, b: any) => a.timestamp.getTime() - b.timestamp.getTime(),
          );

          for (let i = 0; i < sortedPoints.length - 1; i++) {
            const current = sortedPoints[i];
            const next = sortedPoints[i + 1];
            // If current is stationary, add time until next point
            if (current.isStationary) {
              const diff =
                next.timestamp.getTime() - current.timestamp.getTime();
              // Sanity check: ignore gaps > 5 mins (app killed/backgrounded)
              if (diff < 5 * 60 * 1000) {
                stationaryDurationMs += diff;
              }
            }
          }
          const statMin = Math.floor(stationaryDurationMs / 60000);
          const statSec = Math.floor((stationaryDurationMs % 60000) / 1000);

          setStats({
            duration: `${durationMin}m ${durationSec}s`,
            totalPoints: pointsList.length,
            stationaryPoints: pointsList.filter((p: any) => p.isStationary)
              .length,
            startTime: format(start, 'HH:mm:ss'),
            endTime: (sessionData as any).endTime
              ? format(end, 'HH:mm:ss')
              : 'Ongoing',
            stationaryDuration: `${statMin}m ${statSec}s`,
          });
        }
      } catch (error) {
        console.error('Failed to load session', error);
      } finally {
        setLoading(false);
        if (realm && !realm.isClosed) {
          // realm.close(); // Keep open for now or manage lifecycle better
        }
      }
    };

    loadSession();

    return () => {
      if (realm && !realm.isClosed) {
        realm.close();
      }
    };
  }, [sessionId]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#4A90E2" />
      </View>
    );
  }

  if (!session) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Session not found</Text>
      </View>
    );
  }

  const screenWidth = Dimensions.get('window').width;
  const canvasHeight = 400;

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Session Journey</Text>

      <View style={styles.canvasContainer}>
        <TrailCanvas
          points={points}
          width={screenWidth - 32}
          height={canvasHeight}
        />
      </View>

      {stats && (
        <View style={styles.statsCard}>
          <Text style={styles.statsTitle}>Session Statistics</Text>

          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Duration:</Text>
            <Text style={styles.statValue}>{stats.duration}</Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Points Recorded:</Text>
            <Text style={styles.statValue}>{stats.totalPoints}</Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Stationary Events:</Text>
            <Text style={styles.statValue}>
              {stats.stationaryPoints} ({stats.stationaryDuration})
            </Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Time:</Text>
            <Text style={styles.statValue}>
              {stats.startTime} - {stats.endTime}
            </Text>
          </View>

          <View style={styles.statRow}>
            <Text style={styles.statLabel}>Status:</Text>
            <Text
              style={[
                styles.statValue,
                { color: (session as any).isClosed ? '#4CAF50' : '#FF9800' },
              ]}
            >
              {(session as any).isClosed ? 'Completed' : 'Active'}
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 16,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    color: '#333',
  },
  canvasContainer: {
    marginBottom: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#eee',
    overflow: 'hidden',
  },
  statsCard: {
    backgroundColor: '#f9f9f9',
    padding: 16,
    borderRadius: 12,
    marginBottom: 24,
  },
  statsTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
    color: '#444',
  },
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  statLabel: {
    fontSize: 14,
    color: '#666',
  },
  statValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#222',
  },
  errorText: {
    fontSize: 16,
    color: '#F44336',
  },
});

export default SessionJourneyScreen;
