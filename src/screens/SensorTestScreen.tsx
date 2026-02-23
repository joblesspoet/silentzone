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
  const [permissionStatus, setPermissionStatus] = useState<'granted' | 'denied' | 'checking'>('checking');
  
  const [stepState, setStepState] = useState<SensorCardState<StepCountResult>>({
    status: 'idle', data: null, error: null, available: null, info: null, isWatching: false
  });
  const [detectorCount, setDetectorCount] = useState(0);
  const [detectorStatus, setDetectorStatus] = useState<SensorStatus>('idle');
  
  const [headingState, setHeadingState] = useState<SensorCardState<MagneticHeadingResult>>({
    status: 'idle', data: null, error: null, available: null, info: null, isWatching: false
  });
  const [pressureState, setPressureState] = useState<SensorCardState<BarometricPressureResult>>({
    status: 'idle', data: null, error: null, available: null, info: null, isWatching: false
  });
  const [accelState, setAccelState] = useState<SensorCardState<AccelerationResult>>({
    status: 'idle', data: null, error: null, available: null, info: null, isWatching: false
  });

  const watchIntervals = useRef<Record<string, any>>({});
  const stepSubscription = useRef<any>(null);

  // ─── Initial Checks ─────────────────────────────────────
  useEffect(() => {
    checkPermission();
    loadHardwareInfo();
    return () => {
      // Cleanup all watches
      Object.values(watchIntervals.current).forEach(clearInterval);
      if (stepSubscription.current) stepSubscription.current.remove();
      SZSensorModule.stopStepWatching();
    };
  }, []);

  const checkPermission = async () => {
    const granted = await SZSensorModule.checkActivityPermission();
    setPermissionStatus(granted ? 'granted' : 'denied');
  };

  const loadHardwareInfo = async () => {
    const types: SensorType[] = ['step_counter', 'step_detector', 'magnetometer', 'barometer', 'accelerometer'];
    for (const type of types) {
      const avail = await SZSensorModule.isSensorAvailable(type);
      if (avail) {
        const info = await SZSensorModule.getSensorInfo(type);
        if (type === 'step_counter') setStepState(s => ({ ...s, available: true, info }));
        if (type === 'magnetometer') setHeadingState(s => ({ ...s, available: true, info }));
        if (type === 'barometer') setPressureState(s => ({ ...s, available: true, info }));
        if (type === 'accelerometer') setAccelState(s => ({ ...s, available: true, info }));
      } else {
        if (type === 'step_counter') setStepState(s => ({ ...s, available: false }));
        if (type === 'magnetometer') setHeadingState(s => ({ ...s, available: false }));
        if (type === 'barometer') setPressureState(s => ({ ...s, available: false }));
        if (type === 'accelerometer') setAccelState(s => ({ ...s, available: false }));
      }
    }
  };

  const requestPermission = async () => {
    if (Platform.OS !== 'android' || Platform.Version < 29) return;
    const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    );
    setPermissionStatus(result === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied');
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
        stepSubscription.current = sensorEventEmitter.addListener('onStepUpdate', (data) => {
          setStepState(s => ({ ...s, data, status: 'done', error: null }));
        });
        await SZSensorModule.startStepWatching();
      }
      return;
    }

    if (watchIntervals.current[sensor]) {
      clearInterval(watchIntervals.current[sensor]);
      delete watchIntervals.current[sensor];
      if (sensor === 'heading') setHeadingState(s => ({ ...s, isWatching: false, status: 'idle' }));
      if (sensor === 'pressure') setPressureState(s => ({ ...s, isWatching: false, status: 'idle' }));
      if (sensor === 'accel') setAccelState(s => ({ ...s, isWatching: false, status: 'idle' }));
    } else {
      action(); // Run once immediately
      watchIntervals.current[sensor] = setInterval(action, 2000);
      if (sensor === 'heading') setHeadingState(s => ({ ...s, isWatching: true, status: 'reading' }));
      if (sensor === 'pressure') setPressureState(s => ({ ...s, isWatching: true, status: 'reading' }));
      if (sensor === 'accel') setAccelState(s => ({ ...s, isWatching: true, status: 'reading' }));
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

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.appBar}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.appBarTitle}>SFPE Sensor Lab</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Permission Center */}
        <View style={styles.permCard}>
          <View style={styles.permHeader}>
            <Text style={styles.permTitle}>Physical Activity Permission</Text>
            <View style={[styles.badge, permissionStatus === 'granted' ? styles.badgeSuccess : styles.badgeError]}>
              <Text style={styles.badgeText}>{permissionStatus.toUpperCase()}</Text>
            </View>
          </View>
          <Text style={styles.permSub}>Required for Step Counter on Android 10+</Text>
          {permissionStatus !== 'granted' && (
            <TouchableOpacity style={styles.permBtn} onPress={requestPermission}>
              <Text style={styles.permBtnText}>Grant Permission</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Step Diagnostics */}
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
          <DataRow label="Cumulative Steps" value={stepState.data?.steps.toFixed(0) || '0'} highlight={stepState.data?.steps !== 0} />
          {stepState.error && <ErrorText message={stepState.error} />}
          
          <View style={styles.detectorRow}>
            <View>
              <Text style={styles.detectorTitle}>Step Detector (Real-time)</Text>
              <Text style={styles.detectorSub}>Increments on every detected step event</Text>
            </View>
            <TouchableOpacity style={styles.detectorBtn} onPress={readStepDetector} disabled={detectorStatus === 'reading'}>
              {detectorStatus === 'reading' ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.detectorCount}>{detectorCount}</Text>}
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
              <DataRow label="Heading" value={`${headingState.data.heading.toFixed(1)}° ${headingToDirection(headingState.data.heading)}`} highlight />
              <DataRow label="Raw (µT)" value={`X:${headingState.data.x.toFixed(1)} Y:${headingState.data.y.toFixed(1)}`} />
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
              <DataRow label="Pressure" value={`${pressureState.data.pressureHPa.toFixed(2)} hPa`} highlight />
              <DataRow label="Altitude" value={`${pressureState.data.altitudeM.toFixed(1)} m`} />
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
              <DataRow label="Active Motion" value={motionLabel(accelState.data.magnitude)} highlight={accelState.data.magnitude > 10.5} />
              <DataRow label="Magnitude" value={`${accelState.data.magnitude.toFixed(2)} m/s²`} />
            </>
          )}
        </SensorCard>

        <View style={styles.footer}>
          <Text style={styles.footerTitle}>Sony Xperia Debugging Guide</Text>
          <Text style={styles.footerText}>1. Ensure Permission is "GRANTED"</Text>
          <Text style={styles.footerText}>2. Toggle "WATCH" on Step Counter</Text>
          <Text style={styles.footerText}>3. Walk while watching "Cumulative Steps"</Text>
          <Text style={styles.footerText}>4. If 0 stays 0, check Detector Count</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Components ──────────────────────────────────────────

