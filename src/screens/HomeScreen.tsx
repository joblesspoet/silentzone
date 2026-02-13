import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';

import { useRealm } from '../database/RealmProvider';
import { PlaceService } from '../database/services/PlaceService';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { PlaceCard } from '../components/PlaceCard';
import { StatusCard } from '../components/StatusCard';
import { getDistance, formatDistance } from '../utils/geo';
import { PreferencesService } from '../database/services/PreferencesService';
import { usePermissions } from '../permissions/PermissionsContext';

interface Props {
  navigation: any;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckInService } from '../database/services/CheckInService';
import { PermissionBlock } from '../components/PermissionBlock';
import { locationService } from '../services/LocationService';

import { gpsManager } from '../services/GPSManager';

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const realm = useRealm();
  const insets = useSafeAreaInsets();

  const {
    notificationStatus,
    hasAllPermissions,
    requestLocationFlow,
    requestBackgroundLocationFlow,
    requestNotificationFlow,
    requestDndFlow,
    requestBatteryExemption,
    getFirstMissingPermission
  } = usePermissions();

  const [places, setPlaces] = useState<any[]>([]);
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [activeCount, setActiveCount] = useState(0);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [userLocation, setUserLocation] = useState<{latitude: number; longitude: number} | null>(null);

  const hasFullPermissions = hasAllPermissions;

  // FIX #4: `isInsidePlace()` was calling CheckInService.getActiveCheckIns(realm)
  // inside .map() during render — a fresh Realm query on EVERY render, for EVERY place.
  // This is moved to useMemo so it runs once per `places` change instead of every render.
  //
  // We use `places` as the dependency because Realm writes that affect check-ins will
  // trigger a re-render (via the places Realm listener), which re-runs this memo.
  const activeCheckInIds = useMemo(() => {
    try {
      const activeCheckIns = CheckInService.getActiveCheckIns(realm);
      return new Set(Array.from(activeCheckIns).map((c: any) => c.placeId as string));
    } catch (e) {
      console.error('[HomeScreen] Failed to get active check-ins:', e);
      return new Set<string>();
    }
  }, [places, realm]); // recomputes when places list changes (Realm write → listener fires → setPlaces → re-render)

  // Fetch places and set up listener - NO WRITES IN LISTENER
  useEffect(() => {
    let placesResult: any = null;
    let prefs: any = null;

    try {
      placesResult = PlaceService.getAllPlaces(realm);
      setPlaces([...placesResult]);
      const initialActive = placesResult.filter((p: any) => p.isEnabled).length;
      setActiveCount(initialActive);
    } catch (e) {
      console.error('[HomeScreen] Failed to load places:', e);
    }

    try {
      prefs = PreferencesService.getPreferences(realm);
      if (prefs) {
        setTrackingEnabled(prefs.trackingEnabled);
      }
    } catch (e) {
      console.error('[HomeScreen] Failed to load preferences:', e);
    }

    // FIX #5: `isInitialLoad` was never set to false, permanently disabling the
    // auto-pause logic in the effect below. Mark initial load complete after the
    // first data snapshot is applied.
    setIsInitialLoad(false);

    // Listener for places - ONLY UPDATE UI, DON'T CHANGE TRACKING
    const placesListener = (collection: any) => {
      try {
        setPlaces([...collection]);
        const currentActive = collection.filter((p: any) => p.isEnabled).length;
        setActiveCount(currentActive);
      } catch (e) {
        console.error('[HomeScreen] Places listener error:', e);
      }
    };

    // Listener for preferences
    const prefsListener = (p: any) => {
      try {
        setTrackingEnabled(!!p.trackingEnabled);
      } catch (e) {
        console.error('[HomeScreen] Prefs listener error:', e);
      }
    };

    if (placesResult && typeof placesResult.addListener === 'function') {
      placesResult.addListener(placesListener);
    }

    if (prefs && typeof prefs.addListener === 'function') {
      prefs.addListener(prefsListener);
    }

    return () => {
      if (placesResult && typeof placesResult.removeListener === 'function') {
        placesResult.removeListener(placesListener);
      }
      if (prefs && typeof prefs.removeListener === 'function') {
        prefs.removeListener(prefsListener);
      }
    };
  }, [realm]);

  // Location tracking (UI ONLY)
  // CRITICAL: We don't start a native watch here to avoid conflicts with GPSManager
  useEffect(() => {
    const updateLocationFromManager = () => {
      const loc = gpsManager.getLastKnownLocation();
      if (loc) {
        setUserLocation({ latitude: loc.latitude, longitude: loc.longitude });
      } else if (hasFullPermissions) {
        gpsManager.getImmediateLocation(
          (newLoc) => setUserLocation({ latitude: newLoc.latitude, longitude: newLoc.longitude }),
          () => {}
        );
      }
    };

    updateLocationFromManager();

    const interval = setInterval(updateLocationFromManager, 5000);

    const { AppState } = require('react-native');
    const subscription = AppState.addEventListener('change', (nextState: string) => {
      if (nextState === 'active') {
        updateLocationFromManager();
      }
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [hasFullPermissions]);

  // Separate effect for auto-pause logic (avoids listener conflicts)
  useEffect(() => {
    if (activeCount === 0 && trackingEnabled && !isInitialLoad) {
      console.log('[HomeScreen] No active places, auto-pausing tracking');
      PreferencesService.deferredUpdatePreferences(realm, {
        trackingEnabled: false,
      }).then(() => {
        // ✅ CRITICAL (Event-Driven): Force stop service immediately
        locationService.onGlobalTrackingChanged(false);
      });
    }
  }, [activeCount, trackingEnabled, realm, isInitialLoad]);

  const handleToggle = async (id: string) => {
    const place = places.find(p => p.id === id);
    const currentlyEnabled = place?.isEnabled;

    const success = PlaceService.togglePlaceEnabled(realm, id);
    if (success !== null) {
      // ✅ Event-Driven: Notify place toggle
      await locationService.onPlaceToggled(id, !currentlyEnabled);
    }
  };

  const handleDelete = (id: string, name: string) => {
    Alert.alert(
      `Delete ${name}?`,
      "This will stop monitoring this location and remove it from your list.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            const success = await PlaceService.deletePlace(realm, id);
            if (success) {
              // ✅ Event-Driven: Notify place deletion
              await locationService.onPlaceDeleted(id);
            }
          }
        }
      ]
    );
  };

  const getPlaceDistance = (place: any) => {
    if (place.isInside) return 'Currently inside';
    if (!userLocation) return 'Locating...';

    const dist = getDistance(
      userLocation.latitude,
      userLocation.longitude,
      place.latitude,
      place.longitude
    );
    return formatDistance(dist);
  };

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
  const maxPlaces = 3;
  const canAddPlace = places.length < maxPlaces;

  const renderEmptyState = () => (
    <View style={styles.emptyStateContainer}>
      <View style={styles.emptyIconContainer}>
        <MaterialIcon name="place" size={48} color={theme.colors.primary} />
      </View>
      <Text style={styles.emptyTitle}>No places added yet</Text>
      <Text style={styles.emptySubtitle}>
        Add your favorite locations to automatically silence your phone when you arrive.
      </Text>
      <TouchableOpacity
        style={styles.emptyButton}
        onPress={() => navigation.navigate('AddPlace')}
      >
        <Text style={styles.emptyButtonText}>Add Your First Place</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 10 }]}>
        <View style={styles.headerTop}>
          <Text style={styles.dateText}>{currentDate}</Text>
          <TouchableOpacity
            style={[
              styles.pauseButton,
              (!trackingEnabled || !hasAllPermissions) && styles.pauseButtonActive,
              (activeCount === 0 || !hasAllPermissions) && styles.pauseButtonDisabled
            ]}
            onPress={() => {
              if (!hasAllPermissions) {
                Alert.alert("Action Required", "Please resolve permission issues to manage tracking.");
                return;
              }
              if (activeCount > 0) {
                // Toggle global tracking (read current state first to flip it)
                const newState = !trackingEnabled;
                PreferencesService.toggleTracking(realm);
                // ✅ Event-Driven: Notify global change
                locationService.onGlobalTrackingChanged(newState);
              } else {
                Alert.alert("No Active Places", "Please enable at least one place to start tracking.");
              }
            }}
            disabled={activeCount === 0 || !hasAllPermissions}
          >
            <MaterialIcon
              name={(!trackingEnabled || !hasAllPermissions) ? "play-circle-outline" : "pause-circle-outline"}
              size={18}
              color={(activeCount === 0 || !hasAllPermissions) ? theme.colors.text.disabled : theme.colors.primary}
            />
            <Text style={[
              styles.pauseButtonText,
              (activeCount === 0 || !hasAllPermissions) && styles.pauseButtonTextDisabled
            ]}>
              {(!trackingEnabled || !hasAllPermissions) ? "Resume Tracking" : "Pause Tracking"}
            </Text>
          </TouchableOpacity>
        </View>
        <Text
          style={styles.appTitle}
          onLongPress={() => navigation.navigate('Logs')}
        >Silent Zone</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {!hasAllPermissions && (
          <View style={styles.section}>
            <PermissionBlock
              missingType={getFirstMissingPermission()}
              onPress={async () => {
                const missing = getFirstMissingPermission();
                switch (missing) {
                  case 'LOCATION': await requestLocationFlow(); break;
                  case 'BACKGROUND_LOCATION': await requestBackgroundLocationFlow(); break;
                  case 'NOTIFICATION': await requestNotificationFlow(); break;
                  case 'DND': await requestDndFlow(); break;
                  case 'BATTERY': await requestBatteryExemption(); break;
                  case 'ALARM':
                    navigation.navigate('OnboardingAutoSilenceScreen');
                    break;
                }
              }}
            />
          </View>
        )}

        <View style={styles.section}>
          <StatusCard
            activeCount={activeCount}
            totalCount={places.length}
            isOperational={trackingEnabled && hasFullPermissions}
          />
        </View>

        <View style={styles.placesContainer}>
          <View style={styles.placesHeader}>
            <Text style={styles.placesTitle}>Your Places</Text>
            <Text style={[styles.placesCount, places.length >= maxPlaces && styles.placesCountMax]}>
              {places.length} / {maxPlaces}
            </Text>
          </View>

          {places.length === 0 ? (
            renderEmptyState()
          ) : (
            <View style={!hasAllPermissions && { opacity: 0.5 }}>
              {places.map(place => {
                const distanceText = getPlaceDistance(place);

                // FIX #4: Use the pre-computed Set instead of calling CheckInService on every render
                const isInside = activeCheckInIds.has(place.id);

                return (
                  <PlaceCard
                    key={place.id}
                    id={place.id}
                    name={place.name}
                    icon={place.icon || 'place'}
                    radius={`${place.radius}m`}
                    distance={distanceText}
                    isActive={place.isEnabled}
                    isCurrentLocation={isInside && place.isEnabled && trackingEnabled && hasFullPermissions}
                    onToggle={() => {
                      if (hasAllPermissions) handleToggle(place.id);
                      else Alert.alert("Permissions Required", "Please resolve permission issues to manage places.");
                    }}
                    onDelete={() => {
                      if (hasAllPermissions) handleDelete(place.id, place.name);
                      else Alert.alert("Permissions Required", "Please resolve permission issues to manage places.");
                    }}
                    onPress={() => {
                      if (hasAllPermissions) {
                        navigation.navigate('PlaceDetail', { placeId: place.id });
                      } else {
                        Alert.alert("Permissions Required", "Please resolve permission issues to view details.");
                      }
                    }}
                    isPaused={!trackingEnabled || !hasFullPermissions}
                  />
                );
              })}
            </View>
          )}

          {places.length > 0 && canAddPlace && (
            <TouchableOpacity
              style={styles.addPlaceCard}
              onPress={() => navigation.navigate('AddPlace')}
              activeOpacity={0.7}
            >
              <MaterialIcon name="add-circle-outline" size={24} color={theme.colors.primary} />
              <Text style={styles.addPlaceText}>Add New Place</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background.light,
  },
  header: {
    paddingHorizontal: theme.spacing.xl,
    paddingTop: 0,
    paddingBottom: theme.spacing.md,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  dateText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.text.secondary.light,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pauseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary + '1A',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.layout.borderRadius.full,
  },
  pauseButtonActive: {
    backgroundColor: theme.colors.warning + '20',
  },
  pauseButtonText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary,
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  pauseButtonDisabled: {
    backgroundColor: theme.colors.border.light,
    opacity: 0.6,
  },
  pauseButtonTextDisabled: {
    color: theme.colors.text.disabled,
  },
  appTitle: {
    fontFamily: theme.typography.primary,
    fontSize: 32,
    fontWeight: theme.typography.weights.extrabold,
    color: theme.colors.text.primary.light,
    letterSpacing: -1,
  },
  scrollContent: {
    paddingBottom: theme.spacing.xl,
  },
  section: {
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.xl,
  },
  placesContainer: {
    paddingHorizontal: theme.spacing.xl,
  },
  placesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.lg,
  },
  placesTitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
  },
  placesCount: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.text.secondary.light,
  },
  placesCountMax: {
    color: theme.colors.warning,
  },
  addPlaceCard: {
    marginTop: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.lg,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    paddingVertical: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100,
  },
  addPlaceText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.primary,
    marginLeft: theme.spacing.sm,
  },
  emptyStateContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing.xl,
    marginTop: theme.spacing.xl,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.primary + '1A',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: theme.spacing.lg,
  },
  emptyTitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    marginBottom: theme.spacing.sm,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    color: theme.colors.text.secondary.light,
    textAlign: 'center',
    marginBottom: theme.spacing.xl,
    lineHeight: 24,
  },
  emptyButton: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.full,
    elevation: 2,
  },
  emptyButtonText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.white,
  },
});