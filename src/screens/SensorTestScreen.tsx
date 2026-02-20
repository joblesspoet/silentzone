/**
 * SensorTestScreen — TASK-00 Verification
 *
 * Tests all 4 SFPE sensors individually. Each card shows:
 *  - Whether the sensor is available on this device
 *  - Live reading when the "Read" button is pressed
 *  - Error state if the sensor times out or is unavailable
 *
 * Pass criteria (post-conditions from SFPE_TASKS.md):
 *  ✅ Live readings confirmed from all sensors
 *  ✅ Error states handled gracefully
 *  ✅ Works from foreground (HeadlessJS tests to follow separately)
 */

import React, { useState, useCallback } from 'react';
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
} from 'react-native';
import SZSensorModule, {
  StepCountResult,
  MagneticHeadingResult,
  BarometricPressureResult,
  AccelerationResult,
} from '../native/SZSensorModule';

// ─── Types ───────────────────────────────────────────────
type SensorStatus = 'idle' | 'reading' | 'done' | 'error' | 'unavailable';

interface SensorCardState<T> {
  status: SensorStatus;
  data: T | null;
  error: string | null;
  available: boolean | null;
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
export default function SensorTestScreen() {
  const [stepState, setStepState] = useState<SensorCardState<StepCountResult>>({
    status: 'idle', data: null, error: null, available: null,
  });
  const [headingState, setHeadingState] = useState<SensorCardState<MagneticHeadingResult>>({
    status: 'idle', data: null, error: null, available: null,
  });
  const [pressureState, setPressureState] = useState<SensorCardState<BarometricPressureResult>>({
    status: 'idle', data: null, error: null, available: null,
  });
  const [accelState, setAccelState] = useState<SensorCardState<AccelerationResult>>({
    status: 'idle', data: null, error: null, available: null,
  });
  const [allRunning, setAllRunning] = useState(false);

  // Request ACTIVITY_RECOGNITION permission for step counter (Android 10+)
  const requestActivityPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android' || Platform.Version < 29) return true;
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  };

  const readStepCount = useCallback(async () => {
    setStepState(s => ({ ...s, status: 'reading', error: null }));
    const hasPermission = await requestActivityPermission();
    if (!hasPermission) {
      setStepState(s => ({ ...s, status: 'error', error: 'ACTIVITY_RECOGNITION permission denied' }));
      return;
    }
    try {
      const available = await SZSensorModule.isSensorAvailable('step_counter');
      if (!available) { setStepState({ status: 'unavailable', data: null, error: null, available: false }); return; }
      const data = await SZSensorModule.getStepCount();
      setStepState({ status: 'done', data, error: null, available: true });
    } catch (e: any) {
      setStepState(s => ({ ...s, status: 'error', error: e.message }));
    }
  }, []);

  const readHeading = useCallback(async () => {
    setHeadingState(s => ({ ...s, status: 'reading', error: null }));
    try {
      const available = await SZSensorModule.isSensorAvailable('magnetometer');
      if (!available) { setHeadingState({ status: 'unavailable', data: null, error: null, available: false }); return; }
      const data = await SZSensorModule.getMagneticHeading();
      setHeadingState({ status: 'done', data, error: null, available: true });
    } catch (e: any) {
      setHeadingState(s => ({ ...s, status: 'error', error: e.message }));
    }
  }, []);

  const readPressure = useCallback(async () => {
    setPressureState(s => ({ ...s, status: 'reading', error: null }));
    try {
      const available = await SZSensorModule.isSensorAvailable('barometer');
      if (!available) { setPressureState({ status: 'unavailable', data: null, error: null, available: false }); return; }
      const data = await SZSensorModule.getBarometricPressure();
      setPressureState({ status: 'done', data, error: null, available: true });
    } catch (e: any) {
      setPressureState(s => ({ ...s, status: 'error', error: e.message }));
    }
  }, []);

