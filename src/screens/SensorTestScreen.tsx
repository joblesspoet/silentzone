/**
 * SensorTestScreen — TASK-00 Verification & Step Diagnostics
 *
 * Pass criteria:
 *  ✅ Live readings confirmed from all sensors
 *  ✅ Watch mode confirms hardware reactivity (Sony Xperia Fix)
 *  ✅ Permission status clearly identified
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  PermissionsAndroid,
  Platform,
  Alert,
  NativeEventEmitter,
  NativeModules,
} from 'react-native';
import SZSensorModule, {
  StepCountResult,
  MagneticHeadingResult,
  BarometricPressureResult,
  AccelerationResult,
  SensorInfo,
  SensorType,
} from '../native/SZSensorModule';
import Realm from 'realm';
import { schemas, SCHEMA_VERSION } from '../database/schemas';
import {
  startSession,
  recordPoint,
  endSession,
  TrailPoint,
} from '../services/TrailRecorder';
import {
  calculateNewPosition,
  smoothHeading,
} from '../services/DeadReckoningService';

const sensorEventEmitter = new NativeEventEmitter(NativeModules.SZSensorModule);

// ─── Types ───────────────────────────────────────────────
type SensorStatus = 'idle' | 'reading' | 'done' | 'error' | 'unavailable';

interface SensorCardState<T> {
  status: SensorStatus;
  data: T | null;
  error: string | null;
  available: boolean | null;
  info: SensorInfo | null;
  isWatching: boolean;
}

// ─── Heading to compass direction ────────────────────────
function headingToDirection(deg: number): string {
  if (deg >= 337.5 || deg < 22.5) return '↑ North';
  if (deg < 67.5) return '↗ NE';
  if (deg < 112.5) return '→ East';
  if (deg < 157.5) return '↘ SE';
  if (deg < 202.5) return '↓ South';
  if (deg < 247.5) return '↙ SW';
  if (deg < 292.5) return '← West';
  return '↖ NW';
}

// ─── Motion label from magnitude ─────────────────────────
function motionLabel(magnitude: number): string {
  if (magnitude < 10.5) return '🧍 Stationary';
  if (magnitude < 14) return '🚶 Walking';
  return '🚗 Vehicle / Running';
}

// ─── Main Screen ─────────────────────────────────────────
export default function SensorTestScreen({ navigation }: any) {
  const [permissionStatus, setPermissionStatus] = useState<
    'granted' | 'denied' | 'checking'
  >('checking');

  const [stepState, setStepState] = useState<SensorCardState<StepCountResult>>({
    status: 'idle',
    data: null,
    error: null,
    available: null,
    info: null,
    isWatching: false,
  });
  const [detectorCount, setDetectorCount] = useState(0);
  const [detectorStatus, setDetectorStatus] = useState<SensorStatus>('idle');

  const [headingState, setHeadingState] = useState<
    SensorCardState<MagneticHeadingResult>
  >({
    status: 'idle',
    data: null,
    error: null,
    available: null,
    info: null,
    isWatching: false,
  });
  const [pressureState, setPressureState] = useState<
    SensorCardState<BarometricPressureResult>
  >({
    status: 'idle',
    data: null,
    error: null,
    available: null,
    info: null,
    isWatching: false,
  });
  const [accelState, setAccelState] = useState<
    SensorCardState<AccelerationResult>
  >({
    status: 'idle',
    data: null,
    error: null,
    available: null,
    info: null,
    isWatching: false,
  });

  // ─── Real Recording State ───────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStats, setRecordingStats] = useState({
    steps: 0,
    distance: 0,
  });
  const recordingRef = useRef<{
    realm: Realm | null;
    sessionId: string | null;
    lastStepCount: number;
    currentLat: number;
    currentLng: number;
    intervalId: any | null;
    headingBuffer: number[];
    lastStepTime: number;
    lastStationaryRecordTime: number;
  }>({
    realm: null,
    sessionId: null,
    lastStepCount: 0,
    currentLat: 24.8607,
    currentLng: 67.0011,
    intervalId: null,
    headingBuffer: [],
    lastStepTime: 0,
    lastStationaryRecordTime: 0,
  });

  const watchIntervals = useRef<Record<string, any>>({});
  const stepSubscription = useRef<any>(null);
  const stepDetectorSubscription = useRef<any>(null);

  // ─── Initial Checks ─────────────────────────────────────
  useEffect(() => {
    checkPermission();
    loadHardwareInfo();
    return () => {
      // Cleanup all watches
      Object.values(watchIntervals.current).forEach(clearInterval);
      if (stepSubscription.current) stepSubscription.current.remove();
      if (stepDetectorSubscription.current)
        stepDetectorSubscription.current.remove();
      SZSensorModule.stopStepWatching();
      SZSensorModule.stopStepDetection();
    };
  }, []);

  const checkPermission = async () => {
    const granted = await SZSensorModule.checkActivityPermission();
    setPermissionStatus(granted ? 'granted' : 'denied');
  };

  const loadHardwareInfo = async () => {
    const types: SensorType[] = [
      'step_counter',
      'step_detector',
      'magnetometer',
      'barometer',
      'accelerometer',
    ];
    for (const type of types) {
      const avail = await SZSensorModule.isSensorAvailable(type);
      if (avail) {
        const info = await SZSensorModule.getSensorInfo(type);
        if (type === 'step_counter')
          setStepState(s => ({ ...s, available: true, info }));
        if (type === 'magnetometer')
          setHeadingState(s => ({ ...s, available: true, info }));
        if (type === 'barometer')
          setPressureState(s => ({ ...s, available: true, info }));
        if (type === 'accelerometer')
          setAccelState(s => ({ ...s, available: true, info }));
      } else {
        if (type === 'step_counter')
          setStepState(s => ({ ...s, available: false }));
        if (type === 'magnetometer')
          setHeadingState(s => ({ ...s, available: false }));
        if (type === 'barometer')
          setPressureState(s => ({ ...s, available: false }));
        if (type === 'accelerometer')
          setAccelState(s => ({ ...s, available: false }));
      }
    }
  };

  const requestPermission = async () => {
    if (Platform.OS !== 'android' || Platform.Version < 29) return;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    );
    setPermissionStatus(
      result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied',
    );
  };

  // ─── Sensor Actions ─────────────────────────────────────

  const toggleWatch = async (sensor: string, action: () => Promise<void>) => {
    if (sensor === 'step') {
      if (stepState.isWatching) {
        if (stepSubscription.current) stepSubscription.current.remove();
        await SZSensorModule.stopStepWatching();
        setStepState(s => ({ ...s, isWatching: false, status: 'idle' }));
      } else {
        setStepState(s => ({ ...s, isWatching: true, status: 'reading' }));
        stepSubscription.current = sensorEventEmitter.addListener(
          'onStepUpdate',
          data => {
            setStepState(s => ({ ...s, data, status: 'done', error: null }));
          },
        );
        await SZSensorModule.startStepWatching();
      }
      return;
    }

    if (watchIntervals.current[sensor]) {
      clearInterval(watchIntervals.current[sensor]);
      delete watchIntervals.current[sensor];
      if (sensor === 'heading')
        setHeadingState(s => ({ ...s, isWatching: false, status: 'idle' }));
      if (sensor === 'pressure')
        setPressureState(s => ({ ...s, isWatching: false, status: 'idle' }));
      if (sensor === 'accel')
        setAccelState(s => ({ ...s, isWatching: false, status: 'idle' }));
    } else {
      action(); // Run once immediately
      watchIntervals.current[sensor] = setInterval(action, 2000);
      if (sensor === 'heading')
        setHeadingState(s => ({ ...s, isWatching: true, status: 'reading' }));
      if (sensor === 'pressure')
        setPressureState(s => ({ ...s, isWatching: true, status: 'reading' }));
      if (sensor === 'accel')
        setAccelState(s => ({ ...s, isWatching: true, status: 'reading' }));
    }
  };

  const readStepCount = async () => {
    try {
      const data = await SZSensorModule.getStepCount();
      setStepState(s => ({ ...s, data, status: 'done', error: null }));
    } catch (e: any) {
      setStepState(s => ({ ...s, status: 'error', error: e.message }));
    }
  };

  const readStepDetector = async () => {
    setDetectorStatus('reading');
    try {
      await SZSensorModule.getStepDetector();
      setDetectorCount(c => c + 1);
      setDetectorStatus('done');
    } catch (e: any) {
      setDetectorStatus('error');
    }
  };

  const readHeading = async () => {
    try {
      const data = await SZSensorModule.getMagneticHeading();
      setHeadingState(s => ({ ...s, data, status: 'done', error: null }));
    } catch (e: any) {
      setHeadingState(s => ({ ...s, status: 'error', error: e.message }));
    }
  };

  const readPressure = async () => {
    try {
      const data = await SZSensorModule.getBarometricPressure();
      setPressureState(s => ({ ...s, data, status: 'done', error: null }));
    } catch (e: any) {
      setPressureState(s => ({ ...s, status: 'error', error: e.message }));
    }
  };

  const readAccel = async () => {
    try {
      const data = await SZSensorModule.getAcceleration();
      setAccelState(s => ({ ...s, data, status: 'done', error: null }));
    } catch (e: any) {
      setAccelState(s => ({ ...s, status: 'error', error: e.message }));
    }
  };

  // ─── Real Recording ─────────────────────────────────────
  const toggleRecording = async () => {
    if (isRecording) {
      // Stop Recording
      if (recordingRef.current.intervalId)
        clearInterval(recordingRef.current.intervalId);

      if (stepDetectorSubscription.current) {
        stepDetectorSubscription.current.remove();
        stepDetectorSubscription.current = null;
      }
      await SZSensorModule.stopStepDetection();

      const { realm, sessionId } = recordingRef.current;
      if (realm && sessionId) {
        await endSession(realm, sessionId, 'user_stopped');
        realm.close();

        setIsRecording(false);
        navigation.navigate('SessionJourney', { sessionId });
      }
    } else {
      // Start Recording
      try {
        const realm = await Realm.open({
          schema: schemas,
          schemaVersion: SCHEMA_VERSION,
        });
        const anchorLat = 24.8607;
        const anchorLng = 67.0011;
        const sessionId = await startSession(
          realm,
          'real-walk-test',
          anchorLat,
          anchorLng,
        );

        // Reset state
        recordingRef.current = {
          realm,
          sessionId,
          lastStepCount: 0,
          currentLat: anchorLat,
          currentLng: anchorLng,
          intervalId: null,
          headingBuffer: [],
          lastStepTime: Date.now(),
          lastStationaryRecordTime: 0,
        };

        // Ensure sensors are watching
        if (!headingState.isWatching) {
          toggleWatch('heading', readHeading);
        }

        // Start Step Detector (Event-Driven Dead Reckoning)
        await SZSensorModule.startStepDetection();
        stepDetectorSubscription.current = sensorEventEmitter.addListener(
          'onStepDetected',
          async event => {
            const { realm, sessionId, currentLat, currentLng } =
              recordingRef.current;
            if (!realm || !sessionId) return;

            // 1. Get Smoothed Heading
            const smoothedHeading = smoothHeading(
              recordingRef.current.headingBuffer,
            );

            // 2. Calculate New Position (1 step = ~0.76m)
            const newPos = calculateNewPosition(
              { lat: currentLat, lng: currentLng },
              1, // 1 step
              smoothedHeading,
              0.76,
            );

            // 3. Record Moving Point
            const point: TrailPoint = {
              latitude: newPos.lat,
              longitude: newPos.lng,
              heading: smoothedHeading,
              isStationary: false,
              stepCount: 1,
              timestamp: Date.now(),
            };

            await recordPoint(realm, sessionId, point);

            // 4. Update Ref
            recordingRef.current.currentLat = newPos.lat;
            recordingRef.current.currentLng = newPos.lng;
            recordingRef.current.lastStepTime = Date.now();
            recordingRef.current.lastStepCount += 1; // Track total steps

            // 5. Update UI
            setRecordingStats(prev => ({
              steps: prev.steps + 1,
              distance: prev.distance + 0.76,
            }));
          },
        );

        // Start Polling Loop (Heading Buffer + Stationary Check)
        const intervalId = setInterval(async () => {
          const {
            realm,
            sessionId,
            lastStepTime,
            currentLat,
            currentLng,
            lastStationaryRecordTime,
          } = recordingRef.current;
          if (!realm || !sessionId) return;

          try {
            // 1. Poll Heading (keep buffer fresh for next step)
            const headingRes = await SZSensorModule.getMagneticHeading();
            recordingRef.current.headingBuffer.push(headingRes.heading);
            if (recordingRef.current.headingBuffer.length > 5) {
              recordingRef.current.headingBuffer.shift();
            }

            // 2. Check Stationary Status
            const now = Date.now();
            const timeSinceLastStep = now - lastStepTime;

            if (timeSinceLastStep > 2000) {
              // User hasn't stepped for >2s -> Stationary
              if (now - lastStationaryRecordTime > 5000) {
                const smoothedHeading = smoothHeading(
                  recordingRef.current.headingBuffer,
                );

                const point: TrailPoint = {
                  latitude: currentLat, // Same position
                  longitude: currentLng,
                  heading: smoothedHeading,
                  isStationary: true,
                  stepCount: 0,
                  timestamp: now,
                };

                await recordPoint(realm, sessionId, point);
                recordingRef.current.lastStationaryRecordTime = now;
              }
            }
          } catch (e) {
            console.warn('Recording loop error:', e);
          }
        }, 200); // Poll faster (200ms) for smoother heading

        recordingRef.current.intervalId = intervalId;
        setIsRecording(true);
        setRecordingStats({ steps: 0, distance: 0 });
      } catch (e) {
        Alert.alert('Failed to start recording', String(e));
      }
    }
  };

  // ─── Journey Simulation ─────────────────────────────────
  const simulateJourney = async () => {
    const realm = await Realm.open({
      schema: schemas,
      schemaVersion: SCHEMA_VERSION,
    });

    try {
      const anchorLat = 24.8607;
      const anchorLng = 67.0011;

      // Start Session
      const sessionId = await startSession(
        realm,
        'test-place-id',
        anchorLat,
        anchorLng,
      );

      // Generate some points walking East
      for (let i = 0; i < 20; i++) {
        const point: TrailPoint = {
          latitude: anchorLat,
          longitude: anchorLng + i * 0.0001, // moving east
          heading: 90,
          isStationary: false,
          stepCount: i * 2,
          timestamp: Date.now() + i * 1000,
        };
        await recordPoint(realm, sessionId, point);
      }

      // Generate stationary cluster
      for (let i = 0; i < 5; i++) {
        const point: TrailPoint = {
          latitude: anchorLat,
          longitude: anchorLng + 0.002,
          heading: 90,
          isStationary: true,
          stepCount: 40,
          timestamp: Date.now() + 20000 + i * 1000,
        };
        await recordPoint(realm, sessionId, point);
      }

      await endSession(realm, sessionId, 'simulation_complete');

      Alert.alert(
        'Simulation Complete',
        'Dummy session created. View it now?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'View Journey',
            onPress: () => navigation.navigate('SessionJourney', { sessionId }),
          },
        ],
      );
    } catch (error) {
      console.error(error);
      Alert.alert('Simulation Failed', String(error));
    }
  };

  // ─── Render ─────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.header}>Hardware Diagnostics</Text>

        {/* Real Recording Control */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Real Journey Test</Text>
          <Text style={styles.textSmall}>
            Walk around your room to test dead reckoning.
          </Text>

          {isRecording && (
            <View style={{ marginVertical: 10, alignItems: 'center' }}>
              <Text style={{ fontSize: 24, fontWeight: 'bold' }}>
                {recordingStats.steps} steps
              </Text>
              <Text style={{ fontSize: 16, color: '#666' }}>
                {recordingStats.distance.toFixed(1)} meters
              </Text>
              <Text style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                Status: Recording...
              </Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.btn,
              isRecording
                ? { backgroundColor: '#FF4444' }
                : { backgroundColor: '#4CAF50' },
            ]}
            onPress={toggleRecording}
          >
            <Text style={styles.btnText}>
              {isRecording ? 'Stop & View Journey' : 'Start Real Recording'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.permRow}>
          <Text style={styles.permLabel}>Activity Permission:</Text>
          <View
            style={[
              styles.badge,
              permissionStatus === 'granted'
                ? styles.badgeSuccess
                : styles.badgeError,
            ]}
          >
            <Text style={styles.badgeText}>
              {permissionStatus.toUpperCase()}
            </Text>
          </View>
        </View>

        {permissionStatus !== 'granted' && (
          <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
            <Text style={styles.permBtnText}>Request Permission</Text>
          </TouchableOpacity>
        )}

        <SensorCard
          icon="👟"
          title="Step Counter"
          status={stepState.status}
          available={stepState.available}
          info={stepState.info}
          isWatching={stepState.isWatching}
          onRead={readStepCount}
          onWatch={() => toggleWatch('step', readStepCount)}
        >
          <DataRow
            label="Cumulative Steps"
            value={stepState.data?.steps.toFixed(0) || '0'}
            highlight={stepState.data?.steps !== 0}
          />
          {stepState.error && <ErrorText message={stepState.error} />}

          <View style={styles.detectorRow}>
            <View>
              <Text style={styles.detectorTitle}>
                Step Detector (Real-time)
              </Text>
              <Text style={styles.detectorSub}>
                Increments on every detected step event
              </Text>
            </View>
            <TouchableOpacity
              style={styles.detectorBtn}
              onPress={readStepDetector}
              disabled={detectorStatus === 'reading'}
            >
              {detectorStatus === 'reading' ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.detectorCount}>{detectorCount}</Text>
              )}
            </TouchableOpacity>
          </View>
        </SensorCard>

        <SensorCard
          icon="🧭"
          title="Magnetometer"
          status={headingState.status}
          available={headingState.available}
          info={headingState.info}
          isWatching={headingState.isWatching}
          onRead={readHeading}
          onWatch={() => toggleWatch('heading', readHeading)}
        >
          {headingState.data && (
            <>
              <DataRow
                label="Heading"
                value={`${headingState.data.heading.toFixed(
                  1,
                )}° ${headingToDirection(headingState.data.heading)}`}
                highlight
              />
              <DataRow
                label="Raw (µT)"
                value={`X:${headingState.data.x.toFixed(
                  1,
                )} Y:${headingState.data.y.toFixed(1)}`}
              />
            </>
          )}
        </SensorCard>

        <SensorCard
          icon="🌡️"
          title="Barometer"
          status={pressureState.status}
          available={pressureState.available}
          info={pressureState.info}
          isWatching={pressureState.isWatching}
          onRead={readPressure}
          onWatch={() => toggleWatch('pressure', readPressure)}
        >
          {pressureState.data && (
            <>
              <DataRow
                label="Pressure"
                value={`${pressureState.data.pressureHPa.toFixed(2)} hPa`}
                highlight
              />
              <DataRow
                label="Altitude"
                value={`${pressureState.data.altitudeM.toFixed(1)} m`}
              />
            </>
          )}
        </SensorCard>

        <SensorCard
          icon="📱"
          title="Accelerometer"
          status={accelState.status}
          available={accelState.available}
          info={accelState.info}
          isWatching={accelState.isWatching}
          onRead={readAccel}
          onWatch={() => toggleWatch('accel', readAccel)}
        >
          {accelState.data && (
            <>
              <DataRow
                label="Active Motion"
                value={motionLabel(accelState.data.magnitude)}
                highlight={accelState.data.magnitude > 10.5}
              />
              <DataRow
                label="Magnitude"
                value={`${accelState.data.magnitude.toFixed(2)} m/s²`}
              />
            </>
          )}
        </SensorCard>

        <TouchableOpacity style={styles.simBtn} onPress={simulateJourney}>
          <Text style={styles.simBtnText}>🧪 Simulate & View Journey</Text>
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerTitle}>Sony Xperia Debugging Guide</Text>
          <Text style={styles.footerText}>
            1. Ensure Permission is "GRANTED"
          </Text>
          <Text style={styles.footerText}>
            2. Toggle "WATCH" on Step Counter
          </Text>
          <Text style={styles.footerText}>
            3. Walk while watching "Cumulative Steps"
          </Text>
          <Text style={styles.footerText}>
            4. If 0 stays 0, check Detector Count
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Components ──────────────────────────────────────────

