const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  session,
} = require('electron');

const APP_ROOT = path.resolve(__dirname, '..');
const DIST_DIR = path.join(APP_ROOT, 'dist');
const CHROME_LIKE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

function loadAuthDomain() {
  try {
    const cfgPath = path.join(APP_ROOT, 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (typeof parsed.authDomain === 'string' && parsed.authDomain.trim()) {
        return parsed.authDomain.trim();
      }
    }
  } catch {
    // Fallback below
  }
  return 'gen-lang-client-0708282100.firebaseapp.com';
}

const AUTH_DOMAIN = loadAuthDomain();
const AUTH_BRIDGE_ORIGIN = `https://${AUTH_DOMAIN}`;
const AUTH_BRIDGE_PREFIX = '/__nexus_app__/';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// Enable smooth audio playback & hardware WebGL inside Windows desktop shell
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

let mainWindow = null;
let authProtocolInstalled = false;
let activeAuthWindow = null;

function ensureSingleInstanceLock() {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  return true;
}

function setupMainPermissions() {
  const allowedPermissions = new Set(['pointerLock', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return allowedPermissions.has(permission);
  });
}

function ensureAuthBridgeProtocol(authSession) {
  if (authProtocolInstalled) return;
  authProtocolInstalled = true;

  authSession.protocol.handle('https', async (request) => {
    try {
      const url = new URL(request.url);
      if (url.origin === AUTH_BRIDGE_ORIGIN && url.pathname.startsWith(AUTH_BRIDGE_PREFIX)) {
        const rel = decodeURIComponent(url.pathname.slice(AUTH_BRIDGE_PREFIX.length)) || 'desktop-auth.html';
        const candidatePath = path.resolve(DIST_DIR, rel);
        if (
          candidatePath.startsWith(DIST_DIR + path.sep) &&
          fs.existsSync(candidatePath) &&
          fs.statSync(candidatePath).isFile()
        ) {
          const buf = fs.readFileSync(candidatePath);
          return new Response(buf, {
            status: 200,
            headers: {
              'Content-Type': getMimeType(candidatePath),
              'Cache-Control': 'no-store',
            },
          });
        }
        return new Response('Not Found', { status: 404 });
      }
    } catch {
      // Fall through to live HTTPS fetch
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });
}

function isAllowedAuthNavigation(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host === AUTH_DOMAIN.toLowerCase() ||
      host === 'accounts.google.com' ||
      host.endsWith('.google.com') ||
      host.endsWith('.googleusercontent.com') ||
      host.endsWith('.gstatic.com') ||
      host.endsWith('.googleapis.com')
    );
  } catch {
    return false;
  }
}

function openDesktopGoogleSignIn() {
  if (activeAuthWindow && !activeAuthWindow.isDestroyed()) {
    activeAuthWindow.focus();
    return Promise.reject(new Error('Google Sign-In window is already open.'));
  }

  return new Promise((resolve, reject) => {
    const authSession = session.fromPartition('persist:nexus-google-auth');
    authSession.setUserAgent(CHROME_LIKE_UA);
    ensureAuthBridgeProtocol(authSession);

    let settled = false;
    const cleanup = () => {
      ipcMain.removeListener('nexus:googleSignInResult', onResult);
      activeAuthWindow = null;
    };

    const finishSuccess = (payload) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (authWin && !authWin.isDestroyed()) {
        authWin.close();
      }
      resolve(payload);
    };

    const finishError = (message) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (authWin && !authWin.isDestroyed()) {
        authWin.close();
      }
      reject(new Error(message));
    };

    const onResult = (event, payload) => {
      if (!authWin || authWin.isDestroyed() || event.sender !== authWin.webContents) {
        return;
      }
      if (payload && payload.ok && typeof payload.idToken === 'string' && payload.idToken) {
        finishSuccess({
          idToken: payload.idToken,
          accessToken: typeof payload.accessToken === 'string' ? payload.accessToken : undefined,
        });
      } else {
        finishError(
          (payload && typeof payload.error === 'string' && payload.error) ||
            'Google sign-in popup was closed before finishing.',
        );
      }
    };

    const authWin = new BrowserWindow({
      width: 500,
      height: 660,
      parent: mainWindow || undefined,
      modal: Boolean(mainWindow),
      show: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      autoHideMenuBar: true,
      backgroundColor: '#070b14',
      title: 'NEXUS ROYALE — Google Sign-In',
      icon: fs.existsSync(path.join(APP_ROOT, 'build', 'icon.ico'))
        ? path.join(APP_ROOT, 'build', 'icon.ico')
        : undefined,
      webPreferences: {
        session: authSession,
        preload: path.join(__dirname, 'auth-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    activeAuthWindow = authWin;

    authWin.setMenuBarVisibility(false);
    authWin.webContents.setUserAgent(CHROME_LIKE_UA);
    authWin.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedAuthNavigation(url)) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 680,
            autoHideMenuBar: true,
            webPreferences: {
              session: authSession,
              contextIsolation: true,
              nodeIntegration: false,
              sandbox: true,
            },
          },
        };
      }
      return { action: 'deny' };
    });

    authWin.webContents.on('will-navigate', (ev, targetUrl) => {
      if (!isAllowedAuthNavigation(targetUrl)) {
        ev.preventDefault();
      }
    });

    authWin.on('closed', () => {
      finishError('Google sign-in popup was closed before finishing.');
    });

    ipcMain.on('nexus:googleSignInResult', onResult);
    void authWin.loadURL(`${AUTH_BRIDGE_ORIGIN}${AUTH_BRIDGE_PREFIX}desktop-auth.html`);
  });
}

function createMainWindow() {
  const iconPath = path.join(APP_ROOT, 'build', 'icon.ico');
  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    minWidth: 960,
    minHeight: 540,
    fullscreen: true,
    autoHideMenuBar: true,
    backgroundColor: '#070b14',
    title: 'NEXUS ROYALE',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      webgl: true,
    },
  });

  win.setMenuBarVisibility(false);

  // Support F11 and Alt+Enter desktop fullscreen toggles
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });

  // Block untrusted external popups/navigations inside main game view
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith('file://')) {
      ev.preventDefault();
    }
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });

  mainWindow = win;
  void win.loadFile(path.join(DIST_DIR, 'index.html'));
}

function registerIpcHandlers() {
  ipcMain.handle('nexus:toggleFullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const next = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(next);
    return next;
  });

  ipcMain.handle('nexus:setFullscreen', (_ev, fullscreen) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    const target = Boolean(fullscreen);
    mainWindow.setFullScreen(target);
    return target;
  });

  ipcMain.handle('nexus:isFullscreen', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    return mainWindow.isFullScreen();
  });

  ipcMain.handle('nexus:googleSignIn', () => openDesktopGoogleSignIn());

  ipcMain.handle('nexus:googleSignOut', async () => {
    try {
      const authSession = session.fromPartition('persist:nexus-google-auth');
      await authSession.clearStorageData();
    } catch {
      // Non-fatal
    }
  });
}

if (ensureSingleInstanceLock()) {
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    setupMainPermissions();
    registerIpcHandlers();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
