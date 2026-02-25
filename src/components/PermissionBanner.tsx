import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';

interface PermissionBannerProps {
  missingType: string | null;
  onPress: () => void;
}

export const PermissionBanner: React.FC<PermissionBannerProps> = ({ missingType, onPress }) => {
  if (!missingType) return null;

  const getLabel = () => {
    switch (missingType) {
      case 'LOCATION': return 'Location Access';
      case 'BACKGROUND_LOCATION': return 'Background Location';
      case 'NOTIFICATION': return 'Notifications';
      case 'DND': return 'Do Not Disturb';
      case 'BATTERY': return 'Battery Exemption';
      case 'ALARM': return 'Exact Alarms';
      case 'ACTIVITY_RECOGNITION': return 'Activity Recognition';
      default: return 'Required Permission';
    }
  };

  return (
    <TouchableOpacity 
      style={styles.container} 
      onPress={onPress}
      activeOpacity={0.9}
    >
      <View style={styles.iconContainer}>
        <MaterialIcon name="warning" size={20} color={theme.colors.error} />
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>Action Required</Text>
        <Text style={styles.subtitle}>
          Tap to fix <Text style={styles.missingLabel}>{getLabel()}</Text> for automatic silencing.
        </Text>
      </View>
      <MaterialIcon name="chevron-right" size={24} color={theme.colors.text.secondary.light} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2', // Very light red
    padding: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.error + '20', // Subtle red border
    marginBottom: theme.spacing.md,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.error + '10',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  content: {
    flex: 1,
  },
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.error,
    marginBottom: 2,
  },
  subtitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.text.secondary.light,
    lineHeight: 16,
  },
  missingLabel: {
    fontWeight: 'bold',
    color: theme.colors.text.primary.light,
  },
});
