import React from 'react';
import Icon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';

interface MaterialIconProps {
  name: string;
  size?: number;
  color?: string;
  style?: any;
}

export const MaterialIcon: React.FC<MaterialIconProps> = ({
  name,
  size = 24,
  color = theme.colors.text.primary.light,
  style,
}) => {
  return <Icon name={name} size={size} color={color} style={style} />;
};
