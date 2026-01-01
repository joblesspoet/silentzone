import React from 'react';
import { createStackNavigator, TransitionPresets } from '@react-navigation/stack';
import { SplashScreen } from '../screens/SplashScreen';
import { OnboardingWelcomeScreen } from '../screens/OnboardingWelcomeScreen';
import { OnboardingAddPlacesScreen } from '../screens/OnboardingAddPlacesScreen';
import { OnboardingAutoSilenceScreen } from '../screens/OnboardingAutoSilenceScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { AddPlaceScreen } from '../screens/AddPlaceScreen';
import { PlaceDetailScreen } from '../screens/PlaceDetailScreen';
import { EditPlaceScreen } from '../screens/EditPlaceScreen';
import { PermissionLocationScreen } from '../screens/PermissionLocationScreen';
import { PermissionNotificationScreen } from '../screens/PermissionNotificationScreen';
import { PermissionDndScreen } from '../screens/PermissionDndScreen';
import { PermissionBatteryScreen } from '../screens/PermissionBatteryScreen';

export type RootStackParamList = {
  Splash: undefined;
  PermissionLocation: undefined;
  PermissionNotification: undefined;
  PermissionDnd: undefined;
  PermissionBattery: undefined;
  OnboardingWelcome: undefined;
  OnboardingAddPlaces: undefined;
  OnboardingAutoSilence: undefined;
  Home: undefined;
  AddPlace: undefined;
  PlaceDetail: { placeId: string };
  EditPlace: { placeId: string };
};

const Stack = createStackNavigator<RootStackParamList>();

export const AppNavigator = () => {
  return (
    <Stack.Navigator
      initialRouteName="Splash"
      screenOptions={{
        headerShown: false,
        ...TransitionPresets.SlideFromRightIOS, // Smooth transitions
      }}
    >
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="PermissionLocation" component={PermissionLocationScreen} />
      <Stack.Screen name="PermissionNotification" component={PermissionNotificationScreen} />
      <Stack.Screen name="PermissionDnd" component={PermissionDndScreen} />
      <Stack.Screen name="PermissionBattery" component={PermissionBatteryScreen} />
      <Stack.Screen name="OnboardingWelcome" component={OnboardingWelcomeScreen} />
      <Stack.Screen name="OnboardingAddPlaces" component={OnboardingAddPlacesScreen} />
      <Stack.Screen name="OnboardingAutoSilence" component={OnboardingAutoSilenceScreen} />
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen 
        name="AddPlace" 
        component={AddPlaceScreen}
        options={{
          ...TransitionPresets.ModalSlideFromBottomIOS, // Modal feel for adding
        }}
      />
      <Stack.Screen name="PlaceDetail" component={PlaceDetailScreen} />
      <Stack.Screen name="EditPlace" component={EditPlaceScreen} />
    </Stack.Navigator>
  );
};
