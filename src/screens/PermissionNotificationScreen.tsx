import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';
import { usePermissions } from '../permissions/PermissionsContext';

interface Props {
  navigation: any;
}

export const PermissionNotificationScreen: React.FC<Props> = ({ navigation }) => {
  const { requestNotificationFlow } = usePermissions();

  const handleGrant = async () => {
    await requestNotificationFlow();
    navigation.replace('PermissionDnd');
  };

  const handleSkip = () => {
    navigation.replace('PermissionDnd');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.imageContainer}>
          <View style={[styles.iconCircle, { backgroundColor: theme.colors.secondary + '1A' }]}>
            <MaterialIcon name="notifications-active" size={48} color={theme.colors.secondary} />
          </View>
        </View>

        <Text style={styles.title}>Stay Updated</Text>
        <Text style={styles.description}>
          Enable notifications to know when Silent Zone activates or deactivates silent mode for you.
        </Text>

        <View style={styles.infoBox}>
          <View style={styles.infoRow}>
            <MaterialIcon name="check-circle" size={20} color={theme.colors.secondary} />
            <Text style={styles.infoText}>Get notified upon entering a Silent Zone</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcon name="check-circle" size={20} color={theme.colors.secondary} />
            <Text style={styles.infoText}>Confirmation when volume is restored</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <CustomButton 
          title="Allow Notifications" 
          onPress={handleGrant} 
          fullWidth 
          style={styles.grantButton}
        />
        <CustomButton 
          title="Not Now" 
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
