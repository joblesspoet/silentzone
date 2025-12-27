import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Dimensions } from 'react-native';
import MapView, { Circle, PROVIDER_GOOGLE } from 'react-native-maps';
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

export const PlaceDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const { placeId } = route.params;
  const realm = useRealm();
  const [place, setPlace] = useState<any>(null);
  const [checkIns, setCheckIns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Load Data
  useEffect(() => {
    loadPlaceData();

    // Listener for updates (e.g. from Edit screen)
    const placeObj = PlaceService.getPlaceById(realm, placeId);
    if (placeObj) {
        placeObj.addListener(() => {
             // Refresh local state when realm object changes
             loadPlaceData();
        });
    }

    return () => {
        if (placeObj) placeObj.removeAllListeners();
    };
  }, [placeId]);

  const loadPlaceData = () => {
    const p = PlaceService.getPlaceById(realm, placeId);
    if (!p) {
        // Handle deletion case if staying on screen
        navigation.goBack();
        return;
    }
    setPlace({
        ...p,
        isEnabled: p.isEnabled, 
    });
    
    // Fetch History
    const history = CheckInService.getCheckInsForPlace(realm, placeId);
    setCheckIns([...history]);
    
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
           <MaterialIcon name="arrow-back-ios" size={20} color={theme.colors.text.primary.light} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{place.name}</Text>
        <TouchableOpacity onPress={handleDelete} style={styles.iconBtn}>
           <MaterialIcon name="delete-outline" size={24} color={theme.colors.error} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        
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
        
        {/* Read-only Map */}
        <View style={styles.mapContainer}>
             <MapView
                provider={PROVIDER_GOOGLE}
                style={styles.map}
                initialRegion={{
                    latitude: place.latitude,
                    longitude: place.longitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005,
                }}
                scrollEnabled={false}
                zoomEnabled={false}
                pitchEnabled={false}
                rotateEnabled={false}
             >
                <Circle 
                    center={{ latitude: place.latitude, longitude: place.longitude }}
                    radius={place.radius}
                    fillColor={theme.colors.primary + '33'}
                    strokeColor={theme.colors.primary}
                    strokeWidth={2}
                />
             </MapView>
             {/* Center Marker Overlay */}
             <View style={styles.centerMarker}>
                 <MaterialIcon name={place.icon || "location-on"} size={32} color={theme.colors.primary} />
             </View>
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

        {/* Action Button */}
        <TouchableOpacity 
            style={styles.editButton}
            onPress={() => navigation.navigate('EditPlace', { placeId: place.id })}
        >
            <Text style={styles.editButtonText}>Edit Place Config</Text>
            <MaterialIcon name="edit" size={16} color={theme.colors.white} />
        </TouchableOpacity>

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
    paddingTop: 60,
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
  emptyHistory: {
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    color: theme.colors.text.secondary.light,
    fontStyle: 'italic',
  },
});