function SensorCard({
  icon,
  title,
  status,
  available,
  info,
  isWatching,
  onRead,
  onWatch,
  children,
}: any) {
  if (available === false)
    return (
      <View style={[styles.card, styles.cardDisabled]}>
        <Text style={styles.cardTitle}>
          {icon} {title}
        </Text>
        <Text style={styles.unavailableText}>Hardware not detected</Text>
      </View>
    );

  return (
    <View style={[styles.card, isWatching && styles.cardWatching]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>
            {icon} {title}
          </Text>
          {info && (
            <Text style={styles.hwInfo}>
              {info.name} ({info.vendor})
            </Text>
          )}
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity onPress={onRead} style={styles.actionBtn}>
            <Text style={styles.actionBtnText}>READ</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onWatch}
            style={[
              styles.actionBtn,
              isWatching ? styles.watchActive : styles.watchInactive,
            ]}
          >
            <Text
              style={[styles.actionBtnText, isWatching && { color: '#fff' }]}
            >
              {isWatching ? 'STOP' : 'WATCH'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
      {status === 'reading' && !isWatching && (
        <ActivityIndicator style={{ marginTop: 10 }} />
      )}
      {status === 'error' && (
        <Text style={styles.error}>Error reading sensor</Text>
      )}
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function DataRow({ label, value, highlight }: any) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={[styles.dataValue, highlight && styles.highlight]}>
        {value}
      </Text>
    </View>
  );
}

function ErrorText({ message }: any) {
  return <Text style={styles.errorDetail}>{message}</Text>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f2f2f7' },
  scroll: { padding: 16 },
  header: { fontSize: 28, fontWeight: 'bold', marginBottom: 20, color: '#000' },
  permRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  permLabel: { fontSize: 16, marginRight: 10 },
  badge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  badgeSuccess: { backgroundColor: '#4cd964' },
  badgeError: { backgroundColor: '#ff3b30' },
  badgeText: { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  permBtn: {
    backgroundColor: '#007aff',
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 20,
  },
  permBtnText: { color: '#fff', fontWeight: '600' },

  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardDisabled: { opacity: 0.6, backgroundColor: '#f9f9f9' },
  cardWatching: { borderColor: '#34c759', borderWidth: 2 },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardTitle: { fontSize: 18, fontWeight: '600', color: '#000' },
  hwInfo: { fontSize: 10, color: '#8e8e93', marginTop: 2 },
  unavailableText: { color: '#ff3b30', marginTop: 4, fontStyle: 'italic' },

  cardActions: { flexDirection: 'row' },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#e5e5ea',
    marginLeft: 8,
  },
  watchInactive: { backgroundColor: '#e5e5ea' },
  watchActive: { backgroundColor: '#34c759' },
  actionBtnText: { fontSize: 12, fontWeight: '600', color: '#000' },

  cardBody: { marginTop: 8 },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  dataLabel: { color: '#8e8e93' },
  dataValue: { fontWeight: '500', color: '#000' },
  highlight: { color: '#007aff', fontWeight: 'bold' },
  error: { color: '#ff3b30', marginBottom: 8 },
  errorDetail: { color: '#ff3b30', fontSize: 12, marginTop: 4 },

  detectorRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detectorTitle: { fontSize: 14, fontWeight: '600' },
  detectorSub: { fontSize: 10, color: '#8e8e93' },
  detectorBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#5856d6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  detectorCount: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  simBtn: {
    backgroundColor: '#FF9800',
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 20,
  },
  simBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },

  footer: {
    marginTop: 20,
    padding: 16,
    backgroundColor: '#e5e5ea',
    borderRadius: 8,
  },
  footerTitle: { fontWeight: 'bold', marginBottom: 8 },
  footerText: { fontSize: 12, color: '#333', marginBottom: 4 },

  // New styles for Real Recording
  textSmall: { fontSize: 14, color: '#666', marginBottom: 12 },
  btn: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 10,
  },
  btnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});
