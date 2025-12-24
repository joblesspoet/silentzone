import { Platform } from 'react-native';

export const typography = {
  // Font Families
  primary: Platform.select({
    ios: 'System', // Using system font (SF Pro) for now, can switch to Inter if linked
    android: 'Roboto', // Using system font (Roboto) for now
  }),
  
  // Font Weights
  weights: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    extrabold: '800',
  } as const,
  
  // Font Sizes
  sizes: {
    xxs: 10,
    xs: 12,
    sm: 14,
    md: 16,
    lg: 18,
    xl: 20,
    xxl: 24,
    display: 32,
    displayLg: 36,
    displayXl: 48,
  },
  
  // Line Heights
  lineHeights: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

export const textStyles = {
  h1: {
    fontSize: typography.sizes.display,
    fontWeight: typography.weights.bold,
    lineHeight: typography.sizes.display * typography.lineHeights.tight,
  },
  h2: {
    fontSize: typography.sizes.xxl, // 24
    fontWeight: typography.weights.semibold,
    lineHeight: typography.sizes.xxl * typography.lineHeights.tight,
  },
  h3: {
    fontSize: typography.sizes.xl, // 20
    fontWeight: typography.weights.semibold,
    lineHeight: typography.sizes.xl * typography.lineHeights.tight,
  },
  body: {
    fontSize: typography.sizes.md, // 16
    fontWeight: typography.weights.regular,
    lineHeight: typography.sizes.md * typography.lineHeights.normal,
  },
  subtext: {
    fontSize: typography.sizes.sm, // 14
    fontWeight: typography.weights.regular,
    lineHeight: typography.sizes.sm * typography.lineHeights.normal,
  },
  caption: {
    fontSize: typography.sizes.xs, // 12
    fontWeight: typography.weights.regular,
    lineHeight: typography.sizes.xs * typography.lineHeights.normal,
  },
};
