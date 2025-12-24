import React, { createContext, useContext, useEffect, useState } from 'react';
import Realm from 'realm';
import { schema, SCHEMA_VERSION } from './schemas';
import { migrateFromAsyncStorage } from './migration';

const RealmContext = createContext<Realm | null>(null);

export const useRealm = () => {
  const realm = useContext(RealmContext);
  if (!realm) {
    throw new Error('useRealm must be used within a RealmProvider');
  }
  return realm;
};

export const RealmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [realm, setRealm] = useState<Realm | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const initRealm = async () => {
      try {
        const realmInstance = await Realm.open({
          schema: schema,
          schemaVersion: SCHEMA_VERSION,
        });
        
        // Run migration from AsyncStorage if needed
        await migrateFromAsyncStorage(realmInstance);
        
        setRealm(realmInstance);
      } catch (err: any) {
        console.error('Failed to open Realm:', err);
        setError(err);
      }
    };

    initRealm();

    return () => {
      if (realm && !realm.isClosed) {
        realm.close();
      }
    };
  }, []);

  if (error) {
    // In a real app, show a proper error screen
    return null;
  }

  if (!realm) {
    // Return null or a splash screen while loading
    return null; 
  }

  return (
    <RealmContext.Provider value={realm}>
      {children}
    </RealmContext.Provider>
  );
};
