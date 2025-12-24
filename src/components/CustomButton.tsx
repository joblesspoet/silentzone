import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle, TextStyle } from 'react-native';
import { theme } from '../theme';
import { MaterialIcon } from './MaterialIcon';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';

interface CustomButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  isLoading?: boolean;
  disabled?: boolean;
  leftIcon?: string;
  rightIcon?: string;
  style?: ViewStyle;
  textStyle?: TextStyle;
  fullWidth?: boolean;
}

export const CustomButton: React.FC<CustomButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  isLoading = false,
  disabled = false,
  leftIcon,
  rightIcon,
  style,
  textStyle: customTextStyle,
  fullWidth = false,
}) => {
  const getBackgroundColor = () => {
    if (disabled) return theme.colors.text.disabled;
    switch (variant) {
      case 'primary': return theme.colors.primary;
      case 'secondary': return theme.colors.secondary;
      case 'outline': return 'transparent';
      case 'ghost': return 'transparent';
      default: return theme.colors.primary;
    }
  };

  const getTextColor = () => {
    if (disabled) return theme.colors.white;
    switch (variant) {
      case 'primary': return theme.colors.white;
      case 'secondary': return theme.colors.white;
      case 'outline': return theme.colors.primary;
      case 'ghost': return theme.colors.primary;
      default: return theme.colors.white;
    }
  };

  const getBorderColor = () => {
    if (disabled) return 'transparent';
    if (variant === 'outline') return theme.colors.primary;
    return 'transparent';
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || isLoading}
      activeOpacity={0.8}
      style={[
        styles.container,
        {
          backgroundColor: getBackgroundColor(),
          borderColor: getBorderColor(),
          borderWidth: variant === 'outline' ? 1 : 0,
          width: fullWidth ? '100%' : 'auto',
          alignSelf: fullWidth ? 'auto' : 'flex-start',
          paddingHorizontal: fullWidth ? 0 : theme.spacing.xl,
        },
        style,
      ]}
    >
      {isLoading ? (
        <ActivityIndicator color={getTextColor()} />
      ) : (
        <>
          {leftIcon && (
            <MaterialIcon 
              name={leftIcon} 
              size={20} 
              color={getTextColor()} 
              style={{ marginRight: theme.spacing.sm }} 
            />
          )}
          <Text
            style={[
              styles.text,
              { color: getTextColor() },
              customTextStyle,
            ]}
          >
            {title}
          </Text>
          {rightIcon && (
            <MaterialIcon 
              name={rightIcon} 
              size={20} 
              color={getTextColor()} 
              style={{ marginLeft: theme.spacing.sm }} 
            />
          )}
        </>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 48, // Standard touch target
    borderRadius: theme.layout.borderRadius.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: theme.spacing.md,
    ...theme.layout.shadows.soft,
  },
  text: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
  },
});
