import Realm from 'realm';

export const ScheduleSchema: Realm.ObjectSchema = {
  name: 'Schedule',
  primaryKey: 'id',
  properties: {
    id: 'string', // UUID
    startTime: 'string', // HH:mm format
    endTime: 'string', // HH:mm format
    days: { type: 'list', objectType: 'string', default: [] }, // ['Monday', 'Tuesday', etc.]
    label: { type: 'string', default: 'Active' },
    createdAt: 'date',
  },
};

export const PlaceSchema: Realm.ObjectSchema = {
  name: 'Place',
  primaryKey: 'id',
  properties: {
    id: 'string', // UUID
    name: 'string',
    latitude: 'double',
    longitude: 'double',
    radius: { type: 'int', default: 50 },
    isEnabled: { type: 'bool', default: true },
    category: { type: 'string', default: 'other' },
    icon: { type: 'string', default: 'place' },
    createdAt: 'date',
    updatedAt: 'date',
    lastCheckInAt: 'date?',
    totalCheckIns: { type: 'int', default: 0 },
    isInside: { type: 'bool', default: false },
    schedules: 'Schedule[]', // Link to schedules
    prayerConfig: 'PrayerConfig?', // Embedded object for auto calculation
  },
};

export const CheckInLogSchema: Realm.ObjectSchema = {
  name: 'CheckInLog',
  primaryKey: 'id',
  properties: {
    id: 'string', // UUID
    placeId: 'string',
    checkInTime: 'date',
    checkOutTime: 'date?',
    durationMinutes: 'int?',
    savedVolumeLevel: 'int?',
    savedMediaVolume: 'int?',
    wasAutomatic: { type: 'bool', default: true },
  },
};

export const PreferencesSchema: Realm.ObjectSchema = {
  name: 'Preferences',
  primaryKey: 'id',
  properties: {
    id: 'string', // Always "USER_PREFS"
    onboardingCompleted: { type: 'bool', default: false },
    trackingEnabled: { type: 'bool', default: true },
    notificationsEnabled: { type: 'bool', default: true },
    maxPlaces: { type: 'int', default: 3 },
    databaseSeeded: { type: 'bool', default: false },
  },
};

export const PrayerConfigSchema: Realm.ObjectSchema = {
  name: 'PrayerConfig',
  embedded: true,
  properties: {
    method: { type: 'string', default: 'ISNA' },
    madhab: { type: 'string', default: 'Hanafi' },
    adjustments: { type: 'list', objectType: 'int', default: [0, 0, 0, 0, 0] },
  },
};

import { SystemLogSchema } from './schemas/SystemLog';

// Add to schema list
export const schemas = [
  PlaceSchema,
  ScheduleSchema,
  PrayerConfigSchema,
  CheckInLogSchema,
  PreferencesSchema,
  SystemLogSchema,
];
export const SCHEMA_VERSION = 7;
