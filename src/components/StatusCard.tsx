import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { theme } from '../theme';
import { MaterialIcon } from './MaterialIcon';

interface StatusCardProps {
  activeCount: number;
  totalCount: number;
  isOperational: boolean;
}

export const StatusCard: React.FC<StatusCardProps> = ({
  activeCount,
  totalCount,
  isOperational,
}) => {
  const percentage = totalCount > 0 ? (activeCount / totalCount) * 100 : 0;
  // Circle circumference logic for SVG. Radius 16 -> C = 2 * PI * 16 ~= 100
  // Standard SVG viewBox usually 0 0 36 36 per the HTML path d values
  // M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831
  // Circumference is approx 100 on that path.
  
  return (
    <View style={styles.container}>
      {/* Decorative Background Elements could be added here as absolute views */}
      <View style={styles.decorativeCircle} />
      
      <View style={styles.content}>
        <View style={styles.statusRow}>
          <View style={styles.indicatorContainer}>
            <View style={[styles.indicatorDot, isOperational ? { backgroundColor: theme.colors.success } : { backgroundColor: theme.colors.error }]} />
            <View style={[styles.indicatorPing, isOperational ? { backgroundColor: theme.colors.success } : { backgroundColor: theme.colors.error }]} />
          </View>
          <Text style={styles.statusText}>
            {isOperational ? 'SYSTEM OPERATIONAL' : 'SYSTEM PAUSED'}
          </Text>
        </View>
        
        <Text style={styles.mainText}>Monitoring Active</Text>
        <Text style={styles.subText}>Active Places: {activeCount} of {totalCount}</Text>
      </View>
      
      <View style={styles.chartContainer}>
        <View style={styles.chartWrapper}>
          <Svg height="56" width="56" viewBox="0 0 36 36" style={{ transform: [{ rotate: '-90deg' }] }}>
            <Path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke={theme.colors.border.light}
              strokeWidth="4"
            />
            <Path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke={theme.colors.primary}
              strokeWidth="4"
              strokeDasharray={`${percentage}, 100`}
              strokeLinecap="round"
            />
          </Svg>
          <View style={styles.chartIcon}>
            <MaterialIcon name="radar" size={24} color={theme.colors.primary} />
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.surface.light,
    borderRadius: theme.layout.borderRadius.lg,
    padding: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.layout.shadows.medium,
  },
  decorativeCircle: {
    position: 'absolute',
    right: -24,
    top: -24,
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.colors.primary + '10', // 10% opacity roughly
  },
  content: {
    flex: 1,
    zIndex: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  indicatorContainer: {
    width: 12,
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.sm,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    zIndex: 2,
  },
  indicatorPing: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    opacity: 0.4,
  },
  statusText: {
    fontFamily: theme.typography.primary,
    fontWeight: theme.typography.weights.bold,
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.success,
    letterSpacing: 0.5,
  },
  mainText: {
    fontFamily: theme.typography.primary,
    fontWeight: theme.typography.weights.bold,
    fontSize: theme.typography.sizes.xl,
    color: theme.colors.text.primary.light,
    marginBottom: 2,
  },
  subText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.secondary.light,
    fontWeight: theme.typography.weights.medium,
  },
  chartContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: theme.spacing.lg,
    zIndex: 1,
  },
  chartWrapper: {
    width: 56,
    height: 56,
    position: 'relative',
  },
  chartIcon: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