  const readAcceleration = useCallback(async () => {
    setAccelState(s => ({ ...s, status: 'reading', error: null }));
    try {
      const available = await SZSensorModule.isSensorAvailable('accelerometer');
      if (!available) { setAccelState({ status: 'unavailable', data: null, error: null, available: false }); return; }
      const data = await SZSensorModule.getAcceleration();
      setAccelState({ status: 'done', data, error: null, available: true });
    } catch (e: any) {
      setAccelState(s => ({ ...s, status: 'error', error: e.message }));
    }
  }, []);

  const readAll = useCallback(async () => {
    setAllRunning(true);
    await Promise.all([readStepCount(), readHeading(), readPressure(), readAcceleration()]);
    setAllRunning(false);
  }, [readStepCount, readHeading, readPressure, readAcceleration]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>🔬 SFPE Sensor Test</Text>
          <Text style={styles.headerSubtitle}>TASK-00 Verification — tap each sensor to test</Text>
        </View>

        {/* Test All Button */}
        <TouchableOpacity style={styles.testAllBtn} onPress={readAll} disabled={allRunning}>
          {allRunning
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.testAllText}>⚡ Test All Sensors</Text>}
        </TouchableOpacity>

        {/* Step Counter */}
        <SensorCard
          icon="👟"
          title="Step Counter"
          subtitle="TYPE_STEP_COUNTER"
          purpose="Dead reckoning displacement"
          status={stepState.status}
          onRead={readStepCount}
        >
          {stepState.data && (
            <>
              <DataRow label="Total Steps (since reboot)" value={stepState.data.steps.toFixed(0)} />
              <DataRow label="Use for" value="Baseline on check-in → delta tracking" />
            </>
          )}
          {stepState.error && <ErrorText message={stepState.error} />}
          {stepState.status === 'unavailable' && <UnavailableText />}
        </SensorCard>

        {/* Magnetometer */}
        <SensorCard
          icon="🧭"
          title="Magnetometer"
          subtitle="TYPE_MAGNETIC_FIELD"
          purpose="Heading / compass direction"
          status={headingState.status}
          onRead={readHeading}
        >
          {headingState.data && (
            <>
              <DataRow label="Heading" value={`${headingState.data.heading.toFixed(1)}°  ${headingToDirection(headingState.data.heading)}`} />
              <DataRow label="X" value={`${headingState.data.x.toFixed(2)} µT`} />
              <DataRow label="Y" value={`${headingState.data.y.toFixed(2)} µT`} />
              <DataRow label="Z" value={`${headingState.data.z.toFixed(2)} µT`} />
            </>
          )}
          {headingState.error && <ErrorText message={headingState.error} />}
          {headingState.status === 'unavailable' && <UnavailableText />}
        </SensorCard>

        {/* Barometer */}
        <SensorCard
          icon="🌡️"
          title="Barometer"
          subtitle="TYPE_PRESSURE"
          purpose="Floor / elevation fingerprint"
          status={pressureState.status}
          onRead={readPressure}
        >
          {pressureState.data && (
            <>
              <DataRow label="Pressure" value={`${pressureState.data.pressureHPa.toFixed(2)} hPa`} />
              <DataRow label="Altitude (est.)" value={`${pressureState.data.altitudeM.toFixed(1)} m`} />
              <DataRow label="Floor fingerprint" value="Save this value when adding a place" />
            </>
          )}
          {pressureState.error && <ErrorText message={pressureState.error} />}
          {pressureState.status === 'unavailable' && <UnavailableText />}
        </SensorCard>

