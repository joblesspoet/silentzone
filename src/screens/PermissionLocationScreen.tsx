import React from 'react';
import { View, Text, StyleSheet, Image, ScrollView, Platform, TouchableOpacity, Linking } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';
import { usePermissions } from '../permissions/PermissionsContext';
import { PRIVACY_POLICY_URL } from '../constants/ProductDetails';

interface Props {
  navigation: any;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const PermissionLocationScreen: React.FC<Props> = ({ navigation }) => {
  const { requestLocationFlow, locationStatus } = usePermissions();
  const insets = useSafeAreaInsets();

  const handleGrant = async () => {
    await requestLocationFlow();
    navigation.replace('PermissionAlarm');
  };

  const handleSkip = () => {
    navigation.replace('PermissionAlarm');
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
          Silent Zone accesses your location <Text style={{ fontWeight: 'bold' }}>even when the app is closed or not in use</Text> to automatically trigger silencing whenever you enter your saved places.
        </Text>

        <View style={styles.infoBox}>
          <View style={styles.infoRow}>
            <MaterialIcon name="my-location" size={20} color={theme.colors.text.secondary.light} />
            <Text style={styles.infoText}>Detects when you enter/exit zones</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcon name="update" size={20} color={theme.colors.text.secondary.light} />
            <Text style={styles.infoText}>Triggers without opening the app</Text>
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

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, theme.spacing.xl) }]}>
        <CustomButton 
          title="Grant Location Access" 
          onPress={handleGrant} 
          fullWidth 
          style={styles.grantButton}
        />
        <View style={styles.footerLinks}>
          <CustomButton 
             title="Maybe Later" 
             onPress={handleSkip} 
             variant="link"
          />
          <Text style={styles.linkSeparator}>•</Text>
          <TouchableOpacity onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}>
            <Text style={styles.privacyLink}>Privacy Policy</Text>
          </TouchableOpacity>
        </View>
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
    paddingBottom: theme.spacing.xl, // Will be overridden in component
    backgroundColor: theme.colors.white,
  },
  grantButton: {
    marginBottom: theme.spacing.sm,
  },
  footerLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  linkSeparator: {
    color: theme.colors.text.disabled,
    fontSize: 12,
  },
  privacyLink: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.primary,
    fontWeight: theme.typography.weights.medium,
    textDecorationLine: 'underline',
  },
});
