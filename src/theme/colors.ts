export const colors = {
  // Brand Colors
  primary: '#2563EB', // Deep Blue
  primaryDark: '#1D4ED8',
  primaryLight: '#60A5FA',
  
  secondary: '#10B981', // Soft Green
  secondaryDark: '#059669',
  secondaryLight: '#34D399',
  
  accent: '#06B6D4', // Teal
  
  // Status Colors
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
  
  // Neutral Colors
  white: '#FFFFFF',
  black: '#000000',
  
  // Background Colors
  background: {
    light: '#F3F4F6',
    dark: '#101922', // Matching the HTML example for dark mode
  },
  
  // Surface Colors
  surface: {
    light: '#FFFFFF',
    dark: '#1E2936',
  },
  
  // Text Colors
  text: {
    primary: {
      light: '#0F172A', // Slate 900
      dark: '#F8FAFC', // Slate 50
    },
    secondary: {
      light: '#64748B', // Slate 500
      dark: '#94A3B8', // Slate 400
    },
    disabled: '#9CA3AF',
  },
  
  // Border Colors
  border: {
    light: '#E2E8F0', // Slate 200
    dark: '#334155', // Slate 700
  },
} as const;
