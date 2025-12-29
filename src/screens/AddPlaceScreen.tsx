import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import Geolocation from '@react-native-community/geolocation';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { CustomInput } from '../components/CustomInput';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { useRealm } from '../database/RealmProvider';
import { PlaceService } from '../database/services/PlaceService';
import { PreferencesService } from '../database/services/PreferencesService';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { usePermissions } from '../permissions/PermissionsContext';
import { RESULTS } from 'react-native-permissions';
import DateTimePicker from '@react-native-community/datetimepicker';

interface ScheduleSlot {
  id: string;
  startTime: string;
  endTime: string;
  days: string[];
  label: string;
}

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

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const AddPlaceScreen: React.FC<Props> = ({ navigation }) => {
  const realm = useRealm();
  const { locationStatus, backgroundLocationStatus, dndStatus, refreshPermissions } = usePermissions();
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [placeName, setPlaceName] = useState('');
  const [radius, setRadius] = useState(150);
  const [isSilencingEnabled, setIsSilencingEnabled] = useState(true);
  
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [userLocation, setUserLocation] = useState<{latitude: number, longitude: number} | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState({ id: 'mosque', icon: 'mosque', label: 'Mosque' });
  
  // Schedule state
  const [isScheduleEnabled, setIsScheduleEnabled] = useState(false);
  const [schedules, setSchedules] = useState<ScheduleSlot[]>([]);
  const [showPicker, setShowPicker] = useState<{ index: number, type: 'start' | 'end' } | null>(null);

  const CATEGORIES = [
    { id: 'mosque', icon: 'mosque', label: 'Mosque' },
    { id: 'office', icon: 'business-center', label: 'Office' },
    { id: 'school', icon: 'school', label: 'School' },
    { id: 'other', icon: 'place', label: 'Other' },
  ];

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

    try {
        // Check if GPS is enabled first
        const gpsEnabled = await PermissionsManager.isGpsEnabled();
        if (!gpsEnabled) {
          Alert.alert(
            "GPS Disabled",
            "Please enable location services (GPS) to find your current location.",
            [{ text: "OK" }]
          );
          return;
        }

        Geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                setAccuracy(accuracy);
                setUserLocation({ latitude, longitude });
                
                const newRegion = {
                    ...region,
                    latitude,
                    longitude,
                };
                setRegion(newRegion);
                mapRef.current?.animateToRegion(newRegion, 1000);
            },
            (error) => {
                Alert.alert("Error", "Could not fetch location.");
                console.log(error);
            },
            { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
        );
    } catch (err) {
        console.warn(err);
    }
  };

  const handleSave = async () => {
    // Check all permissions first
    const hasFullPermissions = await PermissionsManager.hasScanningPermissions();
    
    if (!hasFullPermissions) {
      Alert.alert(
        "Permissions Required",
        "Silent Zone needs Location (Always), Notifications, and Do Not Disturb access to work correctly. Please grant these permissions in Settings.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open Settings", onPress: () => PermissionsManager.openSettings() }
        ]
      );
      return;
    }

    // Also check if GPS is enabled
    const gpsEnabled = await PermissionsManager.isGpsEnabled();
    if (!gpsEnabled) {
      Alert.alert(
        "GPS Disabled",
        "Please enable location services (GPS) to accurately save this place.",
        [{ text: "OK" }]
      );
      return;
    }

    if (!placeName.trim()) {
      Alert.alert("Error", "Please enter a place name");
      return;
    }

    if (placeName.length < 2 || placeName.length > 100) {
        Alert.alert("Error", "Name must be between 2 and 100 characters");
        return;
    }

    if (!PlaceService.canAddMorePlaces(realm)) {
        Alert.alert(
            "Limit Reached", 
            "Free plan allows only 3 places. Upgrade to Premium for 10 places."
        );
        return;
    }

    try {
      PlaceService.createPlace(realm, {
        name: placeName.trim(),
        latitude: region.latitude,
        longitude: region.longitude,
        radius: radius,
        category: selectedCategory.id,
        icon: selectedCategory.icon,
        isEnabled: isSilencingEnabled,
        schedules: isScheduleEnabled ? schedules.map(s => ({
            startTime: s.startTime,
            endTime: s.endTime,
            days: s.days,
            label: s.label
        })) : [],
      });

      // Auto-resume logic: If adding an ENABLED place while global tracking is PAUSED
      const prefs = PreferencesService.getPreferences(realm);
      if (isSilencingEnabled && prefs && !(prefs as any).trackingEnabled) {
          PreferencesService.updatePreferences(realm, { trackingEnabled: true });
      }

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
          <MaterialIcon name="close" size={24} color={theme.colors.text.primary.light} />
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
          // We use onRegionChangeComplete to track the center
          onRegionChangeComplete={(newRegion) => {
            // Only update if change is significant (> 0.00001 degrees) to prevent micro-jitter
            if (
              Math.abs(newRegion.latitude - region.latitude) > 0.00001 ||
              Math.abs(newRegion.longitude - region.longitude) > 0.00001 ||
              Math.abs(newRegion.latitudeDelta - region.latitudeDelta) > 0.00001 ||
              Math.abs(newRegion.longitudeDelta - region.longitudeDelta) > 0.00001
            ) {
              setRegion(newRegion);
            }
          }}
          showsUserLocation={hasLocationPermission}
          followsUserLocation={false}
          zoomEnabled={true}
          zoomControlEnabled={true}
          scrollEnabled={true}
          pitchEnabled={true}
          rotateEnabled={true}
        >
          {/* Circle moves with region */}
          <Circle 
            center={region}
            radius={radius}
            fillColor={theme.colors.primary + '33'} // 20% opacity
            strokeColor={theme.colors.primary}
            strokeWidth={2}
          />
        </MapView>
        
        {/* Map Overlay Gradient */}
        <View style={styles.mapOverlayGradient} />
        
        {/* Fixed Center Pin (Draggable Map interaction) */}
        <View style={styles.centerPinContainer}>
           <View style={styles.pinShadow} />
           <MaterialIcon name="location-pin" size={48} color={theme.colors.error} />
        </View>

        {/* GPS Warning Overlay */}
        {accuracy && accuracy > 30 && (
             <View style={styles.gpsWarning}>
                 <MaterialIcon name="warning" size={16} color={theme.colors.white} />
                 <Text style={styles.gpsWarningText}>Low GPS Accuracy: ±{Math.round(accuracy)}m</Text>
             </View>
        )}
      </View>

      {/* Form Section */}
      <View style={styles.formContainer}>
        <ScrollView contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false}>
          
          <CustomInput
            label="Place Name"
            placeholder={`e.g., Downtown ${selectedCategory.label}`}
            value={placeName}
            onChangeText={setPlaceName}
            leftIcon="edit-location"
            maxLength={100}
          />
          <Text style={styles.charCount}>{placeName.length}/100</Text>

          {/* Category Picker */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>CATEGORY</Text>
            <View style={styles.categoryContainer}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryItem,
                    selectedCategory.id === cat.id && styles.categoryItemActive
                  ]}
                  onPress={() => setSelectedCategory(cat)}
                >
                  <MaterialIcon 
                    name={cat.icon} 
                    size={22} 
                    color={selectedCategory.id === cat.id ? theme.colors.white : theme.colors.text.secondary.dark} 
                  />
                  <Text style={[
                    styles.categoryLabel,
                    selectedCategory.id === cat.id && styles.categoryLabelActive
                  ]}>
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

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
                  {region.latitude.toFixed(6)}, {region.longitude.toFixed(6)}
                </Text>
              </View>
               {accuracy && (
                  <Text style={styles.accuracyText}>Accuracy: ±{Math.round(accuracy)}m</Text>
               )}
            </View>
            <TouchableOpacity 
              style={styles.updateButton}
              onPress={() => {
                   // Just use the map region coordinates as "Current Location" if User wants to snap
                   // But "Use Current Location" usually means fetch GPS
                   handleGetCurrentLocation();
              }}
            >
              <MaterialIcon name="near-me" size={16} color={theme.colors.primary} />
              <Text style={styles.updateButtonText}>Locate Me</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            <View>
              <Text style={styles.cardTitle}>Start Monitoring</Text>
              <Text style={styles.cardSubtitle}>Active immediately upon save</Text>
            </View>
            <ToggleSwitch
              value={isSilencingEnabled}
              onValueChange={setIsSilencingEnabled}
            />
          </View>

          {/* Schedule Toggle */}
          <View style={styles.card}>
            <View>
              <Text style={styles.cardTitle}>Silence Schedule</Text>
              <Text style={styles.cardSubtitle}>Only silence during specific times</Text>
            </View>
            <ToggleSwitch
              value={isScheduleEnabled}
              onValueChange={setIsScheduleEnabled}
            />
          </View>

          {/* Schedule List */}
          {isScheduleEnabled && (
            <View style={styles.scheduleSection}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>TIME INTERVALS</Text>
                <TouchableOpacity 
                    onPress={() => {
                        const newSlot: ScheduleSlot = {
                            id: Math.random().toString(),
                            startTime: '12:00',
                            endTime: '13:00',
                            days: [],
                            label: 'Interval ' + (schedules.length + 1)
                        };
                        setSchedules([...schedules, newSlot]);
                    }}
                    style={styles.addSlotButton}
                >
                    <MaterialIcon name="add" size={18} color={theme.colors.primary} />
                    <Text style={styles.addSlotText}>Add Time</Text>
                </TouchableOpacity>
              </View>

              {schedules.length === 0 ? (
                  <View style={styles.emptySchedule}>
                      <Text style={styles.emptyScheduleText}>No intervals added. App will silence only during these times.</Text>
                  </View>
              ) : (
                  schedules.map((slot, index) => (
                    <View key={slot.id} style={styles.slotCard}>
                        {/* Time Row */}
                        <View style={styles.slotMain}>
                            <TouchableOpacity 
                                style={styles.timeControl}
                                onPress={() => setShowPicker({ index, type: 'start' })}
                            >
                                <Text style={styles.timeLabel}>START</Text>
                                <Text style={styles.timeValue}>{slot.startTime}</Text>
                            </TouchableOpacity>

                            <MaterialIcon name="arrow-forward" size={20} color={theme.colors.border.dark} />

                            <TouchableOpacity 
                                style={styles.timeControl}
                                onPress={() => setShowPicker({ index, type: 'end' })}
                            >
                                <Text style={styles.timeLabel}>END</Text>
                                <Text style={styles.timeValue}>{slot.endTime}</Text>
                            </TouchableOpacity>

                            <TouchableOpacity 
                                onPress={() => {
                                    const newSchedules = schedules.filter((_, i) => i !== index);
                                    setSchedules(newSchedules);
                                }}
                                style={styles.removeSlot}
                            >
                                <MaterialIcon name="delete-outline" size={22} color={theme.colors.error} />
                            </TouchableOpacity>
                        </View>

                        {/* Day Config Row */}
                        <View style={styles.dayConfigRow}>
                           <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayPresets}>
                                {[
                                    { label: 'Every Day', days: [] },
                                    { label: 'Mon-Fri', days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] },
                                    { label: 'Weekends', days: ['Saturday', 'Sunday'] },
                                    { label: 'Custom', days: null } // null indicates custom mode triggering
                                ].map((preset) => (
                                    <TouchableOpacity
                                        key={preset.label}
                                        style={[
                                            styles.dayPresetChip,
                                            (preset.days === null 
                                                ? slot.days.length > 0 && !['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].every(d => slot.days.includes(d)) && !['Saturday', 'Sunday'].every(d => slot.days.includes(d))
                                                : (preset.days!.length === 0 ? slot.days.length === 0 : (slot.days.length === preset.days!.length && preset.days!.every(d => slot.days.includes(d))))) 
                                            && styles.dayPresetChipActive
                                        ]}
                                        onPress={() => {
                                            const newSchedules = [...schedules];
                                            if (preset.days !== null) {
                                                newSchedules[index].days = preset.days;
                                            } else {
                                                // Default custom start if switching to custom
                                                if (slot.days.length === 0) newSchedules[index].days = ['Monday']; 
                                            }
                                            setSchedules(newSchedules);
                                        }}
                                    >
                                        <Text style={[
                                            styles.dayPresetText,
                                            (preset.days === null 
                                                ? slot.days.length > 0 && !['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].every(d => slot.days.includes(d)) && !['Saturday', 'Sunday'].every(d => slot.days.includes(d))
                                                : (preset.days!.length === 0 ? slot.days.length === 0 : (slot.days.length === preset.days!.length && preset.days!.every(d => slot.days.includes(d)))))
                                            && styles.dayPresetTextActive
                                        ]}>{preset.label}</Text>
                                    </TouchableOpacity>
                                ))}
                           </ScrollView>
                        </View>
                        
                        {/* Custom Day Toggles (Visible if not typical preset) */}
                        {slot.days.length > 0 && 
                        !(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].length === slot.days.length && ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].every(d => slot.days.includes(d))) &&
                        !(['Saturday', 'Sunday'].length === slot.days.length && ['Saturday', 'Sunday'].every(d => slot.days.includes(d))) && (
                            <View style={styles.customDaysContainer}>
                                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dayShort, idx) => {
                                    const fullDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                                    const fullDay = fullDays[idx];
                                    const isSelected = slot.days.includes(fullDay);
                                    
                                    return (
                                        <TouchableOpacity
                                            key={dayShort}
                                            style={[styles.dayToggle, isSelected && styles.dayToggleActive]}
                                            onPress={() => {
                                                const newSchedules = [...schedules];
                                                const currentDays = newSchedules[index].days;
                                                if (isSelected) {
                                                    newSchedules[index].days = currentDays.filter(d => d !== fullDay);
                                                } else {
                                                    newSchedules[index].days = [...currentDays, fullDay];
                                                }
                                                // Prevent empty custom selection (revert to every day if empty? or just allow empty which means never)
                                                // Let's allow empty effectively means "Disabled" logic, but user should pick at least one
                                                setSchedules(newSchedules);
                                            }}
                                        >
                                            <Text style={[styles.dayToggleText, isSelected && styles.dayToggleTextActive]}>{dayShort[0]}</Text>
                                        </TouchableOpacity>
                                    );
                                })}
                            </View>
                        )}
                    </View>
                  ))
              )}

              {showPicker && (
                  <DateTimePicker
                    value={(() => {
                        let h = 12, m = 0;
                        try {
                            if (showPicker?.index !== undefined && schedules[showPicker.index]) {
                                const timeStr = showPicker.type === 'start' ? schedules[showPicker.index].startTime : schedules[showPicker.index].endTime;
                                const parts = timeStr.split(':').map(Number);
                                if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                                    h = parts[0];
                                    m = parts[1];
                                }
                            }
                        } catch (e) {
                            console.warn("Error parsing time", e);
                        }
                        const d = new Date();
                        d.setHours(h, m, 0, 0);
                        return d;
                    })()}
                    mode="time"
                    is24Hour={true}
                    display="default"
                    onChange={(event, selectedDate) => {
                        // Immediately hide on Android to prevent double triggers
                        if (Platform.OS === 'android') {
                            setShowPicker(null);
                        }

                        if (selectedDate) {
                             const timeStr = `${selectedDate.getHours().toString().padStart(2, '0')}:${selectedDate.getMinutes().toString().padStart(2, '0')}`;
                             
                             setSchedules(prevSchedules => {
                                 const newSchedules = [...prevSchedules];
                                 if (showPicker && newSchedules[showPicker.index]) {
                                     if (showPicker.type === 'start') {
                                         newSchedules[showPicker.index].startTime = timeStr;
                                     } else {
                                         newSchedules[showPicker.index].endTime = timeStr;
                                     }
                                 }
                                 return newSchedules;
                             });
                        }
                    }}
                  />
              )}
            </View>
          )}
          
          <View style={{ height: Math.max(insets.bottom, 20) + 60 }} />
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
    marginBottom: 10,
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
  charCount: {
    fontFamily: theme.typography.primary,
    fontSize: 12,
    color: theme.colors.text.secondary.light,
    textAlign: 'right',
    marginTop: -theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  categoryContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.md,
    backgroundColor: theme.colors.surface.light,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    gap: theme.spacing.xs,
  },
  categoryItemActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  categoryLabel: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.secondary.dark,
    fontWeight: theme.typography.weights.medium,
  },
  categoryLabelActive: {
    color: theme.colors.white,
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
  scheduleSection: {
    marginBottom: theme.spacing.xl,
  },
  addSlotButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addSlotText: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.primary,
  },
  emptySchedule: {
    padding: theme.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.border.dark,
    borderRadius: theme.layout.borderRadius.md,
    opacity: 0.6,
  },
  emptyScheduleText: {
    textAlign: 'center',
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.secondary.dark,
  },
  slotCard: {
    backgroundColor: theme.colors.surface.light,
    borderRadius: theme.layout.borderRadius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  slotMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  timeControl: {
    flex: 1,
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.secondary.light,
    letterSpacing: 1,
    marginBottom: 4,
  },
  timeValue: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
  },
  removeSlot: {
    padding: 8,
  },
  dayConfigRow: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
    paddingTop: 12,
  },
  dayPresets: {
    flexDirection: 'row',
    gap: 8,
  },
  dayPresetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: theme.colors.surface.dark + '10',
    marginRight: 8,
  },
  dayPresetChipActive: {
    backgroundColor: theme.colors.primary,
  },
  dayPresetText: {
    fontSize: 12,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.text.secondary.dark,
  },
  dayPresetTextActive: {
    color: theme.colors.white,
  },
  customDaysContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
  dayToggle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.light,
    borderWidth: 1,
    borderColor: theme.colors.border.dark,
  },
  dayToggleActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  dayToggleText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: theme.colors.text.secondary.dark,
  },
  dayToggleTextActive: {
    color: theme.colors.white,
  },
  gpsWarning: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: theme.colors.warning,
    borderRadius: theme.layout.borderRadius.md,
    padding: theme.spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    zIndex: 20,
    ...theme.layout.shadows.soft, // Fixed shadows issue
  },
  gpsWarningText: {
    color: theme.colors.white,
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.bold,
  },
  accuracyText: {
    fontSize: 10,
    color: theme.colors.text.secondary.light,
    marginTop: 2,
    fontStyle: 'italic',
  },
});
