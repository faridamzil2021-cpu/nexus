import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { RankedMatchServer } from './server/RankedMatchServer.ts';
import { RankedStore } from './server/RankedStore.ts';

function loadFirebaseConfig(): { projectId?: string; firestoreDatabaseId?: string } {
  try {
    const cfgPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(cfgPath)) {
      const parsed = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as {
        projectId?: unknown;
        firestoreDatabaseId?: unknown;
      };
      const projectId =
        typeof parsed.projectId === 'string' && parsed.projectId.trim()
          ? parsed.projectId.trim()
          : undefined;
      const firestoreDatabaseId =
        typeof parsed.firestoreDatabaseId === 'string' && parsed.firestoreDatabaseId.trim()
          ? parsed.firestoreDatabaseId.trim()
          : undefined;
      return { projectId, firestoreDatabaseId };
    }
  } catch {
    // Ignore missing/invalid config file
  }
  return {
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || undefined,
    firestoreDatabaseId: '(default)',
  };
}

const firebaseCfg = loadFirebaseConfig();
const firebaseProjectId = firebaseCfg.projectId;
const firestoreDatabaseId = firebaseCfg.firestoreDatabaseId ?? '(default)';
const firebaseAdminApp =
  getApps().length > 0
    ? getApp()
    : initializeApp(firebaseProjectId ? { projectId: firebaseProjectId } : undefined);

async function verifyRawFirebaseToken(token: string): Promise<DecodedIdToken | null> {
  const cleaned = token.trim();
  if (!cleaned || cleaned.length > 8192) {
    return null;
  }
  try {
    const decoded = await getAuth(firebaseAdminApp).verifyIdToken(cleaned);
    if (!decoded.uid || decoded.email_verified !== true) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

async function verifyFirebaseBearer(req: express.Request): Promise<DecodedIdToken | null> {
  const authHeader = req.headers.authorization;
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return verifyRawFirebaseToken(authHeader.slice(7));
}

function buildAllowedCorsOrigins(): Set<string> {
  const allowed = new Set<string>([
    'https://localhost',
    'http://localhost',
    'capacitor://localhost',
    'ionic://localhost',
    'file://',
    'null',
  ]);
  const envOrigins = [
    process.env.APP_URL,
    process.env.VITE_BACKEND_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS || '').split(','),
  ];
  for (const candidate of envOrigins) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim().replace(/\/+$/, '');
    if (!trimmed) continue;
    try {
      allowed.add(new URL(trimmed).origin);
    } catch {
      // Ignore malformed origin string
    }
  }
  return allowed;
}

function isAllowedNativeOrAppOrigin(origin: string, allowlist: Set<string>): boolean {
  if (allowlist.has(origin)) return true;
  if (origin.startsWith('http://localhost:') || origin.startsWith('https://localhost:')) {
    return true;
  }
  if (origin.startsWith('app://')) {
    return true;
  }
  return false;
}

