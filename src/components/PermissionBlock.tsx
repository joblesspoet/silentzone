import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { theme } from '../theme';
import { MaterialIcon } from './MaterialIcon';

interface PermissionBlockProps {
  missingType: string | null;
  onPress: () => void;
}

export const PermissionBlock: React.FC<PermissionBlockProps> = ({ missingType, onPress }) => {
  const getMessage = () => {
    switch (missingType) {
      case 'LOCATION':
        return 'Location access is required to track your arrival at Silent Zones.';
      case 'NOTIFICATION':
        return 'Notification access is required to keep the background service running reliably.';
      case 'DND':
        return 'Do Not Disturb access is required to automatically silence your phone.';
      case 'BATTERY':
        return 'Battery optimization must be disabled to prevent the system from killing the background service.';
      case 'ALARM':
        return 'Alarm permission is required to wake the app at scheduled times.';
      default:
        return 'Critical permissions are missing. Please tap to resolve.';
    }
  };

  const getTitle = () => {
    switch (missingType) {
      case 'LOCATION': return 'Location Required';
      case 'NOTIFICATION': return 'Notifications Disabled';
      case 'DND': return 'DND Access Required';
      case 'BATTERY': return 'Allow Background Processing';
      case 'ALARM': return 'Alarms Required';
      default: return 'Action Required';
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.iconContainer}>
        <MaterialIcon 
          name={missingType === 'LOCATION' ? 'location-off' : 'warning-amber'} 
          size={32} 
          color={theme.colors.warning} 
        />
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.title}>{getTitle()}</Text>
        <Text style={styles.subtitle}>{getMessage()}</Text>
      </View>
      <TouchableOpacity style={styles.button} onPress={onPress} activeOpacity={0.8}>
        <Text style={styles.buttonText}>Fix Now</Text>
        <MaterialIcon name="chevron-right" size={18} color={theme.colors.white} />
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.warning + '15', // Subtle version of warning
    borderRadius: theme.layout.borderRadius.lg,
    padding: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: theme.colors.warning + '40',
    marginBottom: theme.spacing.xl,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.colors.warning + '20',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  textContainer: {
    flex: 1,
    marginRight: theme.spacing.sm,
  },
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.secondary.light,
    lineHeight: 18,
  },
  button: {
    backgroundColor: theme.colors.warning,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: theme.layout.borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    ...theme.layout.shadows.small,
  },
  buttonText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.white,
    marginRight: 4,
  },
});
