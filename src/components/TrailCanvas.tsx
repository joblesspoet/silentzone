import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import Svg, {
  Path,
  Circle,
  Defs,
  RadialGradient,
  Stop,
} from 'react-native-svg';
import { TrailPoint } from '../services/TrailRecorder';

interface TrailCanvasProps {
  points: TrailPoint[];
  width: number;
  height: number;
  padding?: number;
}

const TrailCanvas: React.FC<TrailCanvasProps> = ({
  points,
  width,
  height,
  padding = 20,
}) => {
  if (!points || points.length < 2) {
    return (
      <View style={[styles.container, { width, height }]}>
        {/* Placeholder or empty state */}
      </View>
    );
  }

  // 1. Calculate Bounding Box
  let minLat = points[0].latitude;
  let maxLat = points[0].latitude;
  let minLng = points[0].longitude;
  let maxLng = points[0].longitude;

  points.forEach(p => {
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
  });

  // Add some padding to the bounds to prevent cutting off at edges
  // Ensure we have a non-zero span even if all points are identical
  const latSpan = maxLat - minLat || 0.0001;
  const lngSpan = maxLng - minLng || 0.0001;

  // 2. Map Function (Geo -> Screen)
  // We use a simple equirectangular projection for small areas.
  // Y axis is inverted (Lat goes up, Screen Y goes down)
  const getX = (lng: number) => {
    // If all points are the same longitude, center horizontally
    if (lngSpan <= 0.0001) return width / 2;

    const relativeLng = lng - minLng;
    const ratio = relativeLng / lngSpan;
    return padding + ratio * (width - 2 * padding);
  };

  const getY = (lat: number) => {
    // If all points are the same latitude, center vertically
    if (latSpan <= 0.0001) return height / 2;

    const relativeLat = lat - minLat;
    const ratio = relativeLat / latSpan;
    // Invert Y: 1.0 (maxLat) -> 0 (top), 0.0 (minLat) -> 1 (bottom)
    return height - (padding + ratio * (height - 2 * padding));
  };

  // Log for debugging
  console.log('TrailCanvas Debug:', {
    pointsCount: points.length,
    bounds: { minLat, maxLat, minLng, maxLng },
    spans: { latSpan, lngSpan },
    firstPoint: {
      raw: points[0],
      mapped: { x: getX(points[0].longitude), y: getY(points[0].latitude) },
    },
  });

  // 3. Construct Path
  let pathD = `M ${getX(points[0].longitude)} ${getY(points[0].latitude)}`;
  points.slice(1).forEach(p => {
    pathD += ` L ${getX(p.longitude)} ${getY(p.latitude)}`;
  });

  // 4. Identify Special Points
  const startPoint = points[0];
  const endPoint = points[points.length - 1];
  const stationaryPoints = points.filter(p => p.isStationary);

  // Group stationary points into clusters visually?
  // For now, just render them as slightly larger dots.

  return (
    <View style={[styles.container, { width, height }]}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient
            id="grad"
            cx="50%"
            cy="50%"
            r="50%"
            fx="50%"
            fy="50%"
            gradientUnits="userSpaceOnUse"
          >
            <Stop offset="0%" stopColor="#ff0" stopOpacity="0.8" />
            <Stop offset="100%" stopColor="#f00" stopOpacity="0" />
          </RadialGradient>
        </Defs>

        {/* The Path */}
        <Path
          d={pathD}
          stroke="#4A90E2"
          strokeWidth="3"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Start Point (Green) */}
        <Circle
          cx={getX(startPoint.longitude)}
          cy={getY(startPoint.latitude)}
          r="6"
          fill="#4CD964"
          stroke="#fff"
          strokeWidth="2"
        />

        {/* End Point (Red) */}
        <Circle
          cx={getX(endPoint.longitude)}
          cy={getY(endPoint.latitude)}
          r="6"
          fill="#FF3B30"
          stroke="#fff"
          strokeWidth="2"
        />

        {/* Stationary Clusters (Glowing Yellow/Orange) */}
        {stationaryPoints.map((p, i) => (
          <Circle
            key={`stat-${i}`}
            cx={getX(p.longitude)}
            cy={getY(p.latitude)}
            r="4" // Small dot
            fill="#FF9500"
            opacity={0.6}
          />
        ))}
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    overflow: 'hidden',
  },
});

export default TrailCanvas;
