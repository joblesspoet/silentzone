import React, { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';
import { useRealm } from '../database/RealmProvider';
import { PreferencesService } from '../database/services/PreferencesService';
import { usePermissions } from '../permissions/PermissionsContext';
import { RESULTS } from 'react-native-permissions';

interface Props {
  navigation: any;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const PermissionDndScreen: React.FC<Props> = ({ navigation }) => {
  const realm = useRealm();
  const { dndStatus, requestDndFlow } = usePermissions();
  const insets = useSafeAreaInsets();

  const completeSetup = () => {
    console.log('[PermissionDndScreen] Marking onboarding complete and navigating home.');
    // Mark onboarding as complete
    PreferencesService.setOnboardingComplete(realm);
    
    // Navigate to Home
    navigation.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  };

  const handleGrant = async () => {
    if (Platform.OS === 'android') {
      try {
        await requestDndFlow();
        // Context will refresh state when app returns to foreground.
        // useEffect below will handle auto-completion.
      } catch (error) {
        console.error('Failed to request DND permission:', error);
      }
    } else {
      completeSetup();
    }
  };

  const handleSkip = () => {
    completeSetup();
  };

  // Auto-proceed when permission is granted (detect via context)
  useEffect(() => {
    if (dndStatus === RESULTS.GRANTED) {
      completeSetup();
    }
  }, [dndStatus]);

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.imageContainer}>
          <View style={[styles.iconCircle, { backgroundColor: theme.colors.primary + '1A' }]}>
            <MaterialIcon name="volume-off" size={48} color={theme.colors.primary} />
          </View>
        </View>

        <Text style={styles.title}>Do Not Disturb Access</Text>
        <Text style={styles.description}>
          To automatically silence your phone when entering Silent Zones, we need "Do Not Disturb" permission.
        </Text>

        <View style={styles.infoBox}>
          <View style={styles.infoRow}>
            <MaterialIcon name="check-circle" size={20} color={theme.colors.primary} />
            <Text style={styles.infoText}>Automatically silence phone in Silent Zones</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcon name="check-circle" size={20} color={theme.colors.primary} />
            <Text style={styles.infoText}>Restore previous volume when leaving</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcon name="check-circle" size={20} color={theme.colors.primary} />
            <Text style={styles.infoText}>No manual intervention needed</Text>
          </View>
        </View>

        <View style={styles.warningBox}>
          <MaterialIcon name="info" size={20} color={theme.colors.warning} />
          <Text style={styles.warningText}>
            This permission is required for Silent Zone to work. Without it, you'll need to manually silence your phone.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, theme.spacing.xl) }]}>
        <CustomButton 
          title="Grant Permission" 
          onPress={handleGrant} 
          fullWidth 
          style={styles.grantButton}
        />
        <CustomButton 
          title="Maybe Later" 
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
