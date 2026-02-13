import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import Realm from 'realm';
import { schemas, SCHEMA_VERSION } from './schemas';
import { migrateFromAsyncStorage } from './migration';

const RealmContext = createContext<Realm | null>(null);

// ─── Shared instance so background tasks (index.js) can reuse it ────────────
let _sharedRealmInstance: Realm | null = null;

export const getSharedRealm = (): Realm | null => _sharedRealmInstance;
// ─────────────────────────────────────────────────────────────────────────────

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

  // FIX #1: Use a ref to hold the live instance.
  // The useEffect cleanup closure captures the ref (not the state value),
  // so it always has the correct instance when unmounting — even though
  // state was null at the time the effect first ran.
  const realmRef = useRef<Realm | null>(null);

  useEffect(() => {
    const initRealm = async () => {
      try {
        const realmInstance = await Realm.open({
          schema: schemas,
          schemaVersion: SCHEMA_VERSION,
        });

        await migrateFromAsyncStorage(realmInstance);

        // FIX #2: Keep both the ref and the shared module-level pointer in sync
        realmRef.current = realmInstance;
        _sharedRealmInstance = realmInstance;

        setRealm(realmInstance);
      } catch (err: any) {
        console.error('[RealmProvider] 🔥 Initialization Error:', err);
        setError(err);
      }
    };

    initRealm();

    return () => {
      // FIX #1 (cont): Close via the ref — never stale, always correct
      if (realmRef.current && !realmRef.current.isClosed) {
        realmRef.current.close();
        realmRef.current = null;
        _sharedRealmInstance = null;
      }
    };
  }, []); // empty array is safe now because we close via ref, not state

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