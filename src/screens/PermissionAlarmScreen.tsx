import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, AppState, Platform } from 'react-native';
import MaterialIcon from 'react-native-vector-icons/MaterialIcons';
import { theme } from '../theme';
import { CustomButton } from '../components/CustomButton';
import { PermissionsManager } from '../permissions/PermissionsManager';

interface Props {
  navigation: any;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const PermissionAlarmScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [isGranted, setIsGranted] = useState(false);

  useEffect(() => {
    checkStatus();
    const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') checkStatus();
    });
    return () => sub.remove();
  }, []);

  const checkStatus = async () => {
      const granted = await PermissionsManager.checkExactAlarmPermission();
      console.log('Exact alarm permission granted:1234 ', granted);
      setIsGranted(granted);
      if (granted) {
          navigation.replace('PermissionNotification');
      }
  };

  const handleGrant = async () => {
    // Live check first
    const granted = await PermissionsManager.checkExactAlarmPermission();
    console.log('Exact alarm permission granted:', granted);
    if (granted) {
        setIsGranted(true);
        navigation.replace('PermissionNotification');
        return;
    }

    if (Platform.OS === 'android' && Platform.Version >= 31) {
        await PermissionsManager.requestExactAlarmPermission();
    } else {
        navigation.replace('PermissionNotification');
    }
  };

  const handleSkip = () => {
    navigation.replace('PermissionNotification');
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.imageContainer}>
          <View style={styles.iconCircle}>
            <MaterialIcon name="alarm" size={48} color={theme.colors.primary} />
          </View>
          <View style={[styles.ring, styles.ring1]} />
        </View>

        <Text style={styles.title}>Exact Alarms</Text>
        <Text style={styles.description}>
          To ensure your schedules activate exactly on time (especially for prayers), Silent Zone needs permission to set exact alarms.
        </Text>

        <View style={styles.infoBox}>
          <View style={styles.infoRow}>
            <MaterialIcon name="schedule" size={20} color={theme.colors.text.secondary.light} />
            <Text style={styles.infoText}>Guarantees precise start/end times</Text>
          </View>
          <View style={styles.infoRow}>
            <MaterialIcon name="restore" size={20} color={theme.colors.text.secondary.light} />
            <Text style={styles.infoText}>Reliable even after device restart</Text>
          </View>
        </View>

        <Text style={styles.note}>
          This permission might be under "Alarms & reminders" in Settings.
        </Text>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, theme.spacing.xl) }]}>
        <CustomButton 
          title={isGranted ? "Continue" : "Allow Alarms & Reminders"} 
          onPress={handleGrant} 
          fullWidth 
          style={styles.grantButton}
          variant={isGranted ? "primary" : "primary"}
        />
        {!isGranted && (
            <CustomButton 
                title="Maybe Later" 
                onPress={handleSkip} 
                variant="link"
            />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.light,
  },
  scrollContent: {
    flexGrow: 1,
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageContainer: {
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.xl,
    position: 'relative',
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.primary + '1A',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.primary + '33',
  },
  ring1: { width: 120, height: 120 },
  
  title: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xxl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    textAlign: 'center',
    marginBottom: theme.spacing.md,
  },
  description: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.text.secondary.light,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
    lineHeight: 24,
  },
  infoBox: {
    backgroundColor: theme.colors.surface.light,
    padding: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.lg,
    width: '100%',
    marginBottom: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  infoText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.secondary.light,
  },
  note: {
    fontFamily: theme.typography.primary,
    fontSize: 12,
    color: theme.colors.text.secondary.light,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  footer: {
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.white,
  },
  grantButton: {
    marginBottom: theme.spacing.sm,
  },
});
