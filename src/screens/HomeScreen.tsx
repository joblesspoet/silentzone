import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, FlatList, StatusBar } from 'react-native';
import { theme } from '../theme';
import { MaterialIcon } from '../components/MaterialIcon';
import { StatusCard } from '../components/StatusCard';
import { PlaceCard } from '../components/PlaceCard';

interface Props {
  navigation: any;
}

// Dummy data
const INITIAL_PLACES = [
  {
    id: '1',
    name: 'Downtown Mosque',
    icon: 'mosque',
    radius: '50m radius',
    distance: '2.3 km away',
    isActive: true,
    isCurrentLocation: false,
  },
  {
    id: '2',
    name: 'Tech Park Office',
    icon: 'business-center',
    radius: '100m radius',
    distance: 'Currently inside',
    isActive: true, // "Monitoring Active"
    isCurrentLocation: true,
  },
  {
    id: '3',
    name: 'City High School',
    icon: 'school',
    radius: '200m radius',
    distance: '5.1 km away',
    isActive: false,
    isCurrentLocation: false,
    disabled: true, // Example of disabled state if needed, though HTML just had opacity
  },
];

export const HomeScreen: React.FC<Props> = ({ navigation }) => {
  const [places, setPlaces] = useState(INITIAL_PLACES);
  const [isPaused, setIsPaused] = useState(false);

  const activeCount = places.filter(p => p.isActive).length;

  const handleToggle = (id: string, value: boolean) => {
    setPlaces(prev => prev.map(p => p.id === id ? { ...p, isActive: value } : p));
  };

  const currentDate = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'short' });

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <Text style={styles.dateText}>{currentDate}</Text>
          <TouchableOpacity 
            style={[styles.pauseButton, isPaused && styles.pauseButtonActive]}
            onPress={() => setIsPaused(!isPaused)}
          >
            <MaterialIcon 
              name={isPaused ? "play-circle-outline" : "pause-circle-outline"} 
              size={18} 
              color={theme.colors.primary} 
            />
            <Text style={styles.pauseButtonText}>
              {isPaused ? "RESUME TRACKING" : "PAUSE TRACKING"}
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
            isOperational={!isPaused} 
          />
        </View>

        <View style={styles.placesContainer}>
          <View style={styles.placesHeader}>
             <Text style={styles.placesTitle}>Your Places</Text>
             <TouchableOpacity onPress={() => console.log('See all')}>
               <Text style={styles.seeAllText}>See All</Text>
             </TouchableOpacity>
          </View>

          {places.map(place => (
            <PlaceCard
              key={place.id}
              name={place.name}
              icon={place.icon}
              radius={place.radius}
              distance={place.distance}
              isActive={place.isActive}
              isCurrentLocation={place.isCurrentLocation}
              onToggle={(val) => handleToggle(place.id, val)}
              onPress={() => {
                navigation.navigate('PlaceDetail', { placeId: place.id });
              }}
              disabled={isPaused} // Disable controls if system paused? or distinct logic
            />
          ))}
        </View>
        
        <View style={{ height: 100 }} /> 
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity 
        style={styles.fab}
        onPress={() => {
          navigation.navigate('AddPlace');
        }}
        activeOpacity={0.9}
      >
        <MaterialIcon name="add" size={32} color={theme.colors.white} />
      </TouchableOpacity>
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
  seeAllText: {
    fontFamily: theme.typography.primary,
    fontSize: theme.typography.sizes.sm,
    fontWeight: theme.typography.weights.medium,
    color: theme.colors.primary,
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
});