        {/* Accelerometer */}
        <SensorCard
          icon="📱"
          title="Accelerometer"
          subtitle="TYPE_ACCELEROMETER"
          purpose="Detect walk / vehicle / stationary"
          status={accelState.status}
          onRead={readAcceleration}
        >
          {accelState.data && (
            <>
              <DataRow label="Magnitude" value={`${accelState.data.magnitude.toFixed(2)} m/s²`} />
              <DataRow label="Motion" value={motionLabel(accelState.data.magnitude)} />
              <DataRow label="X / Y / Z" value={`${accelState.data.x.toFixed(1)} / ${accelState.data.y.toFixed(1)} / ${accelState.data.z.toFixed(1)}`} />
            </>
          )}
          {accelState.error && <ErrorText message={accelState.error} />}
          {accelState.status === 'unavailable' && <UnavailableText />}
        </SensorCard>

        {/* Summary legend */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Post-Condition Checklist</Text>
          <Text style={styles.legendItem}>✅ All 4 sensors showing readings = TASK-00 PASSED</Text>
          <Text style={styles.legendItem}>⚠️ Sensor unavailable = note device limitation</Text>
          <Text style={styles.legendItem}>❌ Error/timeout = investigate device permissions</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-components ──────────────────────────────────────

interface SensorCardProps {
  icon: string;
  title: string;
  subtitle: string;
  purpose: string;
  status: SensorStatus;
  onRead: () => void;
  children?: React.ReactNode;
}

function SensorCard({ icon, title, subtitle, purpose, status, onRead, children }: SensorCardProps) {
  const borderColor = status === 'done' ? '#4ade80'
    : status === 'error' ? '#f87171'
    : status === 'unavailable' ? '#facc15'
    : '#334155';

  return (
    <View style={[styles.card, { borderColor }]}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.cardTitle}>{icon} {title}</Text>
          <Text style={styles.cardSubtitle}>{subtitle}</Text>
          <Text style={styles.cardPurpose}>Purpose: {purpose}</Text>
        </View>
        <TouchableOpacity
          style={[styles.readBtn, status === 'reading' && styles.readBtnLoading]}
          onPress={onRead}
          disabled={status === 'reading'}
        >
          {status === 'reading'
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={styles.readBtnText}>Read</Text>}
        </TouchableOpacity>
      </View>
      {children && <View style={styles.cardBody}>{children}</View>}
    </View>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.dataRow}>
      <Text style={styles.dataLabel}>{label}</Text>
      <Text style={styles.dataValue}>{value}</Text>
    </View>
  );
}

function ErrorText({ message }: { message: string }) {
  return <Text style={styles.errorText}>❌ {message}</Text>;
}

function UnavailableText() {
  return <Text style={styles.unavailableText}>⚠️ Sensor not available on this device</Text>;
}

// ─── Styles ──────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { padding: 16, paddingBottom: 40 },
  header: { marginBottom: 16 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#f1f5f9', marginBottom: 4 },
  headerSubtitle: { fontSize: 13, color: '#94a3b8' },
  testAllBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    marginBottom: 20,
  },
  testAllText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 16,
    marginBottom: 14,
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#f1f5f9', marginBottom: 2 },
  cardSubtitle: { fontSize: 11, color: '#64748b', fontFamily: 'monospace', marginBottom: 4 },
  cardPurpose: { fontSize: 12, color: '#94a3b8' },
  readBtn: {
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
    minWidth: 60,
    alignItems: 'center',
  },
  readBtnLoading: { backgroundColor: '#4338ca' },
  readBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  cardBody: { marginTop: 12, borderTopWidth: 1, borderTopColor: '#334155', paddingTop: 12 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  dataLabel: { fontSize: 12, color: '#64748b', flex: 1 },
  dataValue: { fontSize: 13, color: '#e2e8f0', fontWeight: '600', flex: 1, textAlign: 'right' },
  errorText: { fontSize: 13, color: '#f87171', marginTop: 8 },
  unavailableText: { fontSize: 13, color: '#facc15', marginTop: 8 },
  legend: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginTop: 8,
  },
  legendTitle: { fontSize: 14, fontWeight: '700', color: '#94a3b8', marginBottom: 10 },
  legendItem: { fontSize: 12, color: '#64748b', marginBottom: 6, lineHeight: 18 },
});
