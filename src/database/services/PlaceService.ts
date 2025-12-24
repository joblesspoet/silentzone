import Realm from 'realm';
import { generateUUID } from '../../utils/uuid';

export interface PlaceData {
  name: string;
  latitude: number;
  longitude: number;
  radius?: number;
}

export const PlaceService = {
  getAllPlaces: (realm: Realm) => {
    return realm.objects('Place').sorted('createdAt', true);
  },

  getEnabledPlaces: (realm: Realm) => {
    return realm.objects('Place').filtered('isEnabled == true');
  },

  getPlaceById: (realm: Realm, id: string) => {
    return realm.objectForPrimaryKey('Place', id);
  },

  createPlace: (realm: Realm, data: PlaceData) => {
    let place;
    realm.write(() => {
      place = realm.create('Place', {
        id: generateUUID(),
        name: data.name,
        latitude: data.latitude,
        longitude: data.longitude,
        radius: data.radius || 50,
        createdAt: new Date(),
        updatedAt: new Date(),
        isEnabled: true,
        totalCheckIns: 0,
      });
    });
    return place;
  },

  updatePlace: (realm: Realm, id: string, data: Partial<PlaceData> & { isEnabled?: boolean }) => {
    const place = realm.objectForPrimaryKey('Place', id);
    if (place) {
      realm.write(() => {
        place.name = data.name !== undefined ? data.name : place.name;
        place.latitude = data.latitude !== undefined ? data.latitude : place.latitude;
        place.longitude = data.longitude !== undefined ? data.longitude : place.longitude;
        place.radius = data.radius !== undefined ? data.radius : place.radius;
        place.isEnabled = data.isEnabled !== undefined ? data.isEnabled : place.isEnabled;
        place.updatedAt = new Date();
      });
      return true;
    }
    return false;
  },

  deletePlace: (realm: Realm, id: string) => {
    const place = realm.objectForPrimaryKey('Place', id);
    if (place) {
      realm.write(() => {
        realm.delete(place);
      });
      return true;
    }
    return false;
  },

  togglePlaceEnabled: (realm: Realm, id: string) => {
    const place = realm.objectForPrimaryKey('Place', id);
    if (place) {
      realm.write(() => {
        place.isEnabled = !place.isEnabled;
        place.updatedAt = new Date();
      });
      return place.isEnabled;
    }
    return null;
  },

  getPlacesCount: (realm: Realm) => {
    return realm.objects('Place').length;
  },

  canAddMorePlaces: (realm: Realm, maxPlaces: number = 3) => {
    return realm.objects('Place').length < maxPlaces;
  }
};
