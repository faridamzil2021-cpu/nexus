import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import {
  doc,
  enableNetwork,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

export type OperationType = (typeof OperationType)[keyof typeof OperationType];

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: Array<{
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }>;
  };
}

export const firebaseApp: FirebaseApp =
  getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

export const firebaseAuth: Auth = getAuth(firebaseApp);

function createFirestoreInstance(): Firestore {
  if (typeof window !== 'undefined') {
    try {
      return initializeFirestore(
        firebaseApp,
        {
          experimentalForceLongPolling: true,
        },
        firebaseConfig.firestoreDatabaseId,
      );
    } catch {
      // Fallback if Firestore was already initialized (e.g., module reload)
      return getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
    }
  }
  return getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
}

export const firestoreDb: Firestore = createFirestoreInstance();

export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({
  prompt: 'select_account',
});

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
): never {
  const user = firebaseAuth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.uid,
      email: user?.email,
      emailVerified: user?.emailVerified,
      isAnonymous: user?.isAnonymous,
      tenantId: user?.tenantId,
      providerInfo:
        user?.providerData.map((provider) => ({
          providerId: provider.providerId,
          displayName: provider.displayName,
          email: provider.email,
          photoUrl: provider.photoURL,
        })) ?? [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

let connectionTested = false;

export async function verifyFirestoreConnection(): Promise<void> {
  if (connectionTested) return;
  connectionTested = true;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return;
  }

  const probe = () => getDocFromServer(doc(firestoreDb, 'test', 'connection'));

  try {
    await probe();
  } catch (error) {
    const isOfflineErr =
      error instanceof Error && error.message.includes('the client is offline');
    if (!isOfflineErr) {
      // Other errors (such as permission-denied on non-existent test doc) confirm connectivity
      return;
    }

    // Retry once after ensuring network is enabled (handles transient startup/iframe contention)
    try {
      await enableNetwork(firestoreDb);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1200);
      });
      await probe();
    } catch (retryError) {
      if (retryError instanceof Error && retryError.message.includes('the client is offline')) {
        console.error(
          'Please check your Firebase configuration. Firestore client is offline.',
        );
      }
    }
  }
}
