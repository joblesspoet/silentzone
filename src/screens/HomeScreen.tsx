import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { useRealm } from '../database/RealmProvider';
import { PlaceService } from '../database/services/PlaceService';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { RESULTS } from 'react-native-permissions';
import { PlaceCard } from '../components/PlaceCard';
import { StatusCard } from '../components/StatusCard';
import { PermissionsGate } from '../components/PermissionsGate';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { getDistance, formatDistance } from '../utils/geo';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { PreferencesService } from '../database/services/PreferencesService';
import { usePermissions } from '../permissions/PermissionsContext';

interface Props {
  navigation: any;
}

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const realm = useRealm();
  const { locationStatus, backgroundLocationStatus, dndStatus, notificationStatus } = usePermissions();

  const [places, setPlaces] = useState<any[]>([]);
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [activeCount, setActiveCount] = useState(0);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [userLocation, setUserLocation] = useState<{latitude: number; longitude: number} | null>(null);

  const hasFullPermissions = (
    (locationStatus === RESULTS.GRANTED || locationStatus === RESULTS.LIMITED) &&
    (backgroundLocationStatus === RESULTS.GRANTED || backgroundLocationStatus === RESULTS.LIMITED) &&
    dndStatus === RESULTS.GRANTED &&
    notificationStatus === RESULTS.GRANTED
  );

  // Fetch places and set up listener
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
    
    // Auto-pause if no active places on load
    if (initialActive === 0 && isInitialLoad) {
      PreferencesService.updatePreferences(realm, { trackingEnabled: false });
      setIsInitialLoad(false);
    }

    // Listener for places
    const placesListener = (collection: any) => {
      setPlaces([...collection]);
      const currentActive = collection.filter((p: any) => p.isEnabled).length;
      setActiveCount(currentActive);
      
      // If active places drop to 0, force pause tracking
      if (currentActive === 0) {
        PreferencesService.updatePreferences(realm, { trackingEnabled: false });
      }
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
  }, [realm, isInitialLoad]);

  // Location tracking
  useEffect(() => {
    let watchId: number | null = null;

    const startWatching = async () => {
      const hasPermission = await PermissionsManager.hasScanningPermissions();
      if (hasPermission) {
        Geolocation.getCurrentPosition(
            (position) => {
                setUserLocation(position.coords);
            },
            (error) => console.log('Error getting location:', error),
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
        );

        watchId = Geolocation.watchPosition(
          (position) => {
            setUserLocation(position.coords);
          },
          (error) => {
            console.log('Location watch error:', error);
          },
          { 
            enableHighAccuracy: true, 
            distanceFilter: 10, // Update every 10 meters
            interval: 5000, 
            fastestInterval: 2000 
          }
        );
      }
    };

    startWatching();

    return () => {
      if (watchId !== null) {
        Geolocation.clearWatch(watchId);
      }
    };
  }, [hasFullPermissions]);

  const handleToggle = (id: string) => {
    const place = places.find(p => p.id === id);
    const currentlyEnabled = place?.isEnabled;
    
    PlaceService.togglePlaceEnabled(realm, id);
    
    // Auto-resume logic: If we are turning a place ON and tracking is currently OFF
    if (!currentlyEnabled && !trackingEnabled) {
      PreferencesService.updatePreferences(realm, { trackingEnabled: true });
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
    return place.isInside;
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
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.dateText}>{currentDate}</Text>
          <TouchableOpacity 
            style={[
              styles.pauseButton, 
              !trackingEnabled && styles.pauseButtonActive,
              activeCount === 0 && styles.pauseButtonDisabled
            ]}
            onPress={() => {
              if (activeCount > 0) {
                PreferencesService.toggleTracking(realm);
              } else {
                Alert.alert(
                  "No Active Places", 
                  "Please enable at least one place to start tracking."
                );
              }
            }}
            disabled={activeCount === 0}
          >
            <MaterialIcon 
              name={!trackingEnabled ? "play-circle-outline" : "pause-circle-outline"} 
              size={18} 
              color={activeCount === 0 ? theme.colors.text.disabled : theme.colors.primary} 
            />
            <Text style={[
              styles.pauseButtonText,
              activeCount === 0 && styles.pauseButtonTextDisabled
            ]}>
              {!trackingEnabled ? "RESUME TRACKING" : "PAUSE TRACKING"}
            </Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.appTitle}>Silent Zone</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
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
            places.map(place => {
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
                  onToggle={() => handleToggle(place.id)}
                  onDelete={() => handleDelete(place.id, place.name)}
                  onPress={() => {
                    navigation.navigate('PlaceDetail', { placeId: place.id });
                  }}
                  isPaused={!trackingEnabled || !hasFullPermissions}
                />
              );
            })
          )}
        </View>
        
        <View style={{ height: 100 }} /> 
      </ScrollView>

      {/* FAB */}
      {places.length > 0 && canAddPlace && hasFullPermissions && (
        <TouchableOpacity 
          style={styles.fab}
          onPress={() => {
            if (canAddPlace) {
              navigation.navigate('AddPlace');
            } else {
              Alert.alert("Limit Reached", "You can only add up to 3 places on the free plan.");
            }
          }}
          activeOpacity={canAddPlace ? 0.9 : 1}
        >
          <MaterialIcon name="add" size={32} color={theme.colors.white} />
        </TouchableOpacity>
      )}

      {/* Permissions Gate Overlay */}
      {!hasFullPermissions && <PermissionsGate />}
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
    paddingTop: 60, // Safe area
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
  fab: {
    position: 'absolute',
    bottom: 32,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.layout.shadows.large,
    shadowColor: theme.colors.primary,
    shadowOpacity: 0.4,
  },
  fabDisabled: {
    backgroundColor: theme.colors.text.disabled,
    shadowOpacity: 0.1,
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
