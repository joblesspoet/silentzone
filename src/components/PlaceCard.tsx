import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { theme } from '../theme';
import { MaterialIcon } from './MaterialIcon';
import { ToggleSwitch } from './ToggleSwitch';

interface PlaceCardProps {
  id: string;
  name: string;
  icon: string;
  radius: string;
  distance: string;
  isActive: boolean;
  onToggle: (value: boolean) => void;
  onDelete: () => void;
  onPress: () => void;
  isCurrentLocation?: boolean;
  disabled?: boolean;
  isPaused?: boolean;
}

export const PlaceCard: React.FC<PlaceCardProps> = ({
  id,
  name,
  icon,
  radius,
  distance,
  isActive,
  onToggle,
  onDelete,
  onPress,
  isCurrentLocation = false,
  disabled = false,
  isPaused = false,
}) => {
  const renderRightActions = (
    progress: Animated.AnimatedInterpolation<number>,
    dragX: Animated.AnimatedInterpolation<number>
  ) => {
    const scale = dragX.interpolate({
      inputRange: [-100, 0],
      outputRange: [1, 0],
      extrapolate: 'clamp',
    });

    return (
      <TouchableOpacity onPress={onDelete} style={styles.deleteButtonContainer}>
        <Animated.View style={[styles.deleteButton, { transform: [{ scale }] }]}>
          <MaterialIcon name="delete-outline" size={24} color={theme.colors.white} />
          <Text style={styles.deleteText}>Delete</Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const showActive = isActive && !isPaused;

  return (
    <Swipeable renderRightActions={renderRightActions} containerStyle={styles.swipeContainer}>
      <TouchableOpacity 
        onPress={onPress}
        activeOpacity={0.9}
        style={[
          styles.container,
          showActive && styles.activeBorder,
          disabled && styles.disabled,
        ]}
      >
        <View style={styles.content}>
          <View style={[
            styles.iconContainer, 
            showActive ? styles.activeIcon : styles.inactiveIcon,
            (disabled || (isPaused && isActive)) && styles.disabledIcon
          ]}>
            <MaterialIcon 
              name={icon} 
              size={24} 
              color={showActive ? theme.colors.white : (disabled || (isPaused && isActive) ? theme.colors.text.disabled : theme.colors.primary)} 
            />
          </View>
          
          <View style={styles.details}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <View style={styles.infoRow}>
              <MaterialIcon 
                name={(isCurrentLocation && !isPaused) ? "my_location" : "location_on"} 
                size={14} 
                color={(isCurrentLocation && !isPaused) ? theme.colors.success : theme.colors.text.secondary.dark} 
              />
              <Text style={[
                styles.infoText,
                (isCurrentLocation && !isPaused) && { color: theme.colors.success, fontWeight: 'bold' }
              ]}>
                {(isCurrentLocation && !isPaused) ? "Currently inside" : `${radius} radius • ${distance}`}
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
    </Swipeable>
  );
};

const styles = StyleSheet.create({
  swipeContainer: {
    marginBottom: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: theme.colors.error, // Background for delete action
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface.light,
    padding: theme.spacing.lg,
    // Removed marginBottom since it's handled by swipeContainer
    // Borders are handled by parent container clips usually, but preserving logic
  },
  activeBorder: {
    // Optional: Visual indication of active state if needed beyond icon color
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
  deleteButtonContainer: {
    width: 100,
    backgroundColor: theme.colors.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteButton: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  deleteText: {
    color: theme.colors.white,
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.medium,
    marginTop: 4,
  },
});
