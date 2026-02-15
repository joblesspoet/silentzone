import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, AppState, ActivityIndicator } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';
import { usePermissions } from '../permissions/PermissionsContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RESULTS } from 'react-native-permissions';
import { PreferencesService } from '../database/services/PreferencesService';
import { useRealm } from '../database/RealmProvider';
import { locationService } from '../services/LocationService';

interface PermissionItemProps {
  title: string;
  description: string;
  isGranted: boolean;
  onPress: () => void;
  icon: string;
  isLoading?: boolean;
}

const PermissionItem: React.FC<PermissionItemProps> = ({ title, description, isGranted, onPress, icon, isLoading }) => (
  <View style={styles.permissionItem}>
    <View style={styles.iconContainer}>
      <MaterialIcon
        name={icon}
        size={24}
        color={isGranted ? theme.colors.success : theme.colors.primary}
      />
    </View>
    <View style={styles.textContainer}>
      <Text style={[styles.itemTitle, isGranted && styles.textGranted]}>{title}</Text>
      <Text style={styles.itemDescription}>{description}</Text>
    </View>
    <TouchableOpacity
      style={[styles.statusButton, isGranted ? styles.buttonGranted : styles.buttonPending]}
      onPress={onPress}
      disabled={isGranted || isLoading}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={theme.colors.white} />
      ) : isGranted ? (
        <MaterialIcon name="check" size={20} color={theme.colors.white} />
      ) : (
        <Text style={styles.buttonText}>Allow</Text>
      )}
    </TouchableOpacity>
  </View>
);

export const UnifiedPermissionScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const realm = useRealm();
  const {
    locationStatus,
    backgroundLocationStatus,
    notificationStatus,
    dndStatus,
    isBatteryOptimized,
    exactAlarmStatus,
    requestLocationFlow,
    requestBackgroundLocationFlow,
    requestNotificationFlow,
    requestDndFlow,
    requestBatteryExemption,
    requestExactAlarmFlow,
    refreshPermissions,
    hasAllPermissions,
  } = usePermissions();

  const [processingType, setProcessingType] = useState<string | null>(null);

  const wrapAction = async (type: string, action: () => Promise<any>) => {
    setProcessingType(type);
    try {
      // Just waiting for the promise to resolve/reject
      await action();
    } catch (e) {
      console.error(`[UnifiedPermissionScreen] Error requesting ${type}:`, e);
    } finally {
      setProcessingType(null);
    }
  };

  const isLocationGranted = locationStatus === RESULTS.GRANTED;
  const isBgGranted = backgroundLocationStatus === RESULTS.GRANTED;
  const isNotificationGranted = notificationStatus === RESULTS.GRANTED;
  const isDndGranted = dndStatus === RESULTS.GRANTED;

  const handleStart = async () => {
    if (!realm) return;

    try {
      console.log('[UnifiedPermissionScreen] Finalizing setup...');

      // 1. Mark onboarding complete in DB
      PreferencesService.setOnboardingComplete(realm);

      // FIX: Explicitly initialize the location engine here.
      //
      // App.tsx's init effect ran at startup BEFORE onboarding was complete, so it
      // only called locationService.setRealmReference() — which skips creating
      // notification channels. It does not re-run after onboarding finishes.
      //
      // PermissionsContext's change-detection would ideally call initialize() when
      // it next fires, but there is a timing gap between this navigation and the
      // next AppState 'active' event. During that gap, HomeScreen's setInterval
      // can fire and reach startMonitoring() → updateForegroundService() →
      // notificationManager.startForegroundService() on a channel that doesn't
      // exist yet — causing a fatal crash on Android.
      //
      // Calling initialize() here — before navigating — guarantees channels are
      // created and geofences are seeded before any background code can run.
      await locationService.initialize(realm);

      console.log('[UnifiedPermissionScreen] Engine initialized, navigating home.');
      navigation.replace('Home');
    } catch (error) {
      console.error('[UnifiedPermissionScreen] Error during setup finalization:', error);
      // Fallback: still navigate — LocationService has its own internal guards
      navigation.replace('Home');
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, theme.spacing.xl) }]}>
        <Text style={styles.title}>All-in-One Setup</Text>
        <Text style={styles.subtitle}>
          Grant these permissions to enable automatic silencing when you arrive at your favorite places.
        </Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <PermissionItem
          title="Location Services"
          description="Used to know when you are near a Silent Zone."
          isGranted={isLocationGranted}
          icon="location-on"
          isLoading={processingType === 'LOCATION'}
          onPress={() => wrapAction('LOCATION', requestLocationFlow)}
        />
        <PermissionItem
          title="Background Location"
          description='Requires "Allow all the time" to work while your phone is in your pocket.'
          isGranted={isBgGranted}
          icon="my-location"
          isLoading={processingType === 'BACKGROUND'}
          onPress={() => wrapAction('BACKGROUND', requestBackgroundLocationFlow)}
        />
        <PermissionItem
          title="Notifications"
          description="Know when your phone is being silenced or restored."
          isGranted={isNotificationGranted}
          icon="notifications"
          isLoading={processingType === 'NOTIFICATION'}
          onPress={() => wrapAction('NOTIFICATION', requestNotificationFlow)}
        />
        <PermissionItem
          title="Do Not Disturb"
          description="Required to actually silence the ringer on Android."
          isGranted={isDndGranted}
          icon="do-not-disturb-on"
          isLoading={processingType === 'DND'}
          onPress={() => wrapAction('DND', requestDndFlow)}
        />
        <PermissionItem
          title="Exact Alarms"
          description="Guarantees the app wakes up exactly at the right time."
          isGranted={exactAlarmStatus}
          icon="alarm"
          isLoading={processingType === 'ALARM'}
          onPress={() => wrapAction('ALARM', requestExactAlarmFlow)}
        />
        <PermissionItem
          title="Force Background Execution"
          description="MANDATORY: Disable battery optimization (Set to 'Unrestricted') so Android doesn't kill the app."
          isGranted={isBatteryOptimized}
          icon="battery-saver"
          isLoading={processingType === 'BATTERY'}
          onPress={() => wrapAction('BATTERY', requestBatteryExemption)}
        />
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, theme.spacing.xl) }]}>
        {!hasAllPermissions && (
          <View style={styles.warningContainer}>
            <MaterialIcon name="info-outline" size={16} color={theme.colors.error} />
            <Text style={styles.warningText}>All permissions are required for full features.</Text>
          </View>
        )}
        <CustomButton
          title="Start Application"
          onPress={handleStart}
          fullWidth
          disabled={!hasAllPermissions}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.light,
  },
  header: {
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.text.secondary.light,
    lineHeight: 22,
  },
  scrollContent: {
    padding: theme.spacing.xl,
    paddingTop: 0,
  },
  permissionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface.light,
    padding: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.lg,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.background.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  textContainer: {
    flex: 1,
  },
  itemTitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    marginBottom: 2,
  },
  textGranted: {
    color: theme.colors.success,
  },
  itemDescription: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.text.secondary.light,
    lineHeight: 16,
  },
  statusButton: {
    width: 60,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: theme.spacing.md,
  },
  buttonPending: {
    backgroundColor: theme.colors.primary,
  },
  buttonGranted: {
    backgroundColor: theme.colors.success,
  },
  buttonText: {
    color: theme.colors.white,
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
  },
  footer: {
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.white,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
  warningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
    gap: 4,
  },
  warningText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.error,
  },
});