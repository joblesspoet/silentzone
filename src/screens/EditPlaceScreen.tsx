import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, ScrollView, Alert, Platform } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE, Region } from 'react-native-maps';
import Slider from '@react-native-community/slider';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { CustomInput } from '../components/CustomInput';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { useRealm } from '../database/RealmProvider';
import { PlaceService } from '../database/services/PlaceService';
import { CheckInService } from '../database/services/CheckInService';
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
  route: any;
}

const { width, height } = Dimensions.get('window');

export const EditPlaceScreen: React.FC<Props> = ({ navigation, route }) => {
  const { placeId } = route.params;
  const realm = useRealm();
  const mapRef = useRef<MapView>(null);
  
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
            setIsScheduleEnabled(true);
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

  const handleSave = () => {
    if (!placeName.trim()) {
      Alert.alert("Error", "Please enter a place name");
      return;
    }

    if (placeName.length < 2 || placeName.length > 100) {
        Alert.alert("Error", "Name must be between 2 and 100 characters");
        return;
    }

    try {
      const success = PlaceService.updatePlace(realm, placeId, {
        name: placeName.trim(),
        latitude: region.latitude,
        longitude: region.longitude,
        radius: radius,
        isEnabled: isEnabled,
        category: selectedCategory.id,
        icon: selectedCategory.icon,
        schedules: isScheduleEnabled ? schedules.map(s => ({
            startTime: s.startTime,
            endTime: s.endTime,
            days: s.days,
            label: s.label
        })) : [],
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
              // Navigate back twice (to Home) or manipulate stack
              navigation.pop(2); 
            }
          }
        ]
      );
  };

  // Format radius text
  const getRadiusText = (r: number) => {
    return r >= 1000 ? `${(r / 1000).toFixed(1)}km` : `${Math.round(r)}m`;
  };

  if (loading) return <View style={styles.container} />;

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
        <Text style={styles.headerTitle}>Edit Place</Text>
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
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          initialRegion={region}
          onRegionChangeComplete={setRegion}
          zoomEnabled={true}
          zoomControlEnabled={true}
          scrollEnabled={true}
          pitchEnabled={true}
          rotateEnabled={true}
        >
          <Circle 
            center={region}
            radius={radius}
            fillColor={theme.colors.primary + '33'}
            strokeColor={theme.colors.primary}
            strokeWidth={2}
          />
        </MapView>
        
        <View style={styles.mapOverlayGradient} />
        
        {/* Center Pin */}
        <View style={styles.centerPinContainer}>
           <View style={styles.pinShadow} />
           <MaterialIcon name="location-pin" size={48} color={theme.colors.error} />
        </View>
      </View>

      {/* Form Section */}
      <View style={styles.formContainer}>
        <ScrollView contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false}>
          
          <CustomInput
            label="Place Name"
            placeholder="Place Name"
            value={placeName}
            onChangeText={setPlaceName}
            leftIcon="edit-location"
            maxLength={100}
          />

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

          {/* Coordinates Readout */}
           <View style={styles.card}>
            <View>
              <Text style={styles.cardLabel}>Location Coordinates</Text>
              <View style={styles.coordinatesRow}>
                <MaterialIcon name="public" size={18} color={theme.colors.text.secondary.dark} />
                <Text style={styles.coordinatesText}>
                  {region.latitude.toFixed(6)}, {region.longitude.toFixed(6)}
                </Text>
              </View>
              <Text style={styles.hintText}>Drag map to adjust location</Text>
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
                         // Immediately hide on Android
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
          
          <TouchableOpacity style={styles.deleteButton} onPress={handleDelete}>
              <MaterialIcon name="delete" size={20} color={theme.colors.error} />
              <Text style={styles.deleteText}>Delete Place</Text>
          </TouchableOpacity>

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
    paddingTop: 50,
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
    height: height * 0.4,
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
  },
  centerPinContainer: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -24,
    marginTop: -48,
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
    backgroundColor: theme.colors.primary + '1A',
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
    fontFamily: 'Courier',
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.primary.light,
  },
  hintText: {
    marginTop: 4,
    fontSize: 10,
    color: theme.colors.text.secondary.light,
    fontStyle: 'italic',
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
  deleteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      marginTop: 8,
      borderWidth: 1,
      borderColor: theme.colors.error + '33',
      borderRadius: theme.layout.borderRadius.md,
      backgroundColor: theme.colors.error + '11',
      gap: 8,
  },
  deleteText: {
      color: theme.colors.error,
      fontWeight: 'bold',
  },
});
