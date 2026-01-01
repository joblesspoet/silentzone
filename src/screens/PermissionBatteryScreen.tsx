import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';
import { useRealm } from '../database/RealmProvider';
import { PreferencesService } from '../database/services/PreferencesService';
import { usePermissions } from '../permissions/PermissionsContext';

interface Props {
  navigation: any;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const PermissionBatteryScreen: React.FC<Props> = ({ navigation }) => {
  const realm = useRealm();
  const { requestBatteryExemption, isBatteryOptimized } = usePermissions();
  const [checking, setChecking] = useState(true);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    // If we land here and it's already optimized (granted), proceed
    if (isBatteryOptimized) {
      completeSetup();
    }
    setChecking(false);
  }, [isBatteryOptimized]);

  const completeSetup = () => {
    // Mark onboarding as complete if not already
    // Note: This logic depends on where this screen is in the flow.
    // If it's part of onboarding, we might want to navigate to next step.
    // If it's a blocking check from Context, we return to Home.
    
    // For now, assume it's the final check or blocking check
    navigation.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  };

  const handleGrant = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await requestBatteryExemption();
        if (granted) {
          completeSetup();
        }
      } catch (error) {
        console.error('Failed to request Battery permission:', error);
        // Don't auto-complete on error, let user try again or skip
      }
    } else {
      completeSetup();
    }
  };

  const handleSkip = () => {
    completeSetup();
  };

  if (checking) {
    return (
      <View style={styles.container}>
        <Text style={styles.description}>Checking permissions...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.imageContainer}>
          <View style={[styles.iconCircle, { backgroundColor: theme.colors.primary + '1A' }]}>
            <MaterialIcon name="battery-alert" size={48} color={theme.colors.primary} />
          </View>
        </View>

        <Text style={styles.title}>Unrestricted Battery</Text>
        <Text style={styles.description}>
          To reliably wake up your phone for scheduled Silent Zones, we need "Unrestricted" battery access.
        </Text>

        <View style={styles.infoBox}>
          <View style={styles.infoRow}>
            <MaterialIcon name="check-circle" size={20} color={theme.colors.primary} />
            <Text style={styles.infoText}>Reliable activation 15 mins before prayers</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcon name="check-circle" size={20} color={theme.colors.primary} />
            <Text style={styles.infoText}>Prevents "Doze Mode" from killing the app</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcon name="check-circle" size={20} color={theme.colors.primary} />
            <Text style={styles.infoText}>Service sleeps when not needed (saves battery)</Text>
          </View>
        </View>

        <View style={styles.warningBox}>
          <MaterialIcon name="info" size={20} color={theme.colors.warning} />
          <Text style={styles.warningText}>
            Without this, Android will kill the background timer, and your phone won't silence on time.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, theme.spacing.xl) }]}>
        <CustomButton 
          title="Allow Unrestricted Access" 
          onPress={handleGrant} 
          fullWidth 
          style={styles.grantButton}
        />
        <CustomButton 
          title="Maybe Later (Not Recommended)" 
          onPress={handleSkip} 
          variant="link"
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
  scrollContent: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageContainer: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xl,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  description: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.text.secondary.light,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
    lineHeight: 24,
  },
  infoBox: {
    backgroundColor: theme.colors.surface.light,
    padding: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.lg,
    width: '100%',
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.md,
    gap: theme.spacing.md,
  },
  infoText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.text.primary.light,
    flex: 1,
  },
  warningBox: {
    backgroundColor: theme.colors.warning + '1A',
    padding: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.md,
    flexDirection: 'row',
    gap: theme.spacing.sm,
    width: '100%',
    borderWidth: 1,
    borderColor: theme.colors.warning + '40',
  },
  warningText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.primary.light,
    flex: 1,
    lineHeight: 20,
  },
  footer: {
    padding: theme.spacing.xl,
    paddingBottom: theme.spacing.xl, // Will be overridden
    backgroundColor: theme.colors.white,
  },
  grantButton: {
    marginBottom: theme.spacing.sm,
  },
});
