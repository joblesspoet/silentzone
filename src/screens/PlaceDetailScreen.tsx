import React from 'react';
import { View, Text, StyleSheet, Dimensions, TouchableOpacity, ScrollView, Platform } from 'react-native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { ToggleSwitch } from '../components/ToggleSwitch';
import { CustomButton } from '../components/CustomButton';

interface Props {
  navigation: any;
  route?: any;
}

const { width } = Dimensions.get('window');

// Mock data
const PLACE_DATA = {
  name: 'Downtown Mosque',
  region: {
    latitude: 24.71,
    longitude: 46.67,
    latitudeDelta: 0.005,
    longitudeDelta: 0.005,
  },
  radius: 50,
  isActive: true,
  isInside: true,
  lastVisit: 'Today, 12:30 PM',
  totalVisits: 42,
};

export const PlaceDetailScreen: React.FC<Props> = ({ navigation }) => {
  const [isActive, setIsActive] = React.useState(PLACE_DATA.isActive);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()}
          style={styles.iconButton}
        >
          <MaterialIcon name="arrow-back" size={24} color={theme.colors.text.primary.light} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{PLACE_DATA.name}</Text>
        <TouchableOpacity 
          style={[styles.iconButton, { backgroundColor: '#FEF2F2' }]} // Light red
        >
          <MaterialIcon name="delete" size={24} color={theme.colors.error} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Status Card */}
        <View style={styles.statusCard}>
            <View style={styles.statusHeader}>
                <View>
                    <Text style={styles.placeName}>{PLACE_DATA.name}</Text>
                    <View style={styles.statusBadge}>
                        <View style={styles.pingDot}>
                            <View style={styles.pingInner} />
                            <View style={styles.pingOuter} />
                        </View>
                        <Text style={styles.statusText}>Currently Inside</Text>
                    </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                   <ToggleSwitch value={isActive} onValueChange={setIsActive} />
                   <Text style={styles.toggleLabel}>ACTIVE</Text>
                </View>
            </View>
        </View>

        {/* Map View */}
        <View style={styles.mapContainer}>
             <MapView
                provider={PROVIDER_GOOGLE}
                style={StyleSheet.absoluteFillObject}
                initialRegion={PLACE_DATA.region}
                scrollEnabled={false}
                zoomEnabled={false}
                pitchEnabled={false}
                rotateEnabled={false}
             >
                <Circle 
                    center={PLACE_DATA.region}
                    radius={PLACE_DATA.radius}
                    fillColor={theme.colors.primary + '33'}
                    strokeColor={theme.colors.primary}
                    strokeWidth={1}
                />
             </MapView>
             <View style={styles.mapOverlay} />
             <View style={styles.mapCenterInfo}>
                 <View style={styles.mapCenterVisual}>
                     <View style={styles.mapDot} />
                 </View>
                 <View style={styles.mapBadge}>
                     <Text style={styles.mapBadgeText}>Radius: {PLACE_DATA.radius}m</Text>
                 </View>
             </View>
             <TouchableOpacity style={styles.expandButton}>
                 <MaterialIcon name="open-in-full" size={20} color={theme.colors.text.secondary.dark} />
             </TouchableOpacity>
        </View>

        {/* Info Grid */}
        <View style={styles.grid}>
            <View style={styles.gridItem}>
                <View style={styles.gridHeader}>
                    <MaterialIcon name="radar" size={18} color={theme.colors.primary} />
                    <Text style={styles.gridLabel}>RADIUS</Text>
                </View>
                <Text style={styles.gridValue}>{PLACE_DATA.radius}m</Text>
            </View>
            <View style={styles.gridItem}>
                <View style={styles.gridHeader}>
                    <MaterialIcon name="pin-drop" size={18} color={theme.colors.primary} />
                    <Text style={styles.gridLabel}>COORDINATES</Text>
                </View>
                <Text style={styles.gridValue} numberOfLines={1}>
                    {PLACE_DATA.region.latitude}° N, ...
                </Text>
            </View>
            <View style={styles.gridItem}>
                <View style={styles.gridHeader}>
                    <MaterialIcon name="history" size={18} color={theme.colors.primary} />
                    <Text style={styles.gridLabel}>LAST VISIT</Text>
                </View>
                <Text style={[styles.gridValue, { fontSize: 14 }]}>{PLACE_DATA.lastVisit}</Text>
            </View>
            <View style={styles.gridItem}>
                <View style={styles.gridHeader}>
                    <MaterialIcon name="bar-chart" size={18} color={theme.colors.primary} />
                    <Text style={styles.gridLabel}>TOTAL VISITS</Text>
                </View>
                <Text style={styles.gridValue}>{PLACE_DATA.totalVisits}</Text>
            </View>
        </View>

        {/* Recent Check-ins */}
        <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recent Check-ins</Text>
            <TouchableOpacity>
                <Text style={styles.linkText}>View All</Text>
            </TouchableOpacity>
        </View>

        <View style={styles.listContainer}>
            {[1, 2, 3].map((_, index) => (
                <View key={index} style={styles.listItem}>
                    <View style={[styles.listIcon, index % 2 === 0 ? styles.iconIn : styles.iconOut]}>
                        <MaterialIcon name={index % 2 === 0 ? "login" : "logout"} size={20} color={index % 2 === 0 ? theme.colors.secondary : theme.colors.text.secondary.dark} />
                    </View>
                    <View style={{ flex: 1 }}>
                        <Text style={styles.listItemTitle}>{index % 2 === 0 ? "Entered Zone" : "Left Zone"}</Text>
                        <Text style={styles.listItemSubtitle}>{index === 0 ? "Today" : "Yesterday"}</Text>
                    </View>
                    <Text style={styles.listItemTime}>12:30 PM</Text>
                </View>
            ))}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Footer */}
      <View style={styles.footer}>
          <CustomButton 
            title="Edit Location"
            onPress={() => {}}
            leftIcon="edit-location"
            fullWidth
            style={{ borderRadius: theme.layout.borderRadius.xl, height: 56 }}
          />
      </View>
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
    paddingTop: 50,
    paddingBottom: theme.spacing.sm,
    backgroundColor: 'rgba(255,255,255,0.8)',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface.light,
  },
  headerTitle: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.lg,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
  },
  scrollContent: {
    paddingBottom: 20,
  },
  statusCard: {
    margin: theme.spacing.lg,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surface.light,
    borderRadius: theme.layout.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.layout.shadows.soft,
  },
  statusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  placeName: {
    fontSize: theme.typography.sizes.xl,
    fontWeight: theme.typography.weights.bold,
    color: theme.colors.text.primary.light,
    marginBottom: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.secondary + '1A', // Green-50
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.layout.borderRadius.full,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: theme.colors.secondary + '33',
  },
  pingDot: {
    width: 8,
    height: 8,
    marginRight: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pingInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.secondary,
  },
  pingOuter: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.secondary,
    opacity: 0.4,
  },
  statusText: {
    fontSize: theme.typography.sizes.xs,
    fontWeight: theme.typography.weights.semibold,
    color: theme.colors.secondary,
  },
  toggleLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: theme.colors.text.secondary.light,
    marginTop: 4,
  },
  mapContainer: {
    marginHorizontal: theme.spacing.lg,
    height: 180,
    borderRadius: theme.layout.borderRadius.lg,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: theme.colors.border.light,
  },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent', // Could add overlay color
  },
  mapCenterInfo: {
    position: 'absolute',
    inset: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapCenterVisual: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: theme.colors.primary + '1A',
    borderWidth: 1,
    borderColor: theme.colors.primary + '66',
    justifyContent: 'center',
    alignItems: 'center',
  },
  mapDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.white,
    borderWidth: 2,
    borderColor: theme.colors.primary,
    ...theme.layout.shadows.glow,
  },
  mapBadge: {
    marginTop: 8,
    backgroundColor: theme.colors.white,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
    ...theme.layout.shadows.soft,
  },
  mapBadgeText: {
    fontSize: 10,
    fontWeight: 'bold',
    color: theme.colors.text.primary.light,
  },
  expandButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: theme.colors.white,
    padding: 8,
    borderRadius: 8,
    ...theme.layout.shadows.soft,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: theme.spacing.md, // Grid gap logic
    marginBottom: theme.spacing.lg,
  },
  gridItem: {
    width: '46%', // Approx half with 4% gap
    margin: '2%',
    backgroundColor: theme.colors.surface.light,
    padding: theme.spacing.lg,
    borderRadius: theme.layout.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    ...theme.layout.shadows.soft,
  },
  gridHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  gridLabel: {
    fontSize: 10,
    fontWeight: 'bold',
    color: theme.colors.text.secondary.light,
  },
  gridValue: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: 'bold',
    color: theme.colors.text.primary.light,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
  },
  sectionTitle: {
    fontSize: theme.typography.sizes.lg,
    fontWeight: 'bold',
    color: theme.colors.text.primary.light,
  },
  linkText: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: 'bold',
    color: theme.colors.primary,
  },
  listContainer: {
    marginHorizontal: theme.spacing.lg,
    backgroundColor: theme.colors.surface.light,
    borderRadius: theme.layout.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border.light,
    overflow: 'hidden',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: theme.spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border.light, // Last child logic handled by styling usually
  },
  listIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: theme.spacing.md,
  },
  iconIn: {
    backgroundColor: theme.colors.secondary + '1A',
    borderColor: theme.colors.secondary + '33',
    borderWidth: 1,
  },
  iconOut: {
    backgroundColor: theme.colors.background.light,
    borderColor: theme.colors.border.light,
    borderWidth: 1,
  },
  listItemTitle: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: 'bold',
    color: theme.colors.text.primary.light,
  },
  listItemSubtitle: {
    fontSize: 11,
    color: theme.colors.text.secondary.light,
  },
  listItemTime: {
    fontSize: theme.typography.sizes.sm,
    fontWeight: 'bold',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    color: theme.colors.text.primary.light,
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255,255,255,0.9)',
    padding: theme.spacing.lg,
    paddingBottom: 32,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border.light,
  },
});
