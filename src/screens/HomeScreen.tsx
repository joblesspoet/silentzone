import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { useRealm } from '../database/RealmProvider';
import { PlaceService } from '../database/services/PlaceService';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { RESULTS } from 'react-native-permissions';
import { PlaceCard } from '../components/PlaceCard';
import { StatusCard } from '../components/StatusCard';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { getDistance, formatDistance } from '../utils/geo';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { PreferencesService } from '../database/services/PreferencesService';
import { usePermissions } from '../permissions/PermissionsContext';

interface Props {
  navigation: any;
}

import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RealmWriteHelper } from '../database/helpers/RealmWriteHelper';
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

  // Deprecated manual check - mapped to context property for compatibility with existing code
  const hasFullPermissions = hasAllPermissions;

  //  Fetch places and set up listener - NO WRITES IN LISTENER
useEffect(() => {
  const placesResult = PlaceService.getAllPlaces(realm);
  const prefs = PreferencesService.getPreferences(realm) as any;
  
  // Set initial states
  setPlaces([...placesResult]);
  const initialActive = placesResult.filter((p: any) => p.isEnabled).length;
  setActiveCount(initialActive);
  
  if (prefs) {
    setTrackingEnabled(prefs.trackingEnabled);
  }

  // Listener for places - ONLY UPDATE UI, DON'T CHANGE TRACKING
  const placesListener = (collection: any) => {
    setPlaces([...collection]);
    const currentActive = collection.filter((p: any) => p.isEnabled).length;
    setActiveCount(currentActive);
  };

  // Listener for preferences
  const prefsListener = (p: any) => {
    setTrackingEnabled(!!p.trackingEnabled);
  };

  placesResult.addListener(placesListener);
  
  if (prefs && typeof prefs.addListener === 'function') {
    prefs.addListener(prefsListener);
  }

  return () => {
    placesResult.removeListener(placesListener);
    if (prefs && typeof prefs.removeListener === 'function') {
      prefs.removeListener(prefsListener);
    }
  };
}, [realm]);

  // Location tracking (UI ONLY)
  // CRITICAL: We don't start a native watch here anymore to avoid conflicts with GPSManager
  useEffect(() => {
    const updateLocationFromManager = () => {
      const loc = gpsManager.getLastKnownLocation();
      if (loc) {
        setUserLocation({ latitude: loc.latitude, longitude: loc.longitude });
      }
    };

    // Initial check
    updateLocationFromManager();

    // Poll every 10 seconds for UI updates from the system watcher
    // This is much safer than starting another native watch
    const interval = setInterval(updateLocationFromManager, 10000);

    return () => clearInterval(interval);
  }, [hasFullPermissions]);

  // Separate effect for auto-pause logic (avoids listener conflicts)
  useEffect(() => {
    if (activeCount === 0 && trackingEnabled && !isInitialLoad) {
      console.log('[HomeScreen] No active places, auto-pausing tracking');
      PreferencesService.deferredUpdatePreferences(realm, {
        trackingEnabled: false,
      });
    }
  }, [activeCount, trackingEnabled, realm, isInitialLoad]);

  const handleToggle = (id: string) => {
  const place = places.find(p => p.id === id);
  const isActive = place?.isInside;
  const currentlyEnabled = place?.isEnabled;
  
  // Block toggling off if currently inside
  //if (isActive && currentlyEnabled) {
  //  Alert.alert(
  //    "Cannot Disable Active Place",
  //    "This location is currently active and silencing your phone. Please exit the area first.",
  //    [{ text: "OK" }]
  //  );
  //  return;
  //}
  
  // Just toggle - LocationService will handle tracking state
  PlaceService.togglePlaceEnabled(realm, id);
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
          onPress: () => {
            PlaceService.deletePlace(realm, id);
          }
        }
      ]
    );
  };

  const getPlaceDistance = (place: any) => {
    // Priority: Use the "official" status from LocationService
    if (place.isInside) {
      return 'Currently inside';
    }

    if (!userLocation) return 'Locating...';
    
    const dist = getDistance(
      userLocation.latitude,
      userLocation.longitude,
      place.latitude,
      place.longitude
    );

    return formatDistance(dist);
  };

  // Determine if specific place is "Current Location" (active)
  const isInsidePlace = (place: any) => {
    // REAL-TIME CHECK: querying CheckInService directly is more reliable 
    // than relying on place.isInside which might be stale or reflect monitoring state.
    const activeCheckIns = CheckInService.getActiveCheckIns(realm);
    return activeCheckIns.some(c => c.placeId === place.id);
  };

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });
  const maxPlaces = 3;
  
  const canAddPlace = places.length < maxPlaces;

  // Render Empty State
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
                PreferencesService.toggleTracking(realm);
              } else {
                Alert.alert(
                  "No Active Places", 
                  "Please enable at least one place to start tracking."
                );
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
                  case 'BACKGROUND_LOCATION': await requestLocationFlow(); break;
                  case 'NOTIFICATION': await requestNotificationFlow(); break;
                  case 'DND': await requestDndFlow(); break;
                  case 'BATTERY': await requestBatteryExemption(); break;
                  case 'ALARM': 
                    // Open settings directly if exact alarm missing
                    navigation.navigate('OnboardingAutoSilenceScreen'); // Or wherever the alarm screen is
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
                const isInside = isInsidePlace(place);
                
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

      {/* FAB */}

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
    paddingTop: 0, // Handled inline (was 60)
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
    fontSize: theme.typography.sizes.sm, // 14
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.text.secondary.light, // Slate 500
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  pauseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primary + '1A', // 10%
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
    borderColor: theme.colors.primary, // Using primary color for the dashed border
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    paddingVertical: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 100, // Consistent with typical card height
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
