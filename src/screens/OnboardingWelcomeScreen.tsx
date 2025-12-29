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

export const OnboardingWelcomeScreen: React.FC<Props> = ({ navigation }) => {
  const realm = useRealm();

  const handleSkip = () => {
    // Skip to the last onboarding screen, which will then go to permissions
    navigation.navigate('OnboardingAutoSilence');
  };

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
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
          
          <Image
            source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBLoUFCyPJJb6RljhzckGUZPloj6FFMQNVG8CCTA1VMbFIM91zfl2PzR_h2JjWLVt999Doqub2nDmHSEyA_8693EGSqf9C5s0JEOOGjHBXXVjoxQqnsNzqZM6akRZl4qHDnM8JUJDmjAMdnckrSJLkmPN4lIXF3oLx2AI3ae2C5HdgJF4rxg4T_MrHTCdnGL6VcNM7QrQDop_2tgE_akWHjA9biq9Y9colC_oCwyn9Qryo4qQiB2I12FgyS8BoRYlqZ9VpsdCyOjhKM' }}
            style={styles.illustration}
            resizeMode="contain"
          />
          
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
      <View style={styles.footer}>
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
    paddingTop: 60, // Safe area approx
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
    paddingBottom: 48, // Safe area
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
