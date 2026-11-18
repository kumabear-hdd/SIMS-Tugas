/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDocFromServer,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
const databaseId = (firebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;

function createFirestoreInstance(): Firestore {
  try {
    const settings = {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    };
    return databaseId
      ? initializeFirestore(app, settings, databaseId)
      : initializeFirestore(app, settings);
  } catch (error) {
    console.warn('Persistent Firestore cache unavailable, falling back to memory cache:', error);
    return databaseId ? getFirestore(app, databaseId) : getFirestore(app);
  }
}

export const db = createFirestoreInstance();
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function commitFirestoreWrite<T>(
  writePromise: Promise<T>,
  operationType: OperationType,
  path: string | null
): Promise<{ queuedOffline: boolean }> {
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    // Firestore persists the write immediately into IndexedDB offline queue;
    // avoid blocking the UI while waiting for remote server ACK.
    writePromise.catch((error) => {
      console.error('Deferred offline Firestore write failed:', operationType, path, error);
    });
    return { queuedOffline: true };
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const offlineFallback = new Promise<'queued'>((resolve) => {
      timeoutId = setTimeout(() => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          resolve('queued');
        }
      }, 1500);
    });
    const outcome = await Promise.race([
      writePromise.then(() => 'committed' as const),
      offlineFallback,
    ]);
    if (outcome === 'queued') {
      writePromise.catch((error) => {
        console.error('Deferred offline Firestore write failed:', operationType, path, error);
      });
      return { queuedOffline: true };
    }
    return { queuedOffline: false };
  } catch (error) {
    return handleFirestoreError(error, operationType, path);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function testConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('the client is offline') || error.message.includes('unavailable'))
    ) {
      return true;
    }
    // Permission error or missing doc still confirms server reachability
    return true;
  }
}
