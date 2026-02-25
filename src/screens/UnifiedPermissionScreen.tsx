import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Platform,
  TouchableOpacity,
  AppState,
  ActivityIndicator,
} from 'react-native';
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
  // FIX #3: Allow battery item to always show a "Verify" button even when granted,
  // so the user can re-open App Info to confirm "Unrestricted" specifically.
  alwaysShowButton?: boolean;
  grantedLabel?: string;
}

const PermissionItem: React.FC<PermissionItemProps> = ({
  title,
  description,
  isGranted,
  onPress,
  icon,
  isLoading,
  alwaysShowButton = false,
  grantedLabel,
}) => (
  <View style={styles.permissionItem}>
    <View style={styles.iconContainer}>
      <MaterialIcon
        name={icon}
        size={24}
        color={isGranted ? theme.colors.success : theme.colors.primary}
      />
    </View>
    <View style={styles.textContainer}>
      <Text style={[styles.itemTitle, isGranted && styles.textGranted]}>
        {title}
      </Text>
      <Text style={styles.itemDescription}>{description}</Text>
    </View>
    <TouchableOpacity
      style={[
        styles.statusButton,
        // FIX #3: When alwaysShowButton is true (battery), show a different
        // "Verify" style even when granted — so user can re-open settings to
        // confirm "Unrestricted" vs "Optimized" specifically.
        isGranted && !alwaysShowButton
          ? styles.buttonGranted
          : isGranted && alwaysShowButton
          ? styles.buttonVerify
          : styles.buttonPending,
      ]}
      onPress={onPress}
      // FIX #3: Never fully disable the battery button. isIgnoringBatteryOptimizations()
      // returns true for both "Unrestricted" AND sometimes "Optimized" on certain OEMs.
      // The user needs to always be able to re-open settings to manually confirm.
      disabled={(!alwaysShowButton && isGranted) || !!isLoading}
    >
      {isLoading ? (
        <ActivityIndicator size="small" color={theme.colors.white} />
      ) : isGranted && !alwaysShowButton ? (
        <MaterialIcon name="check" size={20} color={theme.colors.white} />
      ) : isGranted && alwaysShowButton ? (
        <Text style={styles.buttonText}>{grantedLabel ?? 'Verify'}</Text>
      ) : (
        <Text style={styles.buttonText}>Allow</Text>
      )}
    </TouchableOpacity>
  </View>
);

