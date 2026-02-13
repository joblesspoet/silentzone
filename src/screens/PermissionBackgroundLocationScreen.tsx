import React from 'react';
import { View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity, Linking, Image } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';
import { usePermissions } from '../permissions/PermissionsContext';
import { PRIVACY_POLICY_URL } from '../constants/ProductDetails';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  navigation: any;
}

export const PermissionBackgroundLocationScreen: React.FC<Props> = ({ navigation }) => {
  const { requestBackgroundLocationFlow, backgroundLocationStatus } = usePermissions();
  const insets = useSafeAreaInsets();

  const handleGrant = async () => {
    // This will trigger the requestBackgroundLocationFlow in PermissionsContext
    await requestBackgroundLocationFlow();
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
            <MaterialIcon name="shutter-speed" size={48} color={theme.colors.error} />
          </View>
          <View style={[styles.ring, styles.ring1]} />
          <View style={[styles.ring, styles.ring2]} />
        </View>

        <Text style={styles.title}>24/7 Automatic Tracking</Text>
        <Text style={styles.description}>
          For Silent Zone to work even when your phone is in your pocket and locked, you must grant "Allow all the time" access.
        </Text>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Critical Step for Android:</Text>
          <View style={styles.stepRow}>
            <Text style={styles.stepNumber}>1.</Text>
            <Text style={styles.stepText}>Tap the button below</Text>
          </View>
          <View style={styles.stepRow}>
            <Text style={styles.stepNumber}>2.</Text>
            <Text style={styles.stepText}>Select <Text style={styles.bold}>Permissions</Text></Text>
          </View>
          <View style={styles.stepRow}>
            <Text style={styles.stepNumber}>3.</Text>
            <Text style={styles.stepText}>Choose <Text style={styles.bold}>Location</Text></Text>
          </View>
          <View style={styles.stepRow}>
            <Text style={styles.stepNumber}>4.</Text>
            <Text style={styles.stepText}>Select <Text style={styles.bold}>"Allow all the time"</Text></Text>
          </View>
        </View>

        <Text style={styles.warningNote}>
          <MaterialIcon name="info-outline" size={14} color={theme.colors.error} />
          {" Without this, the app cannot silence your phone automatically."}
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, theme.spacing.xl) }]}>
        <CustomButton 
          title="Enable Always Allow" 
          onPress={handleGrant} 
          fullWidth 
          style={styles.grantButton}
        />
        <View style={styles.footerLinks}>
          <CustomButton 
             title="Skip (Manual Mode)" 
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
    backgroundColor: theme.colors.error + '1A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.error + '33',
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
    padding: theme.spacing.lg,
    borderRadius: theme.layout.borderRadius.lg,
    width: '100%',
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  infoTitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    marginBottom: theme.spacing.md,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  stepNumber: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary,
    width: 30,
  },
  stepText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.text.secondary.light,
  },
  bold: {
    fontWeight: 'bold',
    color: theme.colors.text.primary.light,
  },
  warningNote: {
    fontFamily: theme.typography.primary,
    fontSize: 12,
    color: theme.colors.error,
    textAlign: 'center',
    paddingHorizontal: theme.spacing.md,
  },
  footer: {
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.white,
  },
  grantButton: {
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.error,
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
