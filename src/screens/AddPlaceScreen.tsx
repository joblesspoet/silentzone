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
import { PreferencesService } from '../database/services/PreferencesService';
import { PermissionsManager } from '../permissions/PermissionsManager';
import { usePermissions } from '../permissions/PermissionsContext';
import { RESULTS } from 'react-native-permissions';
import DateTimePicker from '@react-native-community/datetimepicker';
import { locationService } from '../services/LocationService';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sortSchedules, validateLimit, findOverlappingSchedules, findInvalidTimeRanges, ScheduleSlot as UtilScheduleSlot } from '../utils/ScheduleUtils';

// Use shared interface or map to it
interface ScheduleSlot extends UtilScheduleSlot {}

interface Props {
  navigation: any;
}

const { width } = Dimensions.get('window');

// Default location (San Francisco)
const DEFAULT_REGION = {
  latitude: 37.78825,
  longitude: -122.4324,
  latitudeDelta: 0.01,
  longitudeDelta: 0.01,
};

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
  const [schedules, setSchedules] = useState<ScheduleSlot[]>([]);
  const [showPicker, setShowPicker] = useState<{ index: number, type: 'start' | 'end' } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<boolean>(false);
  const [overlappingIds, setOverlappingIds] = useState<string[]>([]);
  const [invalidTimeIds, setInvalidTimeIds] = useState<string[]>([]);
  const [limitError, setLimitError] = useState<boolean>(false);

  // Auto-sort and validate whenever schedules change
  useEffect(() => {
    if (schedules.length > 0) {
        const sorted = sortSchedules(schedules);
        // Only update if order changed to avoid infinite loop
        if (JSON.stringify(sorted) !== JSON.stringify(schedules)) {
            setSchedules(sorted);
        }
        
        const overlaps = findOverlappingSchedules(schedules);
        setOverlappingIds(overlaps);

        const invalidTimes = findInvalidTimeRanges(schedules);
        setInvalidTimeIds(invalidTimes);

        setLimitError(!validateLimit(schedules, 5));
    } else {
        setOverlappingIds([]);
        setInvalidTimeIds([]);
        setLimitError(false);
    }
  }, [schedules]);

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
    setNameError(null);
    setScheduleError(false);

    // Granular Permission Check
    const locStatus = await PermissionsManager.getLocationStatus();
    const bgStatus = await PermissionsManager.getBackgroundLocationStatus();
    const dndStatus = await PermissionsManager.getDndStatus();
    const notifStatus = await PermissionsManager.getNotificationStatus();
    const exactAlarm = await PermissionsManager.checkExactAlarmPermission();

    // Check specific failures
    if (locStatus !== RESULTS.GRANTED && locStatus !== RESULTS.LIMITED) {
        Alert.alert("Location Permission Needed", "Please grant 'When In Use' location permission in Settings.", [{ text: "Open Settings", onPress: () => PermissionsManager.openSettings() }, { text: "Cancel", style: "cancel" }]);
        return;
    }
    if (bgStatus !== RESULTS.GRANTED && bgStatus !== RESULTS.LIMITED) {
        Alert.alert("Background Location Needed", "Silent Zone requires 'Allow all the time' location access to work in the background. Please update this in Settings.", [{ text: "Open Settings", onPress: () => PermissionsManager.openSettings() }, { text: "Cancel", style: "cancel" }]);
        return;
    }
    if (notifStatus !== RESULTS.GRANTED) {
        Alert.alert("Notifications Needed", "Please enable notifications so we can verify if the service is running.", [{ text: "Open Settings", onPress: () => PermissionsManager.openSettings() }, { text: "Cancel", style: "cancel" }]);
        return;
    }
    if (dndStatus !== RESULTS.GRANTED) {
        Alert.alert("DND Access Needed", "Please grant Do Not Disturb access so the app can silence your phone.", [{ text: "Open Settings", onPress: () => PermissionsManager.openSettings() }, { text: "Cancel", style: "cancel" }]);
        return;
    }
    if (!exactAlarm) {
        Alert.alert("Alarm Permission Needed", "Please allow 'Alarms & reminders' in Settings. This is required for schedule accuracy.", [{ text: "Open Settings", onPress: () => PermissionsManager.openSettings() }, { text: "Cancel", style: "cancel" }]);
        return;
    }

    const gpsEnabled = await PermissionsManager.isGpsEnabled();
    if (!gpsEnabled) {
      Alert.alert(
        "GPS Disabled",
        "Please enable location services (GPS) to accurately save this place.",
        [{ text: "OK" }]
      );
      return;
    }

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

    if (!validateLimit(schedules, 5)) {
        setLimitError(true);
        hasError = true;
    }

    if (overlappingIds.length > 0) {
        hasError = true;
        // Scroll to schedule section if possible (or just let the UI show red)
    }

    if (invalidTimeIds.length > 0) {
        hasError = true;
    }

    if (hasError) return;

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
        schedules: schedules.map(s => ({
            startTime: s.startTime,
            endTime: s.endTime,
            days: s.days,
            label: s.label
        })),
      });
      
      await locationService.syncGeofences();
      
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

  const getRadiusText = (r: number) => {
    return r >= 1000 ? `${(r / 1000).toFixed(1)}km` : `${Math.round(r)}m`;
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
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

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Map Section */}
          <View style={styles.mapContainer}>
            <MapView
              ref={mapRef}
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={DEFAULT_REGION}
              region={region}
              onRegionChangeComplete={(newRegion) => {
                // Throttle updates slightly to avoid jitter
                if (
                  Math.abs(newRegion.latitude - region.latitude) > 0.00001 ||
                  Math.abs(newRegion.longitude - region.longitude) > 0.00001
                ) {
                  setRegion(newRegion);
                }
              }}
              showsUserLocation={hasLocationPermission}
              showsMyLocationButton={true} 
              zoomEnabled={true}
              zoomControlEnabled={true}
              scrollEnabled={true}
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


          </View>

          {/* Form Content */}
          <View style={styles.formContainer}>
            <CustomInput
              label="Place Name"
              placeholder={`e.g., Downtown ${selectedCategory.label}`}
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
                <Text style={styles.cardTitle}>Start Monitoring</Text>
                <Text style={styles.cardSubtitle}>Active immediately upon save</Text>
              </View>
              <ToggleSwitch
                value={isSilencingEnabled}
                onValueChange={setIsSilencingEnabled}
              />
            </View>

            {/* Schedule Section - Always Visible */}
            <View style={styles.scheduleSection}>
              <View style={styles.sectionHeader}>
                <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                  <Text style={[styles.sectionLabel, (scheduleError || overlappingIds.length > 0 || invalidTimeIds.length > 0) && {color: theme.colors.error}]}>TIME INTERVALS</Text>
                  {(scheduleError || overlappingIds.length > 0 || invalidTimeIds.length > 0) && (
                       <MaterialIcon name="error-outline" size={16} color={theme.colors.error} />
                  )}
                </View>
                <TouchableOpacity 
                    onPress={() => {
                        if (schedules.length >= 5) {
                            setLimitError(true);
                            return; 
                        }
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
                    style={[styles.addSlotButton, schedules.length >= 5 && { opacity: 0.5 }]}
                    disabled={schedules.length >= 5}
                >
                    <MaterialIcon name="add" size={18} color={theme.colors.primary} />
                    <Text style={styles.addSlotText}>Add Time</Text>
                </TouchableOpacity>
              </View>

              {/* Validation Messages */}
              {limitError && (
                  <Text style={{color: theme.colors.error, fontSize: 12, marginBottom: 8, marginTop: -8}}>
                      Maximum 5 time slots allowed.
                  </Text>
              )}
              {overlappingIds.length > 0 && (
                  <Text style={{color: theme.colors.error, fontSize: 12, marginBottom: 8, marginTop: -4}}>
                      Time slots overlap on the same day. Please adjust times.
                  </Text>
              )}
              {invalidTimeIds.length > 0 && (
                  <Text style={{color: theme.colors.error, fontSize: 12, marginBottom: 8, marginTop: -4}}>
                      End time must be after Start time.
                  </Text>
              )}
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
                    schedules.map((slot, index) => {
                      const isOverlapping = overlappingIds.includes(slot.id);
                      const isInvalidTime = invalidTimeIds.includes(slot.id);
                      return (
                      <View 
                        key={slot.id} 
                        style={[
                            styles.slotCard, 
                            (isOverlapping || isInvalidTime) && { borderColor: theme.colors.error, backgroundColor: theme.colors.error + '08' }
                        ]}
                      >
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

                          {/* Day Selection */}
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
                          
                          {slot.days.length > 0 && (
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
                    );
                  })
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
    zIndex: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
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
});
