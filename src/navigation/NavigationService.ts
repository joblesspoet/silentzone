import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './AppNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigate<Name extends keyof RootStackParamList>(
  name: Name,
  params?: RootStackParamList[Name]
) {
  if (navigationRef.isReady()) {
    if (params === undefined) {
      // Call overload with a single argument when no params are required
      navigationRef.navigate(name as any);
    } else {
      // Call overload with route params when provided
      navigationRef.navigate(name as any, params as any);
    }
  }
}