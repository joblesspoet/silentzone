import React from 'react';
import { Switch, Platform } from 'react-native';
import { theme } from '../theme';

interface ToggleSwitchProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  value,
  onValueChange,
  disabled = false,
}) => {
  return (
    <Switch
      trackColor={{ 
        false: theme.colors.border.light, 
        true: theme.colors.secondary // Green #10B981 
      }}
      thumbColor={Platform.OS === 'android' ? '#FFFFFF' : '#FFFFFF'} 
      ios_backgroundColor={theme.colors.border.light}
      onValueChange={onValueChange}
      value={value}
      disabled={disabled}
      style={Platform.select({
        ios: { transform: [{ scale: 0.8 }] }, // Adjust size to match design if needed
      })}
    />
  );
};
