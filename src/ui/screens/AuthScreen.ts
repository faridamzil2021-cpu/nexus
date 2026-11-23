import authBackdropUrl from '../../assets/images/nexus_auth_backdrop_1795393680202.jpg';
import type { FirebaseAuthState } from '../../firebase/FirebaseAuthService';
import { i18n } from '../../i18n/I18nManager';

export interface AuthScreenPreparedAccount {
  uid: string;
  username: string;
  playerId: string;
  numericId: string;
  isNewAccount?: boolean;
}

export interface AuthScreenViewState {
  authState: FirebaseAuthState;
  preparingAccount: boolean;
  enteringLobby: boolean;
  preparedAccount: AuthScreenPreparedAccount | null;
  errorMessage: string | null;
}

export interface AuthScreenCallbacks {
  onGoogleSignIn: () => Promise<void>;
  onGoogleSignOut: () => Promise<void>;
  onLoginEnterGame: () => Promise<void>;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const GOOGLE_MARK_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" class="shrink-0">
    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"/>
    <path fill="#34A853" d="M12 24c3.3 0 6.08-1.09 8.11-2.96l-3.88-3.05c-1.08.72-2.45 1.16-4.23 1.16-3.25 0-6.01-2.2-6.99-5.15H1.01v3.14C3.05 21.2 7.21 24 12 24Z"/>
    <path fill="#FBBC05" d="M5.01 14c-.25-.74-.39-1.54-.39-2.36 0-.82.14-1.62.39-2.36V6.14H1.01C.37 7.42 0 8.87 0 10.38s.37 2.96 1.01 4.24l4-3.14Z" transform="translate(0 1.26)"/>
    <path fill="#EA4335" d="M12 4.75c1.79 0 3.4.62 4.67 1.83l3.5-3.5C18.07 1.19 15.3 0 12 0 7.21 0 3.05 2.8 1.01 6.86l4 3.14c.98-2.95 3.74-5.25 6.99-5.25Z"/>
  </svg>
`;

const NEXUS_LOGO_SVG = `
  <svg class="w-12 h-12 sm:w-16 sm:h-16 shrink-0" viewBox="0 0 64 64" fill="none" aria-hidden="true">
    <polygon points="32,4 58,19 58,45 32,60 6,45 6,19" stroke="#f97316" stroke-width="2.5" fill="rgba(249,115,22,0.12)" />
    <polygon points="32,14 48,23 48,41 32,50 16,41 16,23" stroke="#38bdf8" stroke-width="2" />
    <circle cx="32" cy="32" r="5" fill="#f97316" />
  </svg>
`;

export class AuthScreen {
  readonly element: HTMLElement;
  private readonly contentHostEl: HTMLElement;
  private i18nUnsubscribe: (() => void) | null = null;
  private viewState: AuthScreenViewState = {
    authState: {
      initialized: false,
      busy: false,
      user: null,
      error: null,
    },
    preparingAccount: false,
    enteringLobby: false,
    preparedAccount: null,
    errorMessage: null,
  };

  constructor(private readonly callbacks: AuthScreenCallbacks) {
    this.element = document.createElement('div');
    this.element.className =
      'absolute inset-0 z-40 flex flex-col justify-between bg-[#070b14] pointer-events-auto overflow-hidden';
    this.element.setAttribute('data-screen', 'auth');

    this.element.innerHTML = `
      <!-- Cinematic Battle Royale Key-Art Backdrop -->
      <div
        class="absolute inset-0 pointer-events-none overflow-hidden"
        style="background: radial-gradient(circle at 72% 28%, rgba(56,189,248,0.16) 0%, rgba(249,115,22,0.08) 34%, #070b14 78%);"
        aria-hidden="true"
      >
        <img
          src="${authBackdropUrl}"
          alt=""
          referrerpolicy="no-referrer"
          decoding="async"
          class="w-full h-full object-cover object-center opacity-80 nexus-auth-backdrop-anim select-none"
        />
        <div
          class="absolute inset-0"
          style="background: linear-gradient(108deg, rgba(7,11,20,0.94) 0%, rgba(7,11,20,0.78) 46%, rgba(7,11,20,0.52) 100%);"
        ></div>
        <div
          class="absolute inset-0"
          style="background: linear-gradient(180deg, rgba(7,11,20,0.72) 0%, rgba(7,11,20,0.18) 38%, rgba(7,11,20,0.88) 100%);"
        ></div>
      </div>

