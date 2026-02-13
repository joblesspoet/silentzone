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

export const OnboardingAutoSilenceScreen: React.FC<Props> = ({ navigation }) => {
  const realm = useRealm();
  const insets = useSafeAreaInsets();

  const handleFinish = () => {
    // Don't mark onboarding complete yet - that happens after permissions
    navigation.replace('PermissionRequired');
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity 
          onPress={handleFinish} // Skip also finishes
          style={styles.skipButton}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Decorative background blurs */}
        <View style={styles.bgBlurRight} />
        <View style={styles.bgBlurLeft} />

        <View style={styles.illustrationWrap}>
          <View style={styles.circleOuter} />
          <View style={styles.circleMiddle} />
          <View style={[styles.circleInner, { overflow: 'hidden' }]}>
            <Image
              source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuC7ybbHJrwb1dHVi2Mh7LQAQL1o8WIZMuQbmEwwGRfGOo_9ScMS11QXHoJ3hcji1J6Pu_9rJhYkFqy09Y2_RFgwGfXjLYQUbmrbdnyw92fBPhDLhSif8rr3rMCwU6hO7U00hwjQS4Q2VDbjDWOfHWkGofHRU02N32dMvpHr_shvkUG4nAPY_mTae5Nxa9DdoEZF6B60cvR3NBc6NV6w55zCOzxE3SqZUAfCbKDTWpDk6kInIQMnUA9YGCQLXK7TcNYansHSe4ddUu5J' }}
              style={styles.illustration}
              resizeMode="contain"
            />
          </View>

          <View style={styles.iconRight}>
            <MaterialIcon name="notifications-off" size={24} color={theme.colors.primary} />
          </View>
          <View style={styles.iconLeft}>
            <MaterialIcon name="location-on" size={20} color={theme.colors.secondary} />
          </View>
        </View>

        <View style={styles.textContainer}>
          <Text style={styles.title}>
            Automatic Silencing
          </Text>
          <Text style={styles.subtitle}>
            Your phone silences when you enter and restores when you leave.
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
        <View style={styles.indicators}>
          <View style={styles.indicator} />
          <View style={styles.indicator} />
          <View style={[styles.indicator, styles.indicatorActive]} />
        </View>

        <CustomButton
          title="Let's Begin"
          onPress={handleFinish}
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
    backgroundColor: theme.colors.white,
    overflow: 'hidden',
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
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.secondary.light,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: 20,
    paddingTop: 40,
  },
  bgBlurRight: {
    position: 'absolute',
    top: 0,
    right: -80,
    width: width * 1.2,
    height: width * 1.2,
    borderRadius: 9999,
    backgroundColor: theme.colors.primary + '10', // 10%
    opacity: 0.6,
  },
  bgBlurLeft: {
    position: 'absolute',
    top: '30%',
    left: -80,
    width: width,
    height: width,
    borderRadius: 9999,
    backgroundColor: theme.colors.secondary + '10',
    opacity: 0.5,
  },
  illustrationWrap: {
    width: 320,
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xxl,
    position: 'relative',
  },
  circleOuter: {
    position: 'absolute',
    inset: 0,
    borderRadius: 9999,
    borderColor: theme.colors.primary + '1A', // 10%
    borderWidth: 1,
  },
  circleMiddle: {
    position: 'absolute',
    inset: 16,
    borderRadius: 9999,
    borderColor: theme.colors.secondary + '4D', // 30%
    borderWidth: 1,
  },
  circleInner: {
    position: 'absolute',
    inset: 32,
    borderRadius: 9999,
    borderColor: theme.colors.primary + '4D', // 30%
    borderWidth: 1,
  },
  illustration: {
    width: '100%',
    height: '100%',
    zIndex: 20,
  },
  iconRight: {
    position: 'absolute',
    right: -8,
    top: 40,
    backgroundColor: theme.colors.white,
    padding: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.layout.shadows.medium,
    zIndex: 30,
  },
  iconLeft: {
    position: 'absolute',
    left: -8,
    bottom: 40,
    backgroundColor: theme.colors.white,
    padding: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.layout.shadows.medium,
    zIndex: 30,
  },
  textContainer: {
    alignItems: 'center',
    zIndex: 10,
  },
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.display,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  subtitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.text.secondary.light,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 24,
  },
  footer: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: 0, // Handled inline
    paddingTop: theme.spacing.xs,
    backgroundColor: 'transparent',
  },
  indicators: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xl,
  },
  indicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.border.light,
  },
  indicatorActive: {
    width: 32,
    backgroundColor: theme.colors.primary,
  },
  button: {
    borderRadius: theme.layout.borderRadius.lg,
    height: 56,
  },
});
