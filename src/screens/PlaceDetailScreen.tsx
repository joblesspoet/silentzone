import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Dimensions } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { PlaceService } from '../database/services/PlaceService';
import { CheckInService } from '../database/services/CheckInService';
import { useRealm } from '../database/RealmProvider';
import { ToggleSwitch } from '../components/ToggleSwitch';

interface Props {
  navigation: any;
  route: any;
}

const { height } = Dimensions.get('window');

import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const PlaceDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { placeId } = route.params;
  const realm = useRealm();
  const insets = useSafeAreaInsets();
  const [place, setPlace] = useState<any>(null);
  const [checkIns, setCheckIns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCurrentlyActive, setIsCurrentlyActive] = useState(false);

  const isDeleting = React.useRef(false);

  // Load Data
  useEffect(() => {
    loadPlaceData();

    // 1. Listener for updates (e.g. from Edit screen)
    const placeObj = PlaceService.getPlaceById(realm, placeId);
    if (placeObj) {
        placeObj.addListener(() => {
             loadPlaceData();
        });
    }

    // 2. Listener for check-in status (to show/hide edit buttons in real-time)
    const checkInLogs = realm.objects('CheckInLog');
    const checkInListener = () => {
        loadPlaceData();
    };
    checkInLogs.addListener(checkInListener);

    return () => {
        if (placeObj) placeObj.removeAllListeners();
        checkInLogs.removeListener(checkInListener);
    };
  }, [placeId]);

  const loadPlaceData = () => {
    if (isDeleting.current) return; // Prevent reaction if we are deleting

    const p = PlaceService.getPlaceById(realm, placeId) as any;
    if (!p) {
        // Handle deletion case (e.g. from outside)
        navigation.goBack();
        return;
    }
    setPlace({
        id: p.id,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
        radius: p.radius,
        category: p.category,
        icon: p.icon,
        isEnabled: p.isEnabled,
        lastCheckInAt: p.lastCheckInAt,
        totalCheckIns: p.totalCheckIns,
        isInside: !!p.isInside,
        // Explicitly map schedules to plain objects to ensure 'endTime' is captured
        schedules: p.schedules ? (p.schedules as any[]).map((s: any) => ({
            id: s.id,
            startTime: s.startTime,
            endTime: s.endTime,
            days: s.days ? Array.from(s.days) : [],
            label: s.label
        })) : []
    });
    
    // Fetch History
    const history = CheckInService.getCheckInsForPlace(realm, placeId);
    setCheckIns(history.slice(0, 10));

    // isInside is now a reactive property on the place object itself!
    setIsCurrentlyActive(!!p.isInside);
    
    setLoading(false);
  };

  const handleToggle = (val: boolean) => {
    PlaceService.updatePlace(realm, placeId, { isEnabled: val });
  };

  const handleDelete = () => {
    Alert.alert(
      `Delete ${place?.name}?`,
      "This will remove the place and all check-in history. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { 
          text: "Delete", 
          style: "destructive",
          onPress: () => {
            isDeleting.current = true; // Flag to suppress listeners
            PlaceService.deletePlace(realm, placeId);
            navigation.goBack();
          }
        }
      ]
    );
  };

  if (loading || !place) {
    return (
        <View style={styles.loadingContainer}>
            <Text>Loading place...</Text>
        </View>
    );
  }

  // Derived state
  const lastCheckIn = place.lastCheckInAt 
     ? new Date(place.lastCheckInAt).toLocaleDateString() + ' ' + new Date(place.lastCheckInAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
     : 'Never';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
           <MaterialIcon name="arrow-back-ios" size={20} color={theme.colors.text.primary.light} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{place.name}</Text>
        <View style={styles.iconBtn}>
          {!isCurrentlyActive ? (
            <TouchableOpacity onPress={handleDelete}>
              <MaterialIcon name="delete-outline" size={24} color={theme.colors.error} />
            </TouchableOpacity>
          ) : (
            <MaterialIcon name="lock" size={20} color={theme.colors.text.disabled} />
          )}
        </View>
      </View>

      <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 20) + 40 }]}>
        
        {/* Status Badge */}
        <View style={styles.statusSection}>
            <View style={[styles.badge, place.isEnabled ? styles.badgeActive : styles.badgeInactive]}>
                <View style={[styles.dot, { backgroundColor: place.isEnabled ? theme.colors.success : theme.colors.text.disabled }]} />
                <Text style={styles.badgeText}>
                    {place.isEnabled ? "Monitoring Active" : "Monitoring Paused"}
                </Text>
            </View>
            <ToggleSwitch
                value={place.isEnabled}
                onValueChange={handleToggle}
            />
        </View>
        
        <View style={styles.mapContainer}>
             <MapView
              provider={PROVIDER_GOOGLE}
              style={styles.map}
              initialRegion={{
                latitude: place.latitude as number,
                longitude: place.longitude as number,
                latitudeDelta: Math.max(0.002, (place.radius * 2 * 2.2) / 111320),
                longitudeDelta: Math.max(0.002, (place.radius * 2 * 2.2) / (111320 * Math.cos(place.latitude * (Math.PI / 180)))),
              }}
              scrollEnabled={false}
              zoomEnabled={false}
              pitchEnabled={false}
              rotateEnabled={false}
            >
              <Marker
                coordinate={{
                  latitude: place.latitude as number,
                  longitude: place.longitude as number,
                }}
              >
                  <MaterialIcon name={place.icon || "location-on"} size={32} color={theme.colors.primary} />
              </Marker>
              <Circle
                center={{
                  latitude: place.latitude as number,
                  longitude: place.longitude as number,
                }}
                radius={place.radius as number}
                fillColor="rgba(59, 130, 246, 0.2)"
                strokeColor="rgba(59, 130, 246, 0.5)"
                strokeWidth={2}
              />
            </MapView>
        </View>

        {/* Info Card */}
        <View style={styles.infoCard}>
             <View style={styles.infoRow}>
                 <View style={styles.infoItem}>
                     <Text style={styles.label}>RADIUS</Text>
                     <Text style={styles.value}>{place.radius}m</Text>
                 </View>
                 <View style={styles.divider} />
                 <View style={styles.infoItem}>
                     <Text style={styles.label}>TOTAL VISITS</Text>
                     <Text style={styles.value}>{place.totalCheckIns}</Text>
                 </View>
             </View>
             
             <View style={styles.separator} />
             
             <View style={styles.detailsRow}>
                 <MaterialIcon name="access-time" size={16} color={theme.colors.text.secondary.light} />
                 <Text style={styles.detailText}>Last visited: {lastCheckIn}</Text>
             </View>
             <View style={styles.detailsRow}>
                 <MaterialIcon name="public" size={16} color={theme.colors.text.secondary.light} />
                 <Text style={styles.detailText}>{place.latitude.toFixed(6)}, {place.longitude.toFixed(6)}</Text>
             </View>
        </View>

        {/* Schedule Display */}
        <View style={styles.historySection}>
            <Text style={styles.sectionTitle}>Schedules</Text>
            {(!place.schedules || place.schedules.length === 0) ? (
                <View style={styles.scheduleRow}>
                    <MaterialIcon name="schedule" size={20} color={theme.colors.success} />
                    <Text style={styles.scheduleText}>Always Active - 24/7 Monitoring</Text>
                </View>
            ) : (
                place.schedules.map((s: any, idx: number) => (
                    <View key={s.id || idx} style={styles.scheduleCard}>
                        <View style={styles.scheduleInfo}>
                            <Text style={styles.scheduleLabel}>{s.label || 'Interval'}</Text>
                            <Text style={styles.scheduleTime}>{s.startTime} — {s.endTime}</Text>
                        </View>
                        <MaterialIcon name="access-time" size={20} color={theme.colors.primary} />
                    </View>
                ))
            )}
        </View>

        {/* Action Button */}
        {!isCurrentlyActive && (
          <TouchableOpacity 
              style={styles.editButton}
              onPress={() => navigation.navigate('EditPlace', { placeId: place.id })}
          >
              <Text style={styles.editButtonText}>Edit Place Config</Text>
              <MaterialIcon name="edit" size={16} color={theme.colors.white} />
          </TouchableOpacity>
        )}

        {/* History Section */}
        <View style={styles.historySection}>
            <Text style={styles.sectionTitle}>Recent Check-ins</Text>
            
            {checkIns.length === 0 ? (
                <View style={styles.emptyHistory}>
                    <Text style={styles.emptyText}>No check-ins recorded yet.</Text>
                </View>
            ) : (
                checkIns.map((log: any) => (
                    <View key={log.id} style={styles.historyItem}>
                        <View style={styles.historyLeft}>
                             <View style={styles.historyIcon}>
                                 <MaterialIcon name="history" size={16} color={theme.colors.primary} />
                             </View>
                             <View>
                                 <Text style={styles.historyDate}>
                                     {new Date(log.checkInTime).toLocaleDateString()}
                                 </Text>
                                 <Text style={styles.historyTime}>
                                     {new Date(log.checkInTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                                 </Text>
                             </View>
                        </View>
                        <Text style={styles.duration}>
                            {log.durationMinutes ? `${log.durationMinutes} min` : 'Ongoing'}
                        </Text>
                    </View>
                ))
            )}
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
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 0, // Handled inline
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.background.light,
  },
  headerTitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    flex: 1,
    textAlign: 'center',
    marginHorizontal: 16,
  },
  iconBtn: {
    padding: 8,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  statusSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.lg,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.layout.borderRadius.full,
    gap: 8,
  },
  badgeActive: {
    backgroundColor: theme.colors.success + '1A',
  },
  badgeInactive: {
    backgroundColor: theme.colors.surface.dark + '10', // gray
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.text.primary.light,
  },
  mapContainer: {
    height: 200,
    marginHorizontal: theme.spacing.lg,
    borderRadius: theme.layout.borderRadius.lg,
    overflow: 'hidden',
    marginBottom: theme.spacing.lg,
    position: 'relative',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  centerMarker: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginTop: -28, // adjust for icon size
    marginLeft: -16,
  },
  infoCard: {
    backgroundColor: theme.colors.surface.light,
    marginHorizontal: theme.spacing.lg,
    borderRadius: theme.layout.borderRadius.lg,
    padding: theme.spacing.lg,
    ...theme.layout.shadows.soft,
    marginBottom: theme.spacing.lg,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: theme.spacing.md,
  },
  infoItem: {
    alignItems: 'center',
  },
  label: {
    fontSize: 10,
    color: theme.colors.text.secondary.light,
    fontWeight: theme.typography.weights.bold,
    letterSpacing: 1,
    marginBottom: 4,
  },
  value: {
    fontSize: 18,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
  },
  divider: {
    width: 1,
    backgroundColor: theme.colors.border.light,
  },
  separator: {
    height: 1,
    backgroundColor: theme.colors.border.light,
    marginVertical: theme.spacing.md,
  },
  detailsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  detailText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.secondary.light,
  },
  editButton: {
    marginHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.primary,
    borderRadius: theme.layout.borderRadius.md,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: theme.spacing.xl,
  },
  editButtonText: {
    color: theme.colors.white,
    fontWeight: theme.typography.weights.semibold,
  },
  editButtonDisabled: {
    backgroundColor: theme.colors.text.disabled,
    opacity: 0.8,
  },
  historySection: {
    paddingHorizontal: theme.spacing.lg,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    marginBottom: theme.spacing.md,
    color: theme.colors.text.primary.light,
  },
  historyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  historyIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.primary + '10',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyDate: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.text.primary.light,
  },
  historyTime: {
    fontSize: theme.typography.sizes.xs,
    color: theme.colors.text.secondary.light,
  },
  duration: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.text.secondary.light,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: theme.colors.surface.light,
    padding: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    marginBottom: theme.spacing.lg,
  },
  scheduleText: {
    fontSize: theme.typography.sizes.sm,
    color: theme.colors.text.primary.light,
    fontWeight: theme.typography.weights.medium,
  },
  scheduleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: theme.colors.surface.light,
    padding: theme.spacing.md,
    borderRadius: theme.layout.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    marginBottom: theme.spacing.sm,
  },
  scheduleInfo: {},
  scheduleLabel: {
    fontSize: 10,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.secondary.light,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  scheduleTime: {
    fontSize: theme.typography.sizes.md,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
  },
  emptyHistory: {
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.colors.text.secondary.light,
    fontStyle: 'italic',
  },
});
