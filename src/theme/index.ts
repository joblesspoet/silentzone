import { colors } from './colors';
import { typography, textStyles } from './typography';
import { spacing, layout } from './spacing';

export const theme = {
  colors,
  typography,
  textStyles,
  spacing,
  layout,
};

export type Theme = typeof theme;
