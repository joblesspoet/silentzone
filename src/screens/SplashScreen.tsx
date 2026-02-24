import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import LinearGradient from 'react-native-linear-gradient';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useRealm } from '../database/RealmProvider';
import { PreferencesService } from '../database/services/PreferencesService';
import { PermissionsManager } from '../permissions/PermissionsManager';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

type SplashScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Splash'
>;

export const SplashScreen = () => {
  const navigation = useNavigation<SplashScreenNavigationProp>();
  const realm = useRealm();
  const insets = useSafeAreaInsets();

  // Animation Values
  const pulseScale = useSharedValue(1);
  const pulseOpacity = useSharedValue(1);
  const loadingDot1 = useSharedValue(0);
  const loadingDot2 = useSharedValue(0);
  const loadingDot3 = useSharedValue(0);
  useEffect(() => {
    // Logo Pulse Animation
    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
    pulseOpacity.value = withRepeat(
      withSequence(
        withTiming(0.9, { duration: 1500 }),
        withTiming(1, { duration: 1500 }),
      ),
      -1,
      true,
    );

    // Loading Dots Animation
    loadingDot1.value = withRepeat(
      withSequence(
        withTiming(-5, { duration: 500 }),
        withTiming(0, { duration: 500 }),
      ),
      -1,
      true,
    );

    setTimeout(() => {
      loadingDot2.value = withRepeat(
        withSequence(
          withTiming(-5, { duration: 500 }),
          withTiming(0, { duration: 500 }),
        ),
        -1,
        true,
      );
    }, 150);

    setTimeout(() => {
      loadingDot3.value = withRepeat(
        withSequence(
          withTiming(-5, { duration: 500 }),
          withTiming(0, { duration: 500 }),
        ),
        -1,
        true,
      );
    }, 300);

    const checkOnboarding = async () => {
      // Minimum splash time of 2 seconds
      await new Promise(resolve => setTimeout(() => resolve(undefined), 2000));

      const prefs = PreferencesService.getPreferences(realm);

      // Android: Check battery optimization once onboarding is done or for returning users
      if (Platform.OS === 'android' && prefs?.onboardingCompleted) {
        const ignoring =
          await PermissionsManager.isBatteryOptimizationEnabled();
        if (!ignoring) {
          // If not ignoring, and we haven't asked recently (optional logic here)
          // For now, let's just proceed to Home, but we might want a middle screen
          // Actually, let's let Home handle the persistent nagging for battery optimization
        }
      }

      console.log(
        '[SplashScreen] Preferences:',
        JSON.stringify({
          onboardingCompleted: prefs?.onboardingCompleted,
          databaseSeeded: prefs?.databaseSeeded,
        }),
      );

      if (prefs && prefs.onboardingCompleted) {
        console.log('[SplashScreen] Navigating to Home (onboarding completed)');
        navigation.replace('Home');
      } else {
        console.log(
          '[SplashScreen] Navigating to OnboardingWelcome (onboarding NOT completed)',
        );
        navigation.replace('OnboardingWelcome');
      }
    };

    checkOnboarding();
  }, [realm]);

  const animatedLogoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOpacity.value,
  }));

  const dot1Style = useAnimatedStyle(() => ({
    transform: [{ translateY: loadingDot1.value }],
  }));
  const dot2Style = useAnimatedStyle(() => ({
    transform: [{ translateY: loadingDot2.value }],
  }));
  const dot3Style = useAnimatedStyle(() => ({
    transform: [{ translateY: loadingDot3.value }],
  }));

  return (
    <View style={styles.container}>
      {/* Background Gradient */}
      <LinearGradient
        colors={['#EFF6FF', '#FFFFFF', '#F0FDFA']} // Light blue to white to light teal
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />

      {/* Decorative Circles */}
      <View style={[styles.decorativeCircle, styles.circleTopRight]} />
      <View style={[styles.decorativeCircle, styles.circleSeeLeft]} />

      <View style={styles.contentContainer}>
        {/* Logo Section */}
        <Animated.View style={[styles.logoContainer, animatedLogoStyle]}>
          <View style={styles.glow} />
          <View style={styles.pinContainer}>
            <MaterialIcon
              name="location-on"
              size={120}
              color={theme.colors.primary}
            />
            <View style={styles.speakerContainer}>
              <MaterialIcon
                name="volume-off"
                size={40}
                color={theme.colors.white}
              />
            </View>
          </View>
        </Animated.View>

        {/* Text Section */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>Silent Zone</Text>
          <Text style={styles.tagline}>
            Auto-silence your phone at important places
          </Text>
        </View>

        {/* Loading Indicator */}
        <View style={styles.loadingContainer}>
          <Animated.View style={[styles.dot, dot1Style]} />
          <Animated.View style={[styles.dot, dot2Style]} />
          <Animated.View style={[styles.dot, dot3Style]} />
        </View>
      </View>

      <View
        style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}
      >
        <Text style={[styles.version, { marginBottom: 4, fontWeight: '600' }]}>
          Developed by Qybrix
        </Text>
        <Text style={styles.version}>v1.2.1</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  decorativeCircle: {
    position: 'absolute',
    borderRadius: 9999,
  },
  circleTopRight: {
    top: -96,
    right: -96,
    width: 384, // 96 * 4
    height: 384,
    backgroundColor: theme.colors.primary + '0D', // 5% opacity
  },
  circleSeeLeft: {
    top: '50%',
    left: -96,
    width: 256,
    height: 256,
    backgroundColor: theme.colors.accent + '20', // ~12% opacity? Guide says teal-200/20
  },
  contentContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    zIndex: 10,
  },
  logoContainer: {
    marginBottom: theme.spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 128,
    height: 128,
    borderRadius: 64,
    backgroundColor: theme.colors.primary + '1A', // 10% opacity
  },
  pinContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  speakerContainer: {
    position: 'absolute',
    top: 28, // Manually positioned to sit inside pin head based on size 120
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.displayXl, // ~48 or sm-5xl ~48
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.text.primary.light,
    marginBottom: theme.spacing.sm,
    letterSpacing: -1,
  },
  tagline: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.regular,
    color: theme.colors.text.secondary.light,
    textAlign: 'center',
    lineHeight: 28,
    maxWidth: 280,
  },
  loadingContainer: {
    flexDirection: 'row',
    gap: 6,
    opacity: 0.6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.primary,
  },
  footer: {
    paddingBottom: 0, // Handled inline
    alignItems: 'center',
    zIndex: 10,
  },
  version: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.secondary.dark, // Slate 400
    fontWeight: '500',
  },
});