function SensorCard({ icon, title, status, available, info, isWatching, onRead, onWatch, children }: any) {
  if (available === false) return (
    <View style={[styles.card, styles.cardDisabled]}>
      <Text style={styles.cardTitle}>{icon} {title}</Text>
      <Text style={styles.unavailableText}>Hardware not detected</Text>
    </View>
  );

  return (
    <View style={[styles.card, isWatching && styles.cardWatching]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{icon} {title}</Text>
          {info && <Text style={styles.hwInfo}>{info.name} ({info.vendor})</Text>}
        </View>
        <View style={styles.cardActions}>
          <TouchableOpacity style={[styles.actionBtn, styles.watchBtn, isWatching && styles.watchBtnActive]} onPress={onWatch}>
            <Text style={styles.actionBtnText}>{isWatching ? 'Stop' : 'Watch'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.readBtn]} onPress={onRead} disabled={status === 'reading'}>
            {status === 'reading' ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.actionBtnText}>Read</Text>}
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function DataRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={[styles.dataValue, highlight && styles.dataHighlight]}>{value}</Text>
    </View>
  );
}

function ErrorText({ message }: { message: string }) {
  return <Text style={styles.errorText}>⚠️ {message}</Text>;
}

// ─── Styles ──────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 16, paddingBottom: 40 },
  appBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, height: 56, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  backBtn: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  appBarTitle: { color: '#f1f5f9', fontSize: 18, fontWeight: '700' },
  
  permCard: { backgroundColor: '#1e293b', padding: 16, borderRadius: 12, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#6366f1' },
  permHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  permTitle: { color: '#f1f5f9', fontWeight: '700', fontSize: 15 },
  permSub: { color: '#64748b', fontSize: 12 },
  permBtn: { marginTop: 12, backgroundColor: '#6366f1', padding: 10, borderRadius: 8, alignItems: 'center' },
  permBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  badgeSuccess: { backgroundColor: '#059669' },
  badgeError: { backgroundColor: '#dc2626' },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  card: { backgroundColor: '#1e293b', borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: '#334155' },
  cardDisabled: { opacity: 0.5, backgroundColor: '#0f172a' },
  cardWatching: { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  cardTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  hwInfo: { color: '#64748b', fontSize: 10, marginTop: 2 },
  cardActions: { flexDirection: 'row' },
  actionBtn: { borderRadius: 6, paddingVertical: 6, paddingHorizontal: 12, marginLeft: 8 },
  readBtn: { backgroundColor: '#334155' },
  watchBtn: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#6366f1' },
  watchBtnActive: { backgroundColor: '#6366f1' },
  actionBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },

  cardBody: { borderTopWidth: 1, borderTopColor: '#334155', paddingTop: 12 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  dataLabel: { color: '#94a3b8', fontSize: 13 },
  dataValue: { color: '#e2e8f0', fontSize: 14, fontWeight: '600' },
  dataHighlight: { color: '#4ade80' },
  
  errorText: { color: '#f87171', fontSize: 12, marginTop: 8 },
  unavailableText: { color: '#64748b', fontSize: 12, marginTop: 8 },

  detectorRow: { marginTop: 12, padding: 12, backgroundColor: '#0f172a', borderRadius: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detectorTitle: { color: '#f1f5f9', fontSize: 13, fontWeight: '700' },
  detectorSub: { color: '#64748b', fontSize: 11 },
  detectorBtn: { backgroundColor: '#6366f1', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  detectorCount: { color: '#fff', fontSize: 18, fontWeight: '800' },

  footer: { marginTop: 8, padding: 16 },
  footerTitle: { color: '#94a3b8', fontSize: 14, fontWeight: '800', marginBottom: 8 },
  footerText: { color: '#64748b', fontSize: 12, marginBottom: 4 },
});