export async function createAppServer(options?: {
  port?: number;
  storePath?: string;
  skipVite?: boolean;
}) {
  const app = express();
  const allowedCorsOrigins = buildAllowedCorsOrigins();

  app.use('/api', (req, res, next) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : '';
    if (origin && isAllowedNativeOrAppOrigin(origin, allowedCorsOrigins)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  const store = new RankedStore(options?.storePath);
  const matchServer = new RankedMatchServer(store, {
    firebaseProjectId,
    firestoreDatabaseId,
    verifyFirebaseToken: async (token: string) => {
      const decoded = await verifyRawFirebaseToken(token);
      return decoded ? { uid: decoded.uid } : null;
    },
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, status: matchServer.getOnlineStatus() });
  });

  app.get('/api/ranked/status', (_req, res) => {
    res.json(matchServer.getOnlineStatus());
  });

  app.post('/api/firebase/session', async (req, res) => {
    const decoded = await verifyFirebaseBearer(req);
    if (!decoded) {
      res.status(401).json({ error: 'Invalid or unverified Firebase ID token.', code: 'UNAUTHORIZED' });
      return;
    }
    const body = req.body ?? {};
    const existingCloudIds =
      body.existingCloudIds && typeof body.existingCloudIds === 'object'
        ? {
            playerId:
              typeof body.existingCloudIds.playerId === 'string'
                ? body.existingCloudIds.playerId
                : undefined,
            numericId:
              typeof body.existingCloudIds.numericId === 'string'
                ? body.existingCloudIds.numericId
                : undefined,
          }
        : undefined;
    const guestLink =
      body.guestLink && typeof body.guestLink === 'object'
        ? {
            playerId: typeof body.guestLink.playerId === 'string' ? body.guestLink.playerId : undefined,
            secretToken:
              typeof body.guestLink.secretToken === 'string' ? body.guestLink.secretToken : undefined,
          }
        : undefined;

    const result = store.resolveFirebaseSession({
      firebaseUid: decoded.uid,
      displayName:
        typeof body.displayName === 'string'
          ? body.displayName
          : typeof decoded.name === 'string'
            ? decoded.name
            : undefined,
      platform: body.platform,
      existingCloudIds,
      guestLink,
    });
    matchServer.syncSessionFromStore(result.profile.playerId);
    res.json({
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : '',
      profile: result.profile,
      secretToken: result.secretToken,
      created: result.created,
    });
  });

  app.post('/api/firebase/sync-cloud', async (req, res) => {
    const decoded = await verifyFirebaseBearer(req);
    if (!decoded) {
      res.status(401).json({ error: 'Invalid or unverified Firebase ID token.', code: 'UNAUTHORIZED' });
      return;
    }
    const body = req.body ?? {};
    const profile = store.syncCloudProfileSnapshot({
      firebaseUid: decoded.uid,
      username: typeof body.username === 'string' ? body.username : undefined,
      usernameChanged: body.usernameChanged === true ? true : undefined,
      gender: body.gender === 'male' || body.gender === 'female' ? body.gender : undefined,
      platform: body.platform,
      level: typeof body.level === 'number' ? body.level : undefined,
      xp: typeof body.xp === 'number' ? body.xp : undefined,
      rp: typeof body.rp === 'number' ? body.rp : undefined,
      avatarCharacterId:
        typeof body.avatarCharacterId === 'string' ? body.avatarCharacterId : undefined,
      totalMatches: typeof body.totalMatches === 'number' ? body.totalMatches : undefined,
      wins: typeof body.wins === 'number' ? body.wins : undefined,
      eliminations: typeof body.eliminations === 'number' ? body.eliminations : undefined,
      deaths: typeof body.deaths === 'number' ? body.deaths : undefined,
      totalDamage: typeof body.totalDamage === 'number' ? body.totalDamage : undefined,
      bestKillsInMatch: typeof body.bestKillsInMatch === 'number' ? body.bestKillsInMatch : undefined,
      rankedMatches: typeof body.rankedMatches === 'number' ? body.rankedMatches : undefined,
      rankedWins: typeof body.rankedWins === 'number' ? body.rankedWins : undefined,
      rankedKills: typeof body.rankedKills === 'number' ? body.rankedKills : undefined,
      rankedTop3: typeof body.rankedTop3 === 'number' ? body.rankedTop3 : undefined,
      vault: body.vault && typeof body.vault === 'object' ? body.vault : undefined,
    });
    if (!profile) {
      res.status(404).json({ error: 'Bound player session not found.', code: 'NOT_FOUND' });
      return;
    }
    matchServer.syncSessionFromStore(profile.playerId);
    res.json({ profile });
  });

  app.post('/api/ranked/profile', (req, res) => {
    const body = req.body ?? {};
    const result = store.upsertProfile({
      playerId: typeof body.playerId === 'string' ? body.playerId : undefined,
      secretToken: typeof body.secretToken === 'string' ? body.secretToken : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
      platform: body.platform,
    });
    res.json(result);
  });

  app.get('/api/ranked/profile/:playerId', (req, res) => {
    const rawId = typeof req.params.playerId === 'string' ? req.params.playerId.trim() : '';
    if (!rawId || rawId.length > 64) {
      res.status(400).json({ error: 'Invalid player identifier' });
      return;
    }
    const stripPrivateVault = req.query.public === '1';
    const profile = store.getProfile(rawId, stripPrivateVault);
    if (!profile) {
      res.status(404).json({ error: 'Profile not found' });
      return;
    }
    res.json({ profile });
  });

  app.get('/api/ranked/leaderboard', (req, res) => {
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(100, rawLimit)) : 50;
    res.json({ leaderboard: store.getLeaderboard(limit) });
  });

  app.post('/api/profile/rename-once', (req, res) => {
    const body = req.body ?? {};
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const secretToken = typeof body.secretToken === 'string' ? body.secretToken : '';
    const newName = typeof body.newName === 'string' ? body.newName : '';
    const outcome = store.renameOnce({ playerId, secretToken, newName });
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
      return;
    }
    matchServer.syncSessionFromStore(playerId);
    res.json({ profile: outcome.profile });
  });

  app.post('/api/profile/update-gender', (req, res) => {
    const body = req.body ?? {};
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const secretToken = typeof body.secretToken === 'string' ? body.secretToken : '';
    const outcome = store.updateGender({
      playerId,
      secretToken,
      gender: body.gender,
    });
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
      return;
    }
    matchServer.syncSessionFromStore(playerId);
    res.json({ profile: outcome.profile });
  });

  app.post('/api/profile/sync-progression', (req, res) => {
    const body = req.body ?? {};
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const secretToken = typeof body.secretToken === 'string' ? body.secretToken : '';
    const profile = store.syncAccountProgression({
      playerId,
      secretToken,
      level: typeof body.level === 'number' ? body.level : undefined,
      xp: typeof body.xp === 'number' ? body.xp : undefined,
      avatarCharacterId:
        typeof body.avatarCharacterId === 'string' ? body.avatarCharacterId : undefined,
      gender: body.gender,
      brMatch:
        body.brMatch && typeof body.brMatch === 'object'
          ? {
              kills: Number(body.brMatch.kills) || 0,
              damage: Number(body.brMatch.damage) || 0,
              died: Boolean(body.brMatch.died),
              isWinner: Boolean(body.brMatch.isWinner),
            }
          : undefined,
    });
    if (!profile) {
      res.status(401).json({ error: 'Invalid player credentials' });
      return;
    }
    matchServer.syncSessionFromStore(playerId);
    res.json({ profile });
  });

  app.post('/api/profile/sync-vault', (req, res) => {
    const body = req.body ?? {};
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const secretToken = typeof body.secretToken === 'string' ? body.secretToken : '';
    const vault = body.vault && typeof body.vault === 'object' ? body.vault : {};
    const profile = store.syncVaultState({
      playerId,
      secretToken,
      vault,
    });
    if (!profile) {
      res.status(401).json({ error: 'Invalid player credentials' });
      return;
    }
    matchServer.syncSessionFromStore(playerId);
    res.json({ profile });
  });

  app.post('/api/friends/lookup', (req, res) => {
    const body = req.body ?? {};
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const secretToken = typeof body.secretToken === 'string' ? body.secretToken : '';
    const queryId = typeof body.queryId === 'string' ? body.queryId : '';
    const outcome = store.lookupPlayerForFriendAdd({ playerId, secretToken, queryId });
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
      return;
    }
    res.json({
      player: outcome.player,
      relationStatus: outcome.relationStatus,
      pendingRequestId: outcome.pendingRequestId,
    });
  });

  app.post('/api/friends/state', (req, res) => {
    const body = req.body ?? {};
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const secretToken = typeof body.secretToken === 'string' ? body.secretToken : '';
    const verified = store.verifyCredentials(playerId, secretToken);
    if (!verified) {
      res.status(401).json({ error: 'Invalid player credentials.', code: 'UNAUTHORIZED' });
      return;
    }
    res.json(matchServer.getFriendsSnapshotForPlayer(verified.playerId));
  });

  app.post('/api/friends/request', (req, res) => {
    const body = req.body ?? {};
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const secretToken = typeof body.secretToken === 'string' ? body.secretToken : '';
    const targetId = typeof body.targetId === 'string' ? body.targetId : '';
    const outcome = store.sendFriendRequest({
      playerId,
      secretToken,
      targetIdOrNumericId: targetId,
    });
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
      return;
    }
    matchServer.pushFriendsSyncToPlayer(outcome.fromPlayerId);
    matchServer.notifyFriendRequestReceived(outcome.toPlayerId, outcome.request);
    res.json({
      ok: true,
      request: outcome.request,
      ...matchServer.getFriendsSnapshotForPlayer(outcome.fromPlayerId),
    });
  });

  app.post('/api/friends/respond', (req, res) => {
    const body = req.body ?? {};
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const secretToken = typeof body.secretToken === 'string' ? body.secretToken : '';
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const accept = Boolean(body.accept);
    const outcome = store.respondToFriendRequest({
      playerId,
      secretToken,
      requestId,
      accept,
    });
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
      return;
    }
    matchServer.pushFriendsSyncToPlayer(outcome.toPlayerId);
    matchServer.notifyFriendRequestResponded(outcome.fromPlayerId, {
      requestId,
      accepted: outcome.accepted,
      byPlayerId: outcome.toPlayerId,
      byName: outcome.responderName,
    });
    res.json({
      ok: true,
      accepted: outcome.accepted,
      ...matchServer.getFriendsSnapshotForPlayer(outcome.toPlayerId),
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!options?.skipVite && !isProd) {
    app.get('/@vite/client', (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.type('application/javascript').send(`
import "/@vite/env";
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== "undefined") {
  document.querySelectorAll("style[data-vite-dev-id]").forEach((el) => {
    sheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute("data-vite-dev-id"), el);
  });
}
let lastInsertedStyle;
function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement("style");
    style.setAttribute("type", "text/css");
    style.setAttribute("data-vite-dev-id", id);
    style.textContent = content;
    if (!lastInsertedStyle) {
      document.head.appendChild(style);
      setTimeout(() => { lastInsertedStyle = void 0; }, 0);
    } else {
      lastInsertedStyle.insertAdjacentElement("afterend", style);
    }
    lastInsertedStyle = style;
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]').forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    document.head.removeChild(style);
    sheetsMap.delete(id);
  }
}
function injectQuery(url, queryToInject) {
  if (url[0] !== "." && url[0] !== "/") return url;
  const pathname = url.replace(/[?#].*$/, "");
  const { search, hash } = new URL(url, "http://vite.dev");
  return pathname + "?" + queryToInject + (search ? "&" + search.slice(1) : "") + (hash || "");
}
function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    prune() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
  };
}
const ErrorOverlay = typeof HTMLElement !== "undefined" ? class extends HTMLElement {} : class {};
export { ErrorOverlay, createHotContext, injectQuery, removeStyle, updateStyle };
`.trim());
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else if (!options?.skipVite) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get(/^(?!\/api\/|\/ws\/).*/, (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const httpServer = http.createServer(app);
  httpServer.on('upgrade', (request, socket, head) => {
    const reqUrl = request.url ?? '/';
    const pathname = reqUrl.split('?')[0];
    if (pathname === '/ws/ranked') {
      matchServer.handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });

  const port = options?.port ?? Number(process.env.PORT || 3000);
  await new Promise<void>((resolve) => {
    httpServer.listen(port, '0.0.0.0', () => {
      resolve();
    });
  });

  return {
    app,
    httpServer,
    store,
    matchServer,
    close: async () => {
      matchServer.dispose();
      await store.flushToDisk();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

// Start server when executed directly via `tsx server.ts` or `node server.ts`
const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  path.resolve(process.argv[1]).endsWith('server.ts');

if (isDirectRun) {
  createAppServer()
    .then(() => {
      const port = Number(process.env.PORT || 3000);
      console.log(`NEXUS ROYALE server listening on http://0.0.0.0:${port}`);
    })
    .catch((err) => {
      console.error('Failed to start NEXUS ROYALE server:', err);
      process.exit(1);
    });
}