      <!-- Responsive Scrollable Layout Container -->
      <div
        data-role="auth-content-host"
        class="relative z-10 w-full h-full safe-pad nexus-scroll overflow-y-auto flex flex-col justify-between"
      ></div>
    `;

    this.contentHostEl = this.element.querySelector('[data-role="auth-content-host"]')!;
    this.render();

    this.i18nUnsubscribe = i18n.subscribe(() => {
      this.render();
    });
  }

  setState(next: Partial<AuthScreenViewState>): void {
    this.viewState = {
      ...this.viewState,
      ...next,
    };
    this.render();
  }

  private isLoginEnabled(): boolean {
    const { authState, preparingAccount, enteringLobby, preparedAccount } = this.viewState;
    return Boolean(
      authState.initialized &&
        !authState.busy &&
        !preparingAccount &&
        !enteringLobby &&
        authState.user &&
        authState.user.emailVerified &&
        preparedAccount &&
        preparedAccount.uid === authState.user.uid,
    );
  }

  private render(): void {
    const { authState, preparingAccount, enteringLobby, preparedAccount, errorMessage } =
      this.viewState;
    const user = authState.user;
    const isAuthenticated = Boolean(user && user.emailVerified);
    const hasVerifiedProfile = Boolean(
      isAuthenticated && preparedAccount && preparedAccount.uid === user?.uid,
    );
    const loginReady = this.isLoginEnabled();
    const combinedError = errorMessage || authState.error || null;
    const authBusy = authState.busy || preparingAccount || enteringLobby;

    const statusBlockHtml = (() => {
      if (!authState.initialized || (isAuthenticated && preparingAccount && !hasVerifiedProfile)) {
        const msg = !authState.initialized
          ? i18n.t('auth.restoringSession')
          : i18n.t('auth.preparingProfile');
        return `
          <div
            data-role="auth-status-loading"
            class="rounded-md bg-slate-900/90 border border-sky-400/35 px-3.5 py-3 flex items-center gap-3"
          >
            <span class="w-4 h-4 rounded-full border-2 border-sky-400 border-t-transparent animate-spin shrink-0" aria-hidden="true"></span>
            <span class="text-xs font-semibold text-slate-200">${escapeHtml(msg)}</span>
          </div>
        `;
      }

      if (hasVerifiedProfile && user && preparedAccount) {
        const avatarHtml = user.photoURL
          ? `<img src="${escapeHtml(user.photoURL)}" alt="" referrerpolicy="no-referrer" class="w-10 h-10 rounded-full border border-emerald-400/75 object-cover shrink-0 bg-slate-900" />`
          : `<span class="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-400/75 flex items-center justify-center text-sm font-black text-emerald-200 shrink-0">${escapeHtml((user.displayName || user.email || 'G').slice(0, 1).toUpperCase())}</span>`;

        return `
          <div
            data-role="auth-verified-box"
            class="rounded-md bg-emerald-950/55 border border-emerald-400/55 px-3.5 py-3 flex flex-col gap-2.5"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0">
                <svg class="w-4 h-4 text-emerald-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span class="text-[11px] font-black tracking-[0.12em] uppercase text-emerald-300 truncate">
                  ${escapeHtml(i18n.t('auth.authenticatedTitle'))}
                </span>
              </div>
              <button
                type="button"
                data-action="auth-sign-out"
                ${authBusy ? 'disabled' : ''}
                class="text-[10px] font-extrabold tracking-wider uppercase text-slate-300 hover:text-rose-300 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >${escapeHtml(i18n.t('auth.signOut'))}</button>
            </div>

            <div class="flex items-center gap-3 min-w-0 pt-1 border-t border-emerald-500/20">
              ${avatarHtml}
              <div class="min-w-0 flex-1">
                <div class="text-sm font-extrabold text-white truncate">
                  ${escapeHtml(preparedAccount.username)}
                </div>
                <div class="text-[11px] font-medium text-slate-300 truncate">
                  ${escapeHtml(user.email || user.displayName)}
                </div>
                <div class="text-[11px] font-extrabold tracking-wider uppercase text-sky-300 tabular-nums mt-0.5">
                  ${escapeHtml(i18n.t('auth.playerIdLabel'))}: ${escapeHtml(preparedAccount.numericId)}
                </div>
              </div>
            </div>

