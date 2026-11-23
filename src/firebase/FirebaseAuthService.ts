import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  signOut,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import { isCapacitorNative, isElectronDesktop } from '../config/RuntimeConfig';
import { firebaseAuth, googleAuthProvider, verifyFirestoreConnection } from './firebaseApp';

export interface FirebaseAuthUserSummary {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string | null;
  emailVerified: boolean;
}

export interface FirebaseAuthState {
  initialized: boolean;
  busy: boolean;
  user: FirebaseAuthUserSummary | null;
  error: string | null;
}

export type FirebaseAuthListener = (state: FirebaseAuthState, rawUser: User | null) => void;

function toUserSummary(user: User | null): FirebaseAuthUserSummary | null {
  if (!user) return null;
  return {
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? '',
    photoURL: user.photoURL ?? null,
    emailVerified: user.emailVerified,
  };
}

function mapFirebaseAuthErrorMessage(err: unknown): string {
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code ?? '')
      : '';
  switch (code) {
    case 'auth/popup-closed-by-user':
      return 'Google sign-in popup was closed before finishing.';
    case 'auth/cancelled-popup-request':
      return 'Sign-in request was cancelled by a newer popup.';
    case 'auth/popup-blocked':
      return 'Popup was blocked by your browser. Please allow popups for this site and try again.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized in Firebase Console -> Authentication -> Settings -> Authorized domains.';
    case 'auth/network-request-failed':
      return 'Network error while contacting Google Authentication. Check your connection and try again.';
    default:
      return err instanceof Error ? err.message : 'Unable to sign in with Google.';
  }
}

export class FirebaseAuthService {
  private state: FirebaseAuthState = {
    initialized: false,
    busy: false,
    user: null,
    error: null,
  };
  private currentUser: User | null = null;
  private readonly listeners = new Set<FirebaseAuthListener>();
  private readonly unsubAuth: Unsubscribe;
  private initialAuthResolve: ((user: User | null) => void) | null = null;
  private readonly initialAuthPromise: Promise<User | null>;

  constructor() {
    this.initialAuthPromise = new Promise<User | null>((resolve) => {
      this.initialAuthResolve = resolve;
    });

    this.unsubAuth = onAuthStateChanged(
      firebaseAuth,
      (user) => {
        this.currentUser = user;
        this.state = {
          initialized: true,
          busy: false,
          user: toUserSummary(user),
          error: null,
        };
        if (this.initialAuthResolve) {
          this.initialAuthResolve(user);
          this.initialAuthResolve = null;
          void verifyFirestoreConnection();
        }
        this.emit();
      },
      (error) => {
        this.currentUser = null;
        this.state = {
          initialized: true,
          busy: false,
          user: null,
          error: mapFirebaseAuthErrorMessage(error),
        };
        if (this.initialAuthResolve) {
          this.initialAuthResolve(null);
          this.initialAuthResolve = null;
        }
        this.emit();
      },
    );
  }

  getState(): FirebaseAuthState {
    return { ...this.state };
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  isSignedIn(): boolean {
    return Boolean(this.currentUser && this.currentUser.emailVerified);
  }

  waitForInitialAuth(): Promise<User | null> {
    return this.initialAuthPromise;
  }

  async getIdToken(forceRefresh = false): Promise<string | null> {
    if (!this.currentUser) return null;
    try {
      return await this.currentUser.getIdToken(forceRefresh);
    } catch {
      return null;
    }
  }

  async signInWithGoogle(): Promise<User> {
    this.state = { ...this.state, busy: true, error: null };
    this.emit();
    try {
      let user: User;

      if (isCapacitorNative()) {
        const result = await FirebaseAuthentication.signInWithGoogle({
          useCredentialManager: true,
        });
        const idToken = result.credential?.idToken;
        const accessToken = result.credential?.accessToken;
        if (!idToken) {
          throw new Error('Google Sign-In on Android did not return an ID token.');
        }
        const credential = GoogleAuthProvider.credential(idToken, accessToken ?? undefined);
        const signedIn = await signInWithCredential(firebaseAuth, credential);
        user = signedIn.user;
      } else if (isElectronDesktop() && window.nexusDesktop) {
        const result = await window.nexusDesktop.signInWithGoogle();
        const credential = GoogleAuthProvider.credential(
          result.idToken,
          result.accessToken ?? undefined,
        );
        const signedIn = await signInWithCredential(firebaseAuth, credential);
        user = signedIn.user;
      } else {
        const cred = await signInWithPopup(firebaseAuth, googleAuthProvider);
        user = cred.user;
      }

      this.currentUser = user;
      this.state = {
        initialized: true,
        busy: false,
        user: toUserSummary(user),
        error: null,
      };
      this.emit();
      return user;
    } catch (error) {
      const message = mapFirebaseAuthErrorMessage(error);
      this.state = {
        ...this.state,
        busy: false,
        error: message,
      };
      this.emit();
      throw new Error(message);
    }
  }

  async signOutUser(beforeSignOut?: () => Promise<void> | void): Promise<void> {
    this.state = { ...this.state, busy: true, error: null };
    this.emit();
    try {
      if (beforeSignOut) {
        await beforeSignOut();
      }
      if (isCapacitorNative()) {
        await FirebaseAuthentication.signOut().catch(() => {});
      } else if (isElectronDesktop() && window.nexusDesktop) {
        await window.nexusDesktop.signOutGoogle().catch(() => {});
      }
      await signOut(firebaseAuth);
      this.currentUser = null;
      this.state = {
        initialized: true,
        busy: false,
        user: null,
        error: null,
      };
      this.emit();
    } catch (error) {
      const message = mapFirebaseAuthErrorMessage(error);
      this.state = {
        ...this.state,
        busy: false,
        error: message,
      };
      this.emit();
      throw new Error(message);
    }
  }

  onChange(listener: FirebaseAuthListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.getState();
    for (const listener of this.listeners) {
      listener(snap, this.currentUser);
    }
  }

  dispose(): void {
    this.unsubAuth();
    this.listeners.clear();
  }
}
