import React from 'react';
import { View, Text, StyleSheet, Image, ScrollView, Platform } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';
import { usePermissions } from '../permissions/PermissionsContext';
import { RESULTS } from 'react-native-permissions';

interface Props {
  navigation: any;
}

export const PermissionLocationScreen: React.FC<Props> = ({ navigation }) => {
  const { requestLocationFlow, locationStatus } = usePermissions();

  const handleGrant = async () => {
    const success = await requestLocationFlow();
    if (success) {
      navigation.replace('PermissionNotification');
    } else {
      // Logic for denied: maybe show a "Are you sure?" or just proceed for now
      // For MVP, we'll just proceed but maybe could show a toast
      navigation.replace('PermissionNotification');
    }
  };

  const handleSkip = () => {
    navigation.replace('PermissionNotification');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.imageContainer}>
          <View style={styles.iconCircle}>
            <MaterialIcon name="location-pin" size={48} color={theme.colors.primary} />
          </View>
          {/* Pulsing rings could go here */}
          <View style={[styles.ring, styles.ring1]} />
          <View style={[styles.ring, styles.ring2]} />
        </View>

        <Text style={styles.title}>Enable Location Access</Text>
        <Text style={styles.description}>
          Silent Zone uses your location to automatically silence your phone when you are in your saved places.
        </Text>

        <View style={styles.infoBox}>
          <View style={styles.infoRow}>
            <MaterialIcon name="my-location" size={20} color={theme.colors.text.secondary.light} />
            <Text style={styles.infoText}>Detects when you enter/exit zones</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcon name="battery-std" size={20} color={theme.colors.text.secondary.light} />
            <Text style={styles.infoText}>Optimized for minimal battery usage</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcon name="lock" size={20} color={theme.colors.text.secondary.light} />
            <Text style={styles.infoText}>Location data never leaves your device</Text>
          </View>
        </View>

        <Text style={styles.note}>
          {Platform.OS === 'ios' ? 
            "Please select 'Allow While Using App' first. Later, for automatic background silencing, you can upgrade to 'Always'." : 
            "For full automatic functionality, please choose 'Allow all the time' in settings if prompted."}
        </Text>
      </ScrollView>

      <View style={styles.footer}>
        <CustomButton 
          title="Grant Location Access" 
          onPress={handleGrant} 
          fullWidth 
          style={styles.grantButton}
        />
        <CustomButton 
          title="Maybe Later" 
          onPress={handleSkip} 
          variant="text" 
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
    position: 'relative',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.primary + '1A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.primary + '33', // 20%
  },
  ring1: { width: 120, height: 120 },
  ring2: { width: 160, height: 160, opacity: 0.5 },
  
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.h2,
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
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  infoText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.secondary.light,
  },
  note: {
    fontFamily: theme.typography.primary,
    fontSize: 12,
    color: theme.colors.text.secondary.light,
    textAlign: 'center',
    fontStyle: 'italic',
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
