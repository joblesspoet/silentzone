import React from 'react';
import { View, TextInput, StyleSheet, TextInputProps, TouchableOpacity, Text } from 'react-native';
import { theme } from '../theme';
import { MaterialIcon } from './MaterialIcon';

interface CustomInputProps extends TextInputProps {
  label?: string;
  leftIcon?: string;
  rightIcon?: string;
  onRightIconPress?: () => void;
  error?: string;
}

export const CustomInput: React.FC<CustomInputProps> = ({
  label,
  leftIcon,
  rightIcon,
  onRightIconPress,
  error,
  style,
  ...props
}) => {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      
      <View style={[styles.inputContainer, error ? styles.errorBorder : null]}>
        {leftIcon && (
          <View style={styles.leftIcon}>
            <MaterialIcon name={leftIcon} size={20} color={theme.colors.text.secondary.dark} />
          </View>
        )}
        
        <TextInput
          style={[
            styles.input,
            leftIcon ? { paddingLeft: 40 } : null,
            rightIcon ? { paddingRight: 40 } : null,
            style,
          ]}
          placeholderTextColor={theme.colors.text.secondary.light} // Slate 400 approx
          {...props}
        />
        
        {rightIcon && (
          <TouchableOpacity 
            style={styles.rightIcon} 
            onPress={onRightIconPress}
            disabled={!onRightIconPress}
          >
            <MaterialIcon name={rightIcon} size={20} color={theme.colors.text.secondary.dark} />
          </TouchableOpacity>
        )}
      </View>
      
      {error && <Text style={styles.errorText}>{error}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: theme.spacing.lg,
  },
  label: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.text.primary.light,
    marginBottom: theme.spacing.xs,
    textTransform: 'uppercase',
    opacity: 0.8,
  },
  inputContainer: {
    position: 'relative',
    height: 56, // Tall input as per design
    backgroundColor: theme.colors.surface.light,
    borderRadius: theme.layout.borderRadius.lg, // rounded-xl
    borderWidth: 0, // Design uses shadow mainly, maybe remove border or add subtle one
    ...theme.layout.shadows.soft,
    justifyContent: 'center',
  },
  errorBorder: {
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  input: {
    flex: 1,
    height: '100%',
    paddingHorizontal: theme.spacing.lg,
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.text.primary.light,
  },
  leftIcon: {
    position: 'absolute',
    left: theme.spacing.lg,
    zIndex: 1,
  },
  rightIcon: {
    position: 'absolute',
    right: theme.spacing.lg,
    zIndex: 1,
  },
  errorText: {
    marginTop: theme.spacing.xs,
    color: theme.colors.error,
    fontSize: theme.typography.sizes.xs,
    fontFamily: theme.typography.primary,
  },
});