            <div class="text-[11px] font-semibold text-emerald-200/95">
              ${escapeHtml(i18n.t('auth.authenticatedReady'))}
            </div>
          </div>
        `;
      }

      return `
        <div
          data-role="auth-locked-hint"
          class="rounded-md bg-slate-900/80 border border-slate-700/75 px-3.5 py-2.5 text-xs font-medium text-slate-300"
        >
          ${escapeHtml(i18n.t('auth.loginLockedHint'))}
        </div>
      `;
    })();

    const errorBannerHtml = combinedError
      ? `
        <div
          role="alert"
          data-role="auth-error-box"
          class="rounded-md bg-rose-950/75 border border-rose-400/65 px-3.5 py-2.5 flex items-start gap-2.5 text-xs font-semibold text-rose-100"
        >
          <svg class="w-4 h-4 text-rose-400 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span class="leading-snug">${escapeHtml(combinedError)}</span>
        </div>
      `
      : '';

    const googleButtonLabel = authState.busy
      ? i18n.t('auth.signingIn')
      : isAuthenticated
        ? i18n.t('auth.googleSwitchBtn')
        : i18n.t('auth.googleSignInBtn');

    const loginButtonClasses = loginReady
      ? 'nexus-btn-primary w-full py-3.5 px-5 rounded-md font-black text-base tracking-[0.2em] uppercase flex items-center justify-center gap-2.5 min-h-[52px] cursor-pointer shadow-[0_0_28px_rgba(249,115,22,0.35)]'
      : 'w-full py-3.5 px-5 rounded-md font-black text-base tracking-[0.2em] uppercase flex items-center justify-center gap-2.5 min-h-[52px] bg-slate-800/75 border border-slate-700/75 text-slate-500 opacity-55 cursor-not-allowed select-none';

    const loginButtonIcon = loginReady
      ? `<svg class="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6,4 20,12 6,20" /></svg>`
      : `<svg class="w-4 h-4 shrink-0 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>`;

    const loginButtonLabel = enteringLobby ? i18n.t('auth.enteringLobby') : i18n.t('auth.loginBtn');

