import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { theme } from '../theme';
import { MaterialIcon } from './MaterialIcon';
import { ToggleSwitch } from './ToggleSwitch';

interface PlaceCardProps {
  name: string;
  icon: string;
  radius: string;
  distance: string;
  isActive: boolean;
  onToggle: (value: boolean) => void;
  onPress: () => void;
  isCurrentLocation?: boolean;
  disabled?: boolean;
}

export const PlaceCard: React.FC<PlaceCardProps> = ({
  name,
  icon,
  radius,
  distance,
  isActive,
  onToggle,
  onPress,
  isCurrentLocation = false,
  disabled = false,
}) => {
  return (
    <TouchableOpacity 
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.container,
        isActive && styles.activeBorder,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.content}>
        <View style={[
          styles.iconContainer, 
          isActive ? styles.activeIcon : styles.inactiveIcon,
          disabled && styles.disabledIcon
        ]}>
          <MaterialIcon 
            name={icon} 
            size={24} 
            color={isActive ? theme.colors.white : (disabled ? theme.colors.text.disabled : theme.colors.primary)} 
          />
        </View>
        
        <View style={styles.details}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.infoRow}>
            <MaterialIcon 
              name={isCurrentLocation ? "my_location" : "location_on"} 
              size={14} 
              color={isCurrentLocation ? theme.colors.success : theme.colors.text.secondary.dark} 
            />
            <Text style={[
              styles.infoText,
              isCurrentLocation && { color: theme.colors.success, fontWeight: 'bold' }
            ]}>
              {isCurrentLocation ? "Currently inside" : `${radius} radius • ${distance}`}
            </Text>
          </View>
        </View>
      </View>
      
      <View style={styles.toggleContainer}>
        <ToggleSwitch 
          value={isActive} 
          onValueChange={onToggle}
          disabled={disabled}
        />
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface.light,
    borderRadius: theme.layout.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.layout.shadows.soft,
  },
  activeBorder: {
    borderColor: theme.colors.primary, // Or ring-primary/20
    backgroundColor: theme.colors.surface.light,
  },
  disabled: {
    opacity: 0.8,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: theme.spacing.md,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: theme.layout.borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactiveIcon: {
    backgroundColor: theme.colors.primaryLight + '20', // Opacity 20% approx
  },
  activeIcon: {
    backgroundColor: theme.colors.primary,
  },
  disabledIcon: {
    backgroundColor: theme.colors.border.light,
  },
  details: {
    marginLeft: theme.spacing.lg,
    flex: 1,
  },
  name: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.text.primary.light,
    marginBottom: theme.spacing.xs,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  infoText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.text.secondary.light,
    marginLeft: theme.spacing.xxs,
  },
  toggleContainer: {
    // shrink-0 in logic
  },
});
