import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

interface DesktopAuthChannel {
  submitResult: (payload: {
    ok: boolean;
    idToken?: string;
    accessToken?: string;
    error?: string;
  }) => void;
}

declare global {
  interface Window {
    nexusDesktopAuth?: DesktopAuthChannel;
  }
}

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });

const statusEl = document.getElementById('status-text');
const retryBtn = document.getElementById('retry-btn') as HTMLButtonElement | null;
const errEl = document.getElementById('err-text');

async function runSignIn(): Promise<void> {
  if (retryBtn) retryBtn.disabled = true;
  if (errEl) errEl.textContent = '';
  if (statusEl) statusEl.textContent = 'Select your Google account in the popup window...';

  try {
    const result = await signInWithPopup(auth, provider);
    const oauthCred = GoogleAuthProvider.credentialFromResult(result);
    const idToken = oauthCred?.idToken;
    if (!idToken) {
      throw new Error('Google Sign-In did not provide an ID token.');
    }
    if (statusEl) statusEl.textContent = 'Authentication complete. Returning to NEXUS ROYALE...';
    window.nexusDesktopAuth?.submitResult({
      ok: true,
      idToken,
      accessToken: oauthCred?.accessToken ?? undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Google authentication failed.';
    if (errEl) errEl.textContent = msg;
    if (statusEl) statusEl.textContent = 'Click below to retry Google Sign-In.';
    if (retryBtn) retryBtn.disabled = false;
  }
}

retryBtn?.addEventListener('click', () => {
  void runSignIn();
});

void runSignIn();