    this.contentHostEl.innerHTML = `
      <!-- Top Header Classification -->
      <header class="w-full max-w-6xl mx-auto flex items-center justify-between gap-3 shrink-0 pb-2">
        <div class="text-[10px] sm:text-xs font-extrabold tracking-[0.24em] uppercase text-sky-300/90">
          ${escapeHtml(i18n.t('auth.badge'))}
        </div>
        <div class="text-[10px] sm:text-xs font-bold tracking-[0.18em] uppercase text-slate-400">
          ${escapeHtml(i18n.t('loading.badge'))}
        </div>
      </header>

      <!-- Main Hero & Authentication Gate -->
      <main class="w-full max-w-6xl mx-auto my-auto py-3 sm:py-6 grid grid-cols-1 lg:grid-cols-[1.1fr_430px] items-center gap-6 sm:gap-10">
        <!-- Brand Hero Block -->
        <section class="flex flex-col items-center lg:items-start text-center lg:text-left gap-3 sm:gap-4">
          <div class="flex items-center gap-3 sm:gap-4">
            ${NEXUS_LOGO_SVG}
            <div class="flex flex-col items-start text-left">
              <h1 class="text-3xl sm:text-5xl xl:text-6xl font-black tracking-[0.14em] uppercase text-white leading-none drop-shadow-[0_4px_24px_rgba(0,0,0,0.85)]">
                ${escapeHtml(i18n.t('menu.title'))}
              </h1>
              <span class="mt-1.5 text-[11px] sm:text-xs font-extrabold tracking-[0.24em] uppercase text-orange-400">
                ${escapeHtml(i18n.t('loading.badge'))}
              </span>
            </div>
          </div>

          <p class="max-w-lg text-sm sm:text-lg font-semibold text-slate-200/95 leading-relaxed">
            "${escapeHtml(i18n.translateTagline(0))}"
          </p>

          <div class="hidden sm:flex flex-wrap items-center justify-center lg:justify-start gap-x-3 gap-y-1 text-xs font-bold tracking-wider uppercase text-slate-300/90">
            <span>${escapeHtml(i18n.t('auth.heroFeature1'))}</span>
            <span class="text-sky-400" aria-hidden="true">&middot;</span>
            <span>${escapeHtml(i18n.t('auth.heroFeature2'))}</span>
            <span class="text-sky-400" aria-hidden="true">&middot;</span>
            <span>${escapeHtml(i18n.t('auth.heroFeature3'))}</span>
          </div>
        </section>

        <!-- Authentication Control Card -->
        <section
          aria-label="${escapeHtml(i18n.t('auth.panelTitle'))}"
          class="w-full max-w-md mx-auto lg:mx-0 nexus-panel rounded-lg border border-sky-400/35 p-5 sm:p-6 flex flex-col gap-4"
        >
          <div class="flex flex-col gap-1 border-b border-slate-800/90 pb-3.5">
            <h2 class="text-sm sm:text-base font-black tracking-[0.16em] uppercase text-white">
              ${escapeHtml(i18n.t('auth.panelTitle'))}
            </h2>
            <p class="text-xs text-slate-300 leading-relaxed">
              ${escapeHtml(i18n.t('auth.panelSubtitle'))}
            </p>
          </div>

          ${errorBannerHtml}
          ${statusBlockHtml}

          <!-- Step 1: Google Sign-In Button -->
          <div class="flex flex-col gap-2.5 pt-1">
            <button
              type="button"
              data-action="auth-google-signin"
              ${authBusy ? 'disabled' : ''}
              class="w-full min-h-[48px] px-4 py-3 rounded-md bg-white hover:bg-slate-100 active:scale-[0.99] text-slate-900 border border-slate-200 font-extrabold text-xs sm:text-sm tracking-[0.08em] uppercase flex items-center justify-center gap-2.5 transition-all whitespace-nowrap shadow-md disabled:opacity-55 disabled:cursor-not-allowed"
            >
              ${GOOGLE_MARK_SVG}
              <span>${escapeHtml(googleButtonLabel)}</span>
            </button>

            <!-- Step 2: Separate LOGIN Button (Strictly Disabled Until Google Auth Succeeds) -->
            <button
              type="button"
              data-action="auth-login-enter"
              ${loginReady ? '' : 'disabled aria-disabled="true"'}
              class="${loginButtonClasses}"
            >
              ${loginButtonIcon}
              <span>${escapeHtml(loginButtonLabel)}</span>
            </button>
          </div>
        </section>
      </main>

      <!-- Bottom Spacer -->
      <footer class="w-full max-w-6xl mx-auto pt-2 flex items-center justify-between text-[10px] font-bold tracking-[0.18em] uppercase text-slate-500 shrink-0">
        <span>${escapeHtml(i18n.t('menu.title'))}</span>
        <span>${escapeHtml(i18n.translateTagline(1))}</span>
      </footer>
    `;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.contentHostEl
      .querySelector('[data-action="auth-google-signin"]')
      ?.addEventListener('click', () => {
        if (this.viewState.authState.busy || this.viewState.preparingAccount || this.viewState.enteringLobby) {
          return;
        }
        void this.callbacks.onGoogleSignIn().catch(() => {});
      });

    this.contentHostEl
      .querySelector('[data-action="auth-sign-out"]')
      ?.addEventListener('click', () => {
        if (this.viewState.authState.busy || this.viewState.preparingAccount || this.viewState.enteringLobby) {
          return;
        }
        void this.callbacks.onGoogleSignOut().catch(() => {});
      });

    this.contentHostEl
      .querySelector('[data-action="auth-login-enter"]')
      ?.addEventListener('click', () => {
        if (!this.isLoginEnabled()) {
          return;
        }
        void this.callbacks.onLoginEnterGame().catch(() => {});
      });
  }

  dispose(): void {
    this.i18nUnsubscribe?.();
    this.i18nUnsubscribe = null;
    this.element.remove();
  }
}
