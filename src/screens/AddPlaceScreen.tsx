import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { CustomInput } from '../components/CustomInput';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { useRealm } from '../database/RealmProvider';
import { PlaceService } from '../database/services/PlaceService'; // Fixed import path
import { PermissionsManager } from '../permissions/PermissionsManager';
import { RESULTS } from 'react-native-permissions';

interface Props {
  navigation: any;
}

const { width, height } = Dimensions.get('window');

// Default location (San Francisco)
const DEFAULT_REGION = {
  latitude: 37.78825,
  longitude: -122.4324,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

export const AddPlaceScreen: React.FC<Props> = ({ navigation }) => {
  const realm = useRealm();
  const mapRef = useRef<MapView>(null);
  
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [placeName, setPlaceName] = useState('');
  const [radius, setRadius] = useState(150);
  const [isSilencingEnabled, setIsSilencingEnabled] = useState(true);
  
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [userLocation, setUserLocation] = useState<{latitude: number, longitude: number} | null>(null);

  useEffect(() => {
    checkPermission();
  }, []);

  const checkPermission = async () => {
    const status = await PermissionsManager.getLocationStatus();
    if (status === RESULTS.GRANTED) {
      setHasLocationPermission(true);
    }
  };

  const handleRequestPermission = async () => {
    const status = await PermissionsManager.requestLocationWhenInUse();
    if (status === RESULTS.GRANTED) {
      setHasLocationPermission(true);
    } else {
      Alert.alert(
        "Permission Required",
        "Location permission is needed to find your current location.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => PermissionsManager.openSettings() }
        ]
      );
    }
  };

  const handleGetCurrentLocation = async () => {
    if (!hasLocationPermission) {
      await handleRequestPermission();
      return;
    }

    if (userLocation) {
      const newRegion = {
        ...region,
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
      };
      setRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
    } else {
      Alert.alert("Location not available", "Waiting for location signal...");
    }
  };

  const handleSave = () => {
    if (!placeName.trim()) {
      Alert.alert("Error", "Please enter a place name");
      return;
    }

    try {
      PlaceService.createPlace(realm, {
        name: placeName.trim(),
        latitude: region.latitude,
        longitude: region.longitude,
        radius: radius,
      });

      // Show success feedback? Or just go back
      navigation.goBack();
    } catch (error) {
      console.error("Failed to save place:", error);
      Alert.alert("Error", "Failed to save place. Please try again.");
    }
  };

  // Format radius text
  const getRadiusText = (r: number) => {
    return r >= 1000 ? `${(r / 1000).toFixed(1)}km` : `${Math.round(r)}m`;
  };

  return (
    <View style={styles.container}>
      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcon name="arrow-back-ios" size={20} color={theme.colors.text.primary.light} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Add Place</Text>
        <TouchableOpacity 
          onPress={handleSave}
          style={styles.saveButton}
        >
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      {/* Map Section */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE} // Use Google Maps if available
          style={styles.map}
          initialRegion={DEFAULT_REGION}
          region={region} // Control region state
          onRegionChangeComplete={setRegion}
          showsUserLocation={hasLocationPermission}
          onUserLocationChange={(e) => {
             // Only update if coordinate exists
             if (e.nativeEvent.coordinate) {
               setUserLocation(e.nativeEvent.coordinate);
             }
          }}
        >
          {/* Visual Circle Overlay */}
          <Circle 
            center={region}
            radius={radius}
            fillColor={theme.colors.primary + '33'} // 20% opacity
            strokeColor={theme.colors.primary}
            strokeWidth={2}
          />
        </MapView>
        
        {/* Map Overlays */}
        <View style={styles.mapOverlayGradient} />
        
        {/* Center Pin */}
        <View style={styles.centerPinContainer}>
           <View style={styles.pinShadow} />
           <MaterialIcon name="location-on" size={48} color={theme.colors.primary} />
        </View>

        {/* Map Controls */}
        <View style={styles.mapControls}>
          <TouchableOpacity 
            style={styles.myLocationButton}
            onPress={handleGetCurrentLocation}
          >
            <MaterialIcon 
              name="my-location" 
              size={24} 
              color={hasLocationPermission ? theme.colors.primary : theme.colors.text.secondary.dark} 
            />
          </TouchableOpacity>
        </View>
      </View>

      {/* Form Section */}
      <View style={styles.formContainer}>
        <ScrollView contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false}>
          
          <CustomInput
            label="Place Name"
            placeholder="e.g., Downtown Mosque"
            value={placeName}
            onChangeText={setPlaceName}
            leftIcon="edit-location"
          />

          {/* Radius Slider */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>SILENCE RADIUS</Text>
              <View style={styles.radiusBadge}>
                <Text style={styles.radiusValue}>{getRadiusText(radius)}</Text>
              </View>
            </View>
            
            <View style={styles.sliderContainer}>
              <Slider
                style={{ width: '100%', height: 40 }}
                minimumValue={30}
                maximumValue={500}
                step={10}
                value={radius}
                onValueChange={setRadius}
                minimumTrackTintColor={theme.colors.primary}
                maximumTrackTintColor={theme.colors.border.light}
                thumbTintColor={theme.colors.white}
              />
              <View style={styles.sliderLabels}>
                <Text style={styles.sliderLabelText}>30m</Text>
                <Text style={styles.sliderLabelText}>500m</Text>
              </View>
            </View>
          </View>

          {/* Location Details */}
          <View style={styles.card}>
            <View>
              <Text style={styles.cardLabel}>Current Coordinates</Text>
              <View style={styles.coordinatesRow}>
                <MaterialIcon name="public" size={18} color={theme.colors.text.secondary.dark} />
                <Text style={styles.coordinatesText}>
                  {region.latitude.toFixed(4)}° N, {region.longitude.toFixed(4)}° W
                </Text>
              </View>
            </View>
            <TouchableOpacity 
              style={styles.updateButton}
              onPress={handleGetCurrentLocation}
            >
              <MaterialIcon name="near-me" size={16} color={theme.colors.primary} />
              <Text style={styles.updateButtonText}>Update</Text>
            </TouchableOpacity>
          </View>

          {/* Toggle Switch */}
          <View style={styles.card}>
            <View>
              <Text style={styles.cardTitle}>Enable Silencing</Text>
              <Text style={styles.cardSubtitle}>Automatically silence when entering</Text>
            </View>
            <ToggleSwitch
              value={isSilencingEnabled}
              onValueChange={setIsSilencingEnabled}
            />
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingTop: 50, // Safe area
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.background.light,
    zIndex: 10,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
  },
  saveButton: {
    padding: 8,
  },
  saveText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary,
  },
  mapContainer: {
    width: '100%',
    height: height * 0.4, // 40% height
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  mapOverlayGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    // Linear gradient simulation if library issues, else use library
    // For simplicity using transparent view or could import LinearGradient
  },
  centerPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -24, // Half of size 48
    marginTop: -48, // Full height to putting tip at center
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinShadow: {
    position: 'absolute',
    bottom: 2,
    width: 16,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  mapControls: {
    position: 'absolute',
    bottom: 24,
    right: 16,
  },
  myLocationButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: theme.colors.surface.light,
    alignItems: 'center',
    justifyContent: 'center',
    ...theme.layout.shadows.medium,
  },
  formContainer: {
    flex: 1,
    backgroundColor: theme.colors.background.light,
    borderTopLeftRadius: theme.layout.borderRadius.lg,
    borderTopRightRadius: theme.layout.borderRadius.lg,
    marginTop: -16,
    ...theme.layout.shadows.large,
  },
  formContent: {
    padding: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
  },
  section: {
    marginBottom: theme.spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: theme.spacing.md,
  },
  sectionLabel: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.text.primary.light,
    opacity: 0.8,
  },
  radiusBadge: {
    backgroundColor: theme.colors.primary + '1A', // 10%
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    borderRadius: theme.layout.borderRadius.sm,
  },
  radiusValue: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary,
  },
  sliderContainer: {
    height: 60,
    justifyContent: 'center',
  },
  sliderLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: -8,
  },
  sliderLabelText: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.text.secondary.light,
    fontWeight: theme.typography.weights.medium,
  },
  card: {
    backgroundColor: theme.colors.surface.light,
    borderRadius: theme.layout.borderRadius.lg,
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.layout.shadows.soft,
  },
  cardLabel: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.text.secondary.light,
    fontWeight: theme.typography.weights.medium,
    marginBottom: 4,
  },
  coordinatesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  coordinatesText: {
    fontFamily: 'Courier', // Monospace feel
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.primary.light,
  },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.colors.primary + '1A',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: theme.layout.borderRadius.md,
  },
  updateButtonText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary,
  },
  cardTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.text.primary.light,
  },
  cardSubtitle: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.text.secondary.light,
  },
});