export const UnifiedPermissionScreen: React.FC<{ navigation: any }> = ({
  navigation,
}) => {
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
    requestActivityRecognitionFlow,
    activityRecognitionStatus,
    refreshPermissions,
    hasAllPermissions,
  } = usePermissions();

  const [processingType, setProcessingType] = useState<string | null>(null);

  const wrapAction = async (type: string, action: () => Promise<any>) => {
    setProcessingType(type);
    try {
      await action();
    } catch (e) {
      console.error(`[UnifiedPermissionScreen] Error requesting ${type}:`, e);
    } finally {
      setProcessingType(null);
    }
  };

  // FIX #1: Include RESULTS.LIMITED for location granted checks.
  // Previously these were strict === RESULTS.GRANTED, so if the OS returned
  // RESULTS.LIMITED (e.g. Approximate Location on Android 12+), the UI showed
  // "Allow" even though PermissionsContext.hasAllPermissions considered it granted.
  // This caused a state where the "Start Application" button was enabled but
  // the location row still showed a pending "Allow" button — confusing and wrong.
  const isLocationGranted =
    locationStatus === RESULTS.GRANTED || locationStatus === RESULTS.LIMITED;

  // FIX #2: Same fix for background location.
  const isBgGranted =
    backgroundLocationStatus === RESULTS.GRANTED ||
    backgroundLocationStatus === RESULTS.LIMITED;
  const isActivityRecognitionGranted =
    activityRecognitionStatus === RESULTS.GRANTED ||
    activityRecognitionStatus === RESULTS.LIMITED;

  const isNotificationGranted = notificationStatus === RESULTS.GRANTED;
  const isDndGranted = dndStatus === RESULTS.GRANTED;

  const handleStart = async () => {
    if (!realm) return;
    try {
      console.log('[UnifiedPermissionScreen] Finalizing setup...');

      PreferencesService.setOnboardingComplete(realm);
      navigation.replace('Home');
    } catch (error) {
      console.error(
        '[UnifiedPermissionScreen] Error during setup finalization:',
        error,
      );
      navigation.replace('Home');
    }
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.header,
          { paddingTop: Math.max(insets.top, theme.spacing.xl) },
        ]}
      >
        <Text style={styles.title}>All-in-One Setup</Text>
        <Text style={styles.subtitle}>
          Grant these permissions to enable automatic silencing when you arrive
          at your favorite places.
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
          onPress={() =>
            wrapAction('BACKGROUND', requestBackgroundLocationFlow)
          }
        />
        {Platform.OS === 'android' && Platform.Version >= 29 && (
          <PermissionItem
            title="Activity Recognition"
            description="Used to detect when you are walking or driving."
            isGranted={isActivityRecognitionGranted}
            icon="directions-walk"
            isLoading={processingType === 'ACTIVITY_RECOGNITION'}
            onPress={() =>
              wrapAction('ACTIVITY_RECOGNITION', requestActivityRecognitionFlow)
            }
          />
        )}
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

        {/*
          FIX #3: Battery item uses alwaysShowButton + grantedLabel="Verify".
          
          WHY: On Android 14/15, isIgnoringBatteryOptimizations() returns true for
          both "Unrestricted" AND "Optimized" on some OEMs (Samsung One UI 6+, 
          some Pixel builds). So the checkmark can appear even when the app is only
          on "Optimized" — which still allows Android to kill it during Doze.
          
          The user needs to be able to tap "Verify" even when the check is green,
          to manually confirm they see "Unrestricted" (not "Optimized") in the
          App Info → Battery page.
          
          If it was already showing checked when they arrived at this screen, it 
          means Android's API reports it as whitelisted — but they should tap 
          "Verify" once to double-check the setting says "Unrestricted" specifically.
        */}
        <PermissionItem
          title="Force Background Execution"
          description={
            isBatteryOptimized
              ? Platform.OS === 'android'
                ? 'CRITICAL: Tap "Verify" and ensure "Unrestricted" is selected (NOT "Optimized").'
                : 'Battery optimization disabled.'
              : "MANDATORY: You MUST set battery to 'Unrestricted' so Android doesn't kill the app."
          }
          isGranted={isBatteryOptimized}
          icon="battery-saver"
          isLoading={processingType === 'BATTERY'}
          alwaysShowButton={Platform.OS === 'android'}
          grantedLabel="Verify"
          onPress={() => wrapAction('BATTERY', requestBatteryExemption)}
        />
      </ScrollView>

      <View
        style={[
          styles.footer,
          { paddingBottom: Math.max(insets.bottom, theme.spacing.xl) },
        ]}
      >
        {!hasAllPermissions && (
          <View style={styles.warningContainer}>
            <MaterialIcon
              name="info-outline"
              size={16}
              color={theme.colors.error}
            />
            <Text style={styles.warningText}>
              All permissions are required for full features.
            </Text>
          </View>
        )}
        {/*
          FIX #3 (cont): Show a soft advisory when battery is "granted" so the
          user knows to verify "Unrestricted" before starting.
        */}
        {hasAllPermissions && Platform.OS === 'android' && (
          <View style={styles.advisoryContainer}>
            <MaterialIcon name="warning" size={16} color={theme.colors.error} />
            <Text style={styles.advisoryText}>
              IMPORTANT: Tap "Verify" on Battery and confirm "Unrestricted" is
              selected before starting.
            </Text>
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
  // FIX #3: New style for the battery "Verify" button — distinct from both
  // "Allow" (pending) and the locked green checkmark (fully granted).
  buttonVerify: {
    backgroundColor: theme.colors.primary,
    opacity: 0.75,
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
  advisoryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.md,
    gap: 4,
  },
  advisoryText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.primary,
    flex: 1,
  },
});
