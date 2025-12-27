import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Platform } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';
import RingerMode from '../modules/RingerMode';

interface Props {
  navigation: any;
}

export const PermissionDndScreen: React.FC<Props> = ({ navigation }) => {
  const [hasPermission, setHasPermission] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    if (Platform.OS === 'android') {
      try {
        const granted = await RingerMode.checkDndPermission();
        setHasPermission(granted);
      } catch (error) {
        console.error('Failed to check DND permission:', error);
      }
    }
    setChecking(false);
  };

  const handleGrant = async () => {
    if (Platform.OS === 'android') {
      try {
        await RingerMode.requestDndPermission();
        // The checkPermission will be triggered by AppState listener in PermissionsContext
        // or user can just tap "Grant" again. We'll wait a bit then navigate.
        setTimeout(async () => {
          const granted = await RingerMode.checkDndPermission();
          if (granted) {
            navigation.replace('OnboardingWelcome');
          }
        }, 2000);
      } catch (error) {
        console.error('Failed to request DND permission:', error);
      }
    } else {
      navigation.replace('OnboardingWelcome');
    }
  };

  const handleSkip = () => {
    navigation.replace('OnboardingWelcome');
  };

  // If already has permission, skip this screen
  useEffect(() => {
    if (!checking && hasPermission) {
      navigation.replace('OnboardingWelcome');
    }
  }, [checking, hasPermission]);

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

      <View style={styles.footer}>
        <CustomButton 
          title="Grant Permission" 
          onPress={handleGrant} 
          fullWidth 
          style={styles.grantButton}
        />
        <CustomButton 
          title="Skip for Now" 
          onPress={handleSkip} 
          variant="ghost" 
          fullWidth
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
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
    backgroundColor: theme.colors.white,
  },
  grantButton: {
    marginBottom: theme.spacing.sm,
  },
});
