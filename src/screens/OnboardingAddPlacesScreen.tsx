import React from 'react';
import { View, Text, StyleSheet, Image, ScrollView, Dimensions, TouchableOpacity } from 'react-native';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { CustomButton } from '../components/CustomButton';

interface Props {
  navigation: any;
}

const { width, height } = Dimensions.get('window');

export const OnboardingAddPlacesScreen: React.FC<Props> = ({ navigation }) => {
  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity 
          onPress={() => {
            navigation.replace('Home');
          }}
          style={styles.skipButton}
        >
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.illustrationContainer}>
          <Image
            source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuCQCuN5J9sAiZh2InbxTIhWif7s4UNAjCGI0MDBGhIEqWQMdogqhMxRpeTs0Grmnh1s46y8fp6lcOlD4CvhJEBWWu-lf1LSus65Ui8ru5jYyWStcfsAhmscNwO-PXt7zqE2_NHHKV5lqZFQjwYBzPrL6Pv107kQuhsU83u-VgadiyOqjgLNAlJQ_ZXme1ybFI3sKt_m11rslh9bht87vhbwSGll2x6feufaBMiVdsEGP3aeNezLNtq6YnOTPDdZRg1Dshk64QtKvXA0' }}
            style={styles.illustration}
            resizeMode="cover"
          />
          <View style={styles.overlay} />

          {/* Floating Markers */}
          {/* Mosque */}
          <View style={[styles.markerContainer, { top: '25%', left: '20%' }]}>
            <View style={[styles.markerRing, styles.markerRingPulse]} />
            <View style={styles.markerBg} />
            <View style={[styles.markerIcon, { backgroundColor: theme.colors.white }]}>
               <MaterialIcon name="mosque" size={22} color={theme.colors.primary} />
            </View>
          </View>

          {/* Business */}
          <View style={[styles.markerContainer, { top: '45%', right: '20%' }]}>
            <View style={[styles.markerRing, { width: 80, height: 80, borderColor: theme.colors.primaryLight }]} />
            <View style={[styles.markerIcon, { backgroundColor: theme.colors.primary }]}>
               <MaterialIcon name="business-center" size={24} color={theme.colors.white} />
            </View>
          </View>

          {/* School */}
          <View style={[styles.markerContainer, { bottom: '20%', left: '30%' }]}>
            <View style={[styles.markerIcon, { backgroundColor: theme.colors.white }]}>
               <MaterialIcon name="school" size={22} color={theme.colors.primary} />
            </View>
          </View>

          {/* Notification Toast */}
          <View style={styles.toast}>
            <View style={styles.toastIcon}>
              <MaterialIcon name="notifications-off" size={20} color={theme.colors.secondary} />
            </View>
            <View>
              <Text style={styles.toastTitle}>Phone Silenced</Text>
              <Text style={styles.toastSubtitle}>Entering silent zone radius</Text>
            </View>
            <View style={styles.toastDot} />
          </View>
        </View>

        <View style={styles.textContainer}>
          <Text style={styles.title}>
            Add Your{'\n'}Important Places
          </Text>
          <Text style={styles.subtitle}>
            Mosque, office, school — add up to 3 locations where silence matters.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.indicators}>
          <View style={styles.indicator} />
          <View style={[styles.indicator, styles.indicatorActive]} />
          <View style={styles.indicator} />
        </View>

        <CustomButton
          title="Next"
          onPress={() => {
            navigation.navigate('OnboardingAutoSilence');
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
    backgroundColor: theme.colors.white,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: theme.spacing.xl,
    paddingTop: 60,
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
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.text.secondary.dark,
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
    height: 420,
    maxHeight: height * 0.5,
    marginBottom: theme.spacing.xl,
    borderRadius: theme.layout.borderRadius.xxl,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#F0F9FF',
    borderWidth: 1,
    borderColor: '#EFF6FF',
    ...theme.layout.shadows.soft,
  },
  illustration: {
    width: '100%',
    height: '100%',
    opacity: 0.3,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  markerContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerRing: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    opacity: 0.6,
  },
  markerRingPulse: {
    // Animation would go here
  },
  markerBg: {
    position: 'absolute',
    width: 80, // Blur bg size
    height: 80,
    backgroundColor: theme.colors.primary + '1A',
    borderRadius: 40,
  },
  markerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.layout.shadows.medium,
    zIndex: 10,
  },
  toast: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 14,
    borderRadius: theme.layout.borderRadius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.layout.shadows.soft,
  },
  toastIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: theme.colors.secondary + '10', // Green-50
    alignItems: 'center',
    justifyContent: 'center',
  },
  toastTitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
  },
  toastSubtitle: {
    fontFamily: theme.typography.primary,
    fontSize: 11,
    color: theme.colors.text.secondary.light,
    fontWeight: theme.typography.weights.medium,
  },
  toastDot: {
    marginLeft: 'auto',
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.secondary,
  },
  textContainer: {
    alignItems: 'center',
  },
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.display, // 30 in HTML
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.text.primary.light,
    textAlign: 'center',
    lineHeight: 36,
    marginBottom: theme.spacing.md,
  },
  subtitle: {
    fontFamily: theme.typography.primary,
    fontSize: 15,
    color: theme.colors.text.secondary.light,
    textAlign: 'center',
    lineHeight: 24,
  },
  footer: {
    paddingHorizontal: theme.spacing.xl,
    paddingBottom: 48,
    paddingTop: theme.spacing.xs,
    backgroundColor: theme.colors.white,
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
