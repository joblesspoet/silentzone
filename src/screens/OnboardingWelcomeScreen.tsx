import { useRealm } from '../database/RealmProvider';
import { PreferencesService } from '../database/services/PreferencesService';

import React from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, ScrollView, Image } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';

interface Props {
  navigation: any;
}

const { width, height } = Dimensions.get('window');

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const OnboardingWelcomeScreen: React.FC<Props> = ({ navigation }) => {
  const realm = useRealm();
  const insets = useSafeAreaInsets();

  const handleSkip = () => {
    // Skip to the unified permission screen
    navigation.navigate('PermissionRequired');
  };

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={[styles.topBar, { paddingTop: Math.max(insets.top, 20) }]}>
        <TouchableOpacity 
          onPress={handleSkip}
          style={styles.skipButton}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Illustration Area */}
        <View style={styles.illustrationContainer}>
          <View style={styles.decorativeBlob} />
          
          <View style={styles.illustrationCircle}>
            <Image
              source={require('../assets/images/onboarding_welcome.png')}
              style={styles.illustration}
              resizeMode="contain"
            />
          </View>
          
          {/* Floating Icons */}
          <View style={[styles.floatingIcon, styles.iconTopRight]}>
            <MaterialIcon name="volume-off" size={24} color={theme.colors.error} />
          </View>
          <View style={[styles.floatingIcon, styles.iconBottomLeft]}>
            <MaterialIcon name="location-on" size={24} color={theme.colors.primary} />
          </View>
        </View>

        {/* Text Content */}
        <View style={styles.textContainer}>
          <Text style={styles.title}>
            Welcome to <Text style={styles.titleHighlight}>Silent Zone</Text>
          </Text>
          <Text style={styles.subtitle}>
            Never forget to silence your phone again.
          </Text>
        </View>
      </ScrollView>

      {/* Bottom Actions */}
      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
        {/* Page Indicators */}
        <View style={styles.indicators}>
          <View style={[styles.indicator, styles.indicatorActive]} />
          <View style={styles.indicator} />
          <View style={styles.indicator} />
        </View>

        <CustomButton
          title="Get Started"
          onPress={() => {
            navigation.replace('OnboardingAddPlaces');
          }}
          fullWidth
          rightIcon="arrow-forward"
          style={styles.button}
        />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.light,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: 0, // Handled inline
    paddingBottom: theme.spacing.md,
    zIndex: 10,
  },
  skipButton: {
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
  },
  skipText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: 20,
  },
  illustrationContainer: {
    width: width - 48,
    height: (width - 48) * 1.25, // Aspect ratio 4/5
    maxHeight: height * 0.5,
    marginBottom: theme.spacing.xl,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  decorativeBlob: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    backgroundColor: theme.colors.primaryLight + '20', // Opacity
    borderRadius: 9999,
    transform: [{ scale: 0.9 }],
    opacity: 0.6,
  },
  illustrationCircle: {
    width: 280,
    height: 280,
    borderRadius: 140,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface.light,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustration: {
    width: '100%',
    height: '100%',
  },
  floatingIcon: {
    position: 'absolute',
    backgroundColor: theme.colors.surface.light,
    padding: theme.spacing.sm,
    borderRadius: theme.layout.borderRadius.full,
    ...theme.layout.shadows.medium,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  iconTopRight: {
    top: '25%',
    right: theme.spacing.xl,
  },
  iconBottomLeft: {
    bottom: '25%',
    left: theme.spacing.xl,
  },
  textContainer: {
    alignItems: 'center',
    marginTop: theme.spacing.md,
  },
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.display, // 32
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.text.primary.light,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
    letterSpacing: -0.5,
  },
  titleHighlight: {
    color: theme.colors.primary,
  },
  subtitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.lg,
    color: theme.colors.text.secondary.light,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 28,
  },
  footer: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: 0, // Handled inline
    paddingTop: theme.spacing.lg,
    backgroundColor: theme.colors.background.light,
  },
  indicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  indicator: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.border.light, // Slate 200
  },
  indicatorActive: {
    width: 32,
    backgroundColor: theme.colors.primary,
  },
  button: {
    borderRadius: theme.layout.borderRadius.lg,
    height: 56, // Taller button
  },
});
