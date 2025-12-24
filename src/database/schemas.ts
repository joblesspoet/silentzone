import Realm from 'realm';

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
    createdAt: 'date',
    updatedAt: 'date',
    lastCheckInAt: 'date?',
    totalCheckIns: { type: 'int', default: 0 },
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
  },
};

export const schema = [PlaceSchema, CheckInLogSchema, PreferencesSchema];
export const SCHEMA_VERSION = 1;
