import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
import MapView, { Circle, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import Geolocation from '@react-native-community/geolocation';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { CustomInput } from '../components/CustomInput';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { useRealm } from '../database/RealmProvider';
import { PlaceService } from '../database/services/PlaceService';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { RESULTS } from 'react-native-permissions';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface ScheduleSlot {
  id: string;
  startTime: string;
  endTime: string;
  days: string[];
  label: string;
}

interface Props {
  navigation: any;
  route: any;
}

const { width } = Dimensions.get('window');

export const EditPlaceScreen: React.FC<Props> = ({ navigation, route }) => {
  const { placeId } = route.params;
  const realm = useRealm();
  const mapRef = useRef<MapView>(null);
  const insets = useSafeAreaInsets();
  
  const [region, setRegion] = useState<Region>({
    latitude: 37.78825,
    longitude: -122.4324,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  
  const [placeName, setPlaceName] = useState('');
  const [radius, setRadius] = useState(150);
  const [isEnabled, setIsEnabled] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState({ id: 'other', icon: 'place', label: 'Other' });
  const [loading, setLoading] = useState(true);
  const [nameError, setNameError] = useState<string | null>(null);

  // Location state
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  // Schedule state
  const [schedules, setSchedules] = useState<ScheduleSlot[]>([]);
  const [showPicker, setShowPicker] = useState<{ index: number, type: 'start' | 'end' } | null>(null);
  const [scheduleError, setScheduleError] = useState<boolean>(false);

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

  // Load existing data
  useEffect(() => {
    const place = PlaceService.getPlaceById(realm, placeId) as any;
    if (place) {
        setPlaceName(place.name);
        setRadius(place.radius);
        setIsEnabled(place.isEnabled);
        
        const initialRegion = {
            latitude: place.latitude,
            longitude: place.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
        };
        setRegion(initialRegion);

        // Find and set current category
        const cat = CATEGORIES.find(c => c.id === place.category) || CATEGORIES[3];
        setSelectedCategory(cat);

        // Load schedules
        if (place.schedules && place.schedules.length > 0) {
            setSchedules(place.schedules.map((s: any) => ({
                id: s.id,
                startTime: s.startTime,
                endTime: s.endTime,
                days: [...s.days],
                label: s.label
            })));
        }
    } else {
        Alert.alert("Error", "Place not found");
        navigation.goBack();
    }
    setLoading(false);
  }, [placeId]);

  // Safety check: Don't allow editing if place is active
  useEffect(() => {
    const checkActive = () => {
      const place = PlaceService.getPlaceById(realm, placeId) as any;
      if (place?.isInside) {
        Alert.alert(
          "Place is Active",
          "You cannot edit a place while you are currently inside it. Returning to details.",
          [{ text: "OK", onPress: () => navigation.goBack() }]
        );
      }
    };

    checkActive();
    // Also check every 10 seconds in case they enter while screen is open
    const interval = setInterval(checkActive, 10000);
    return () => clearInterval(interval);
  }, [placeId, realm]);

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

  const handleSave = () => {
    setNameError(null);
    setScheduleError(false);

    let hasError = false;

    if (!placeName.trim()) {
      setNameError("Place Name is required");
      hasError = true;
    } else if (placeName.length < 2 || placeName.length > 100) {
        setNameError("Name must be between 2 and 100 characters");
        hasError = true;
    }

    if (schedules.length === 0) {
        setScheduleError(true);
        hasError = true;
    }

    if (hasError) return;

    try {
      const success = PlaceService.updatePlace(realm, placeId, {
        name: placeName.trim(),
        latitude: region.latitude,
        longitude: region.longitude,
        radius: radius,
        isEnabled: isEnabled,
        category: selectedCategory.id,
        icon: selectedCategory.icon,
        schedules: schedules.map(s => ({
            startTime: s.startTime,
            endTime: s.endTime,
            days: s.days,
            label: s.label
        })),
      });

      if (success) {
          navigation.goBack();
      } else {
          Alert.alert("Error", "Failed to update place.");
      }
    } catch (error) {
      console.error("Failed to update place:", error);
      Alert.alert("Error", "Failed to update place.");
    }
  };

  const handleDelete = () => {
      Alert.alert(
        "Delete Place?",
        "This action cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          { 
            text: "Delete", 
            style: "destructive",
            onPress: () => {
              PlaceService.deletePlace(realm, placeId);
              navigation.pop(2); 
            }
          }
        ]
      );
  };

  const getRadiusText = (r: number) => {
    return r >= 1000 ? `${(r / 1000).toFixed(1)}km` : `${Math.round(r)}m`;
  };

  if (loading) return <View style={styles.container} />;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <MaterialIcon name="close" size={24} color={theme.colors.text.primary.light} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Place</Text>
        <TouchableOpacity 
          onPress={handleSave}
          style={styles.saveButton}
        >
          <Text style={styles.saveText}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Map Section */}
          <View style={styles.mapContainer}>
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={region}
              region={region}
              onRegionChangeComplete={(newRegion) => {
                if (
                  Math.abs(newRegion.latitude - region.latitude) > 0.00001 ||
                  Math.abs(newRegion.longitude - region.longitude) > 0.00001 ||
                  Math.abs(newRegion.latitudeDelta - region.latitudeDelta) > 0.00001 ||
                  Math.abs(newRegion.longitudeDelta - region.longitudeDelta) > 0.00001
                ) {
                  setRegion(newRegion);
                }
              }}
              zoomEnabled={true}
              zoomControlEnabled={true}
              scrollEnabled={true}
              showsUserLocation={hasLocationPermission}
              showsMyLocationButton={true}
            >
              <Circle 
                center={region}
                radius={radius}
                fillColor={theme.colors.primary + '33'}
                strokeColor={theme.colors.primary}
                strokeWidth={2}
              />
            </MapView>
            
            <View style={styles.centerPinContainer}>
               <View style={styles.pinShadow} />
               <MaterialIcon name="location-pin" size={36} color={theme.colors.error} />
            </View>

            {/* Locate Me Button Overlay */}
            <TouchableOpacity 
                style={styles.mapLocateButton}
                onPress={handleGetCurrentLocation}
            >
                <MaterialIcon name="my-location" size={20} color={theme.colors.primary} />
            </TouchableOpacity>
          </View>

          {/* Form Content */}
          <View style={styles.formContainer}>
            <CustomInput
              label="Place Name"
              placeholder="Place Name"
              value={placeName}
              onChangeText={(text) => {
                  setPlaceName(text);
                  if (nameError) setNameError(null);
              }}
              leftIcon="edit-location"
              maxLength={100}
              error={nameError || undefined}
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
                      size={20} 
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

            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionLabel}>SILENCE RADIUS</Text>
                <View style={styles.radiusBadge}>
                  <Text style={styles.radiusValue}>{getRadiusText(radius)}</Text>
                </View>
              </View>
              
              <View style={styles.sliderContainer}>
                <TouchableOpacity 
                  style={styles.radiusButton}
                  onPress={() => setRadius(Math.max(30, radius - 1))}
                >
                    <MaterialIcon name="remove" size={20} color={theme.colors.primary} />
                </TouchableOpacity>

                <View style={{ flex: 1 }}>
                  <Slider
                    style={{ width: '100%', height: 40 }}
                    minimumValue={30}
                    maximumValue={150}
                    step={1}
                    value={radius}
                    onValueChange={setRadius}
                    minimumTrackTintColor={theme.colors.primary}
                    maximumTrackTintColor={theme.colors.border.light}
                    thumbTintColor={theme.colors.white}
                  />
                  <View style={styles.sliderLabels}>
                    <Text style={styles.sliderLabelText}>30m</Text>
                    <Text style={styles.sliderLabelText}>150m</Text>
                  </View>
                </View>

                <TouchableOpacity 
                  style={styles.radiusButton}
                  onPress={() => setRadius(Math.min(150, radius + 1))}
                >
                    <MaterialIcon name="add" size={20} color={theme.colors.primary} />
                </TouchableOpacity>
              </View>
            </View>

             <View style={styles.card}>
              <View>
                <Text style={styles.cardLabel}>Location Coordinates</Text>
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
            </View>

            <View style={styles.card}>
              <View>
                <Text style={styles.cardTitle}>Monitoring Status</Text>
                <Text style={styles.cardSubtitle}>Enable or pause silencing</Text>
              </View>
              <ToggleSwitch
                value={isEnabled}
                onValueChange={setIsEnabled}
              />
            </View>

            {/* Schedule Section - Always Visible */}
            <View style={styles.scheduleSection}>
              <View style={styles.sectionHeader}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                   <Text style={[styles.sectionLabel, scheduleError && {color: theme.colors.error}]}>TIME INTERVALS</Text>
                   {scheduleError && (
                        <MaterialIcon name="error-outline" size={16} color={theme.colors.error} />
                   )}
                </View>
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
                        setScheduleError(false);
                    }}
                    style={styles.addSlotButton}
                >
                    <MaterialIcon name="add" size={18} color={theme.colors.primary} />
                    <Text style={styles.addSlotText}>Add Time</Text>
                </TouchableOpacity>
              </View>

              {scheduleError && (
                  <Text style={{color: theme.colors.error, fontSize: 12, marginBottom: 8, marginTop: -8}}>
                      Please add at least one time interval below.
                  </Text>
              )}

              {schedules.length === 0 ? (
                  <View style={[
                      styles.emptySchedule,
                      scheduleError && { borderColor: theme.colors.error, backgroundColor: theme.colors.error + '10' }
                  ]}>
                      <Text style={[
                          styles.emptyScheduleText,
                          scheduleError && { color: theme.colors.error }
                      ]}>
                          {scheduleError ? "Required: Tap 'Add Time' to set a schedule" : "No intervals added. App will silence only during these times."}
                      </Text>
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
                                      { label: 'Custom', days: null }
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
                          
                          {/* Custom Day Toggles */}
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
                          const d = new Date();
                          d.setHours(12, 0, 0, 0);
                          return d;
                      })()}
                      mode="time"
                      is24Hour={true}
                      display="default"
                      onChange={(event, selectedDate) => {
                          if (Platform.OS === 'android') setShowPicker(null);
                          if (selectedDate) {
                               const timeStr = `${selectedDate.getHours().toString().padStart(2, '0')}:${selectedDate.getMinutes().toString().padStart(2, '0')}`;
                               setSchedules(prev => {
                                   const newS = [...prev];
                                   if (showPicker && newS[showPicker.index]) {
                                       if (showPicker.type === 'start') newS[showPicker.index].startTime = timeStr;
                                       else newS[showPicker.index].endTime = timeStr;
                                   }
                                   return newS;
                               });
                          }
                      }}
                    />
                )}
              </View>
            
            <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
                <MaterialIcon name="delete" size={20} color={theme.colors.error} />
                <Text style={styles.deleteText}>Delete Place</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </View>
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.background.light,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
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
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: theme.colors.primary,
    borderRadius: 20,
  },
  saveText: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.white,
  },
  content: {
    flex: 1,
  },
  mapContainer: {
    height: 300,
    width: '100%',
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  centerPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -18,
    marginTop: -32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinShadow: {
    position: 'absolute',
    bottom: 2,
    width: 14,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.3)',
    marginBottom: 8,
  },
  mapLocateButton: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    backgroundColor: theme.colors.surface.light,
    padding: 10,
    borderRadius: 30,
    ...theme.layout.shadows.medium,
  },
  formContainer: {
    padding: theme.spacing.lg,
  },
  section: { marginBottom: theme.spacing.xl },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: theme.spacing.md },
  sectionLabel: { fontSize: theme.typography.sizes.sm, fontWeight: theme.typography.weights.semibold, color: theme.colors.text.primary.light, opacity: 0.8 },
  charCount: { fontSize: 12, color: theme.colors.text.secondary.light, textAlign: 'right', marginTop: -theme.spacing.sm, marginBottom: theme.spacing.md },
  categoryContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  categoryItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: theme.spacing.sm, paddingHorizontal: theme.spacing.md, borderRadius: theme.layout.borderRadius.md, backgroundColor: theme.colors.surface.light, borderWidth: 1, borderColor: theme.colors.border.light, gap: theme.spacing.xs },
  categoryItemActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  categoryLabel: { fontSize: theme.typography.sizes.sm, color: theme.colors.text.secondary.dark, fontWeight: theme.typography.weights.medium },
  categoryLabelActive: { color: theme.colors.white },
  radiusBadge: { backgroundColor: theme.colors.primary + '1A', paddingHorizontal: theme.spacing.sm, paddingVertical: 4, borderRadius: theme.layout.borderRadius.sm },
  radiusValue: { fontSize: theme.typography.sizes.lg, fontWeight: theme.typography.weights.bold, color: theme.colors.primary },
  sliderContainer: { height: 60, flexDirection: 'row', alignItems: 'center', gap: 12 },
  radiusButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.colors.surface.light, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: theme.colors.border.light, ...theme.layout.shadows.soft },
  sliderLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -8 },
  sliderLabelText: { fontSize: theme.typography.sizes.xs, color: theme.colors.text.secondary.light, fontWeight: theme.typography.weights.medium },
  card: { backgroundColor: theme.colors.surface.light, borderRadius: theme.layout.borderRadius.lg, padding: theme.spacing.lg, marginBottom: theme.spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: theme.colors.border.light, ...theme.layout.shadows.soft },
  cardLabel: { fontSize: theme.typography.sizes.xs, color: theme.colors.text.secondary.light, fontWeight: theme.typography.weights.medium, marginBottom: 4 },
  coordinatesRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coordinatesText: { fontFamily: 'Courier', fontSize: theme.typography.sizes.sm, color: theme.colors.text.primary.light },
  accuracyText: { fontSize: 10, color: theme.colors.text.secondary.light, marginTop: 2 },
  updateButton: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors.primary + '1A', paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.layout.borderRadius.md },
  updateButtonText: { fontSize: theme.typography.sizes.xs, fontWeight: theme.typography.weights.bold, color: theme.colors.primary },
  cardTitle: { fontSize: theme.typography.sizes.md, fontWeight: theme.typography.weights.medium, color: theme.colors.text.primary.light },
  cardSubtitle: { fontSize: theme.typography.sizes.xs, color: theme.colors.text.secondary.light },
  scheduleSection: { marginTop: -8, marginBottom: theme.spacing.xl },
  addSlotButton: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addSlotText: { fontSize: theme.typography.sizes.sm, color: theme.colors.primary, fontWeight: theme.typography.weights.bold },
  emptySchedule: { backgroundColor: theme.colors.surface.light, padding: theme.spacing.lg, borderRadius: theme.layout.borderRadius.md, alignItems: 'center', borderStyle: 'dashed', borderWidth: 1, borderColor: theme.colors.border.dark },
  emptyScheduleText: { color: theme.colors.text.secondary.light, fontSize: theme.typography.sizes.sm, textAlign: 'center' },
  slotCard: { backgroundColor: theme.colors.surface.light, borderRadius: theme.layout.borderRadius.md, padding: theme.spacing.md, marginBottom: theme.spacing.md, borderWidth: 1, borderColor: theme.colors.border.light },
  slotMain: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: theme.spacing.md },
  timeControl: { alignItems: 'center', padding: 8, backgroundColor: theme.colors.background.light, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border.light, minWidth: 80 },
  timeLabel: { fontSize: 10, color: theme.colors.text.secondary.light, marginBottom: 2, fontWeight: '600' },
  timeValue: { fontSize: theme.typography.sizes.md, fontWeight: 'bold', color: theme.colors.text.primary.light },
  removeSlot: { padding: 8 },
  dayConfigRow: { marginTop: 4 },
  dayPresets: { gap: 8, paddingBottom: 4 },
  dayPresetChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.colors.background.light, borderWidth: 1, borderColor: theme.colors.border.light },
  dayPresetChipActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  dayPresetText: { fontSize: 12, color: theme.colors.text.secondary.dark, fontWeight: '500' },
  dayPresetTextActive: { color: theme.colors.white },
  customDaysContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.colors.border.light },
  dayToggle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background.light, borderWidth: 1, borderColor: theme.colors.border.light },
  dayToggleActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  dayToggleText: { fontSize: 12, color: theme.colors.text.secondary.dark, fontWeight: '600' },
  dayToggleTextActive: { color: theme.colors.white },
  deleteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, padding: theme.spacing.md, borderRadius: theme.layout.borderRadius.md, borderWidth: 1, borderColor: theme.colors.error, backgroundColor: theme.colors.error + '1A', marginBottom: theme.spacing.xl },
  deleteText: { color: theme.colors.error, fontWeight: theme.typography.weights.bold },
});
