// database/helpers/RealmWriteHelper.ts

import { Realm } from 'realm';

/**
 * Safe write transaction wrapper that prevents nested transactions
 */
export class RealmWriteHelper {
  /**
   * Executes a write transaction safely, avoiding nested transaction errors
   * @param realm - The Realm instance
   * @param callback - The write operation to perform
   * @param debugLabel - Label for logging (helps debug which write failed)
   */
  static safeWrite<T>(
    realm: Realm | null,
    callback: () => T,
    debugLabel: string = 'unknown'
  ): T | null {
    if (!realm || realm.isClosed) {
      console.warn(`[RealmWrite:${debugLabel}] Realm is null or closed`);
      return null;
    }

    // If already in transaction, execute directly without nesting
    if (realm.isInTransaction) {
      console.warn(
        `[RealmWrite:${debugLabel}] Already in transaction, executing directly`
      );
      return callback();
    }

    // Start new transaction
    try {
      let result: T;
      realm.write(() => {
        result = callback();
      });
      return result!;
    } catch (error) {
      console.error(`[RealmWrite:${debugLabel}] Write failed:`, error);
      return null;
    }
  }

  /**
   * Defers a write to the next tick to avoid conflicts
   * Useful for writes triggered by listeners
   */
  static deferredWrite<T>(
    realm: Realm | null,
    callback: () => T,
    debugLabel: string = 'deferred'
  ): Promise<T | null> {
    return new Promise((resolve) => {
      // Wait for current transaction to complete
      setImmediate(() => {
        const result = RealmWriteHelper.safeWrite(realm, callback, debugLabel);
        resolve(result);
      });
    });
  }

  /**
   * Batch multiple writes into a single transaction
   * More efficient than multiple separate writes
   */
  static batchWrite(
    realm: Realm | null,
    operations: Array<{ callback: () => void; label: string }>,
    debugLabel: string = 'batch'
  ): boolean {
    if (!realm || realm.isClosed) {
      console.warn(`[RealmWrite:${debugLabel}] Realm is null or closed`);
      return false;
    }

    if (realm.isInTransaction) {
      console.warn(
        `[RealmWrite:${debugLabel}] Already in transaction, cannot batch`
      );
      return false;
    }

    try {
      realm.write(() => {
        for (const op of operations) {
          try {
            op.callback();
          } catch (error) {
            console.error(
              `[RealmWrite:${debugLabel}:${op.label}] Operation failed:`,
              error
            );
          }
        }
      });
      return true;
    } catch (error) {
      console.error(`[RealmWrite:${debugLabel}] Batch write failed:`, error);
      return false;
    }
  }
}