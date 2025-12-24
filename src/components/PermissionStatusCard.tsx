import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { PermissionStatus, RESULTS } from 'react-native-permissions';
import { PermissionsManager } from '../permissions/PermissionsManager';

interface Props {
  title: string;
  icon: string;
  status: PermissionStatus;
  description: string;
  onPress?: () => void;
}

export const PermissionStatusCard: React.FC<Props> = ({ 
  title, 
  icon, 
  status, 
  description,
  onPress 
}) => {
  const isGranted = status === RESULTS.GRANTED || status === RESULTS.LIMITED;
  const isBlocked = status === RESULTS.BLOCKED;

  const handlePress = () => {
    if (onPress) onPress();
    else if (isBlocked) {
      PermissionsManager.openSettings();
    }
  };

  return (
    <TouchableOpacity 
      style={styles.container} 
      onPress={handlePress}
      disabled={isGranted && !onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconContainer, isGranted ? styles.iconGranted : styles.iconDenied]}>
        <MaterialIcon 
          name={isGranted ? 'check' : icon} 
          size={24} 
          color={isGranted ? theme.colors.success : theme.colors.text.secondary.light} 
        />
      </View>
      
      <View style={styles.content}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.description} numberOfLines={2}>
          {isGranted ? 'Active' : description}
        </Text>
      </View>

      <View style={styles.action}>
        {isBlocked ? (
          <Text style={styles.actionText}>Settings</Text>
        ) : !isGranted ? (
          <MaterialIcon name="chevron-right" size={24} color={theme.colors.text.secondary.light} />
        ) : null}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.white,
    padding: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    marginBottom: theme.spacing.md,
    ...theme.layout.shadows.small,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: theme.spacing.md,
  },
  iconGranted: {
    backgroundColor: theme.colors.success + '1A', // 10% opacity
  },
  iconDenied: {
    backgroundColor: theme.colors.background.dark + '0D', // Light grey
  },
  content: {
    flex: 1,
  },
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.text.primary.light,
    marginBottom: 2,
  },
  description: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.secondary.light,
  },
  action: {
    marginLeft: theme.spacing.sm,
  },
  actionText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.primary,
  },
});
