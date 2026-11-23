import type { User } from 'firebase/auth';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentData,
} from 'firebase/firestore';
import type { PlayerAccountSnapshot } from '../progression/PlayerProfileManager';
import type { StoredRankedCredentials } from '../ranked/RankedApiClient';
import {
  getRankTier,
  type PlatformType,
  type PlayerGender,
  type RankedProfile,
  type RankedVaultState,
  type RankTier,
} from '../ranked/RankedTypes';
import {
  DEFAULT_AVATAR_ID,
  DEFAULT_BANNER_ID,
  isValidAvatarId,
  isValidBannerId,
} from '../shop/AvatarBannerCatalog';
import { getApiUrl } from '../config/RuntimeConfig';
import { firestoreDb, handleFirestoreError, OperationType } from './firebaseApp';

export interface CloudPlayerPrivateDoc {
  uid: string;
  playerId: string;
  numericId: string;
  email: string;
  photoURL?: string;
  vault?: RankedVaultState;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CloudPublicProfileDoc {
  uid: string;
  playerId: string;
  numericId: string;
  username: string;
  usernameChanged: boolean;
  avatarId: string;
  bannerId: string;
  avatarCharacterId: string;
  gender: 'male' | 'female' | 'unset';
  platform: PlatformType;
  level: number;
  xp: number;
  rp: number;
  tier: RankTier;
  totalMatches: number;
  wins: number;
  eliminations: number;
  deaths: number;
  totalDamage: number;
  bestKillsInMatch: number;
  rankedMatches: number;
  rankedWins: number;
  rankedKills: number;
  rankedTop3: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

const DEFAULT_VAULT_OWNED_IDS = [
  'glider-nexus-standard',
  'emote-amber-flare',
  'emote-dance-floss',
  'shop-gloo-arctic-classic',
  'cloth-top-hoodie-urban',
  'cloth-pants-cargo-charcoal',
  'cloth-shoes-sneakers-white',
  'shop-avatar-recruit',
  'shop-banner-standard',
];

function sanitizeUsername(raw: unknown, fallbackSuffix: string): string {
  const base = typeof raw === 'string' ? raw : '';
  const cleaned = base.replace(/[\r\n\t<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length >= 2) {
    return cleaned.slice(0, 18);
  }
  return `FIGHTER-${fallbackSuffix}`.slice(0, 18);
}

function clampInt(val: unknown, min: number, max: number, fallback = min): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(val)));
}

function sanitizePlatform(raw: unknown): PlatformType {
  if (raw === 'android' || raw === 'ios' || raw === 'tablet' || raw === 'pc') {
    return raw;
  }
  return 'pc';
}

function toCloudGender(raw: unknown): 'male' | 'female' | 'unset' {
  if (raw === 'male' || raw === 'female') return raw;
  return 'unset';
}

function fromCloudGender(raw: unknown): PlayerGender | null {
  if (raw === 'male' || raw === 'female') return raw;
  return null;
}

export function sanitizeVaultForFirestore(raw?: Partial<RankedVaultState> | null): RankedVaultState {
  const ownedSet = new Set<string>(DEFAULT_VAULT_OWNED_IDS);
  if (raw && Array.isArray(raw.ownedIds)) {
    for (const id of raw.ownedIds) {
      if (typeof id === 'string') {
        const cleaned = id.trim().slice(0, 64);
        if (cleaned) ownedSet.add(cleaned);
      }
      if (ownedSet.size >= 500) break;
    }
  }

  const equippedWeaponSkins: Record<string, string> = {};
  if (raw?.equippedWeaponSkins && typeof raw.equippedWeaponSkins === 'object') {
    let count = 0;
    for (const [k, v] of Object.entries(raw.equippedWeaponSkins)) {
      if (typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()) {
        equippedWeaponSkins[k.trim().slice(0, 32)] = v.trim().slice(0, 64);
        count++;
        if (count >= 64) break;
      }
    }
  }

  const equippedArmoryIds: Record<string, string> = {};
  if (raw?.equippedArmoryIds && typeof raw.equippedArmoryIds === 'object') {
    let count = 0;
    for (const [k, v] of Object.entries(raw.equippedArmoryIds)) {
      if (typeof k === 'string' && k.trim() && typeof v === 'string' && v.trim()) {
        equippedArmoryIds[k.trim().slice(0, 32)] = v.trim().slice(0, 64);
        count++;
        if (count >= 32) break;
      }
    }
  }

  const wheel: (string | null)[] = new Array(8).fill(null);
  if (Array.isArray(raw?.equippedEmoteWheel)) {
    for (let i = 0; i < 8; i++) {
      const slot = raw.equippedEmoteWheel[i];
      wheel[i] = typeof slot === 'string' && slot.trim() ? slot.trim().slice(0, 64) : null;
    }
  } else {
    wheel[0] = 'dance-floss';
  }

  return {
    credits: clampInt(raw?.credits, 0, 100000000, 2000),
    ownedIds: Array.from(ownedSet),
    equippedOutfitId:
      typeof raw?.equippedOutfitId === 'string' && raw.equippedOutfitId.trim()
        ? raw.equippedOutfitId.trim().slice(0, 64)
        : null,
    equippedGliderId:
      typeof raw?.equippedGliderId === 'string' && raw.equippedGliderId.trim()
        ? raw.equippedGliderId.trim().slice(0, 64)
        : 'glider-nexus-standard',
    equippedEmoteId:
      typeof raw?.equippedEmoteId === 'string' && raw.equippedEmoteId.trim()
        ? raw.equippedEmoteId.trim().slice(0, 64)
        : 'emote-amber-flare',
    equippedGlooSkinId:
      typeof raw?.equippedGlooSkinId === 'string' && raw.equippedGlooSkinId.trim()
        ? raw.equippedGlooSkinId.trim().slice(0, 64)
        : 'shop-gloo-arctic-classic',
    equippedAvatarId:
      raw && isValidAvatarId(raw.equippedAvatarId) ? raw.equippedAvatarId : DEFAULT_AVATAR_ID,
    equippedBannerId:
      raw && isValidBannerId(raw.equippedBannerId) ? raw.equippedBannerId : DEFAULT_BANNER_ID,
    equippedWeaponSkins,
    equippedEmoteWheel: wheel,
    equippedArmoryIds,
  };
}

export function cloudPublicToRankedProfile(
  pub: CloudPublicProfileDoc,
  privateVault?: RankedVaultState,
): RankedProfile {
  const level = clampInt(pub.level, 1, 300, 1);
  return {
    playerId: pub.playerId,
    numericId: pub.numericId,
    name: pub.username,
    usernameChanged: Boolean(pub.usernameChanged),
    platform: sanitizePlatform(pub.platform),
    gender: fromCloudGender(pub.gender),
    rp: clampInt(pub.rp, 0, 100000, 200),
    tier: pub.tier || getRankTier(pub.rp ?? 200),
    wins: clampInt(pub.rankedWins, 0, 1000000, 0),
    kills: clampInt(pub.rankedKills, 0, 10000000, 0),
    deaths: clampInt(pub.deaths, 0, 1000000, 0),
    top3: clampInt(pub.rankedTop3, 0, 1000000, 0),
    matchesPlayed: clampInt(pub.rankedMatches, 0, 1000000, 0),
    totalDamage: clampInt(pub.totalDamage, 0, 1000000000, 0),
    bestKillsInMatch: clampInt(pub.bestKillsInMatch, 0, 200, 0),
    level,
    xp: clampInt(pub.xp, 0, 1000000, 0),
    nextLevelXp: 100 + (level - 1) * 35,
    avatarCharacterId: pub.avatarCharacterId || 'char-01',
    equippedAvatarId: pub.avatarId || DEFAULT_AVATAR_ID,
    equippedBannerId: pub.bannerId || DEFAULT_BANNER_ID,
    vault: privateVault,
    careerMatches: clampInt(pub.totalMatches, 0, 1000000, 0),
    careerWins: clampInt(pub.wins, 0, 1000000, 0),
    careerKills: clampInt(pub.eliminations, 0, 10000000, 0),
    careerDeaths: clampInt(pub.deaths, 0, 1000000, 0),
    careerDamage: clampInt(pub.totalDamage, 0, 1000000000, 0),
    careerBestKills: clampInt(pub.bestKillsInMatch, 0, 200, 0),
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export class FirebasePlayerService {
  async readPrivateDoc(uid: string): Promise<CloudPlayerPrivateDoc | null> {
    const path = `players/${uid}`;
    try {
      const snap = await getDoc(doc(firestoreDb, 'players', uid));
      return snap.exists() ? (snap.data() as CloudPlayerPrivateDoc) : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  async readPublicDoc(uid: string): Promise<CloudPublicProfileDoc | null> {
    const path = `publicProfiles/${uid}`;
    try {
      const snap = await getDoc(doc(firestoreDb, 'publicProfiles', uid));
      return snap.exists() ? (snap.data() as CloudPublicProfileDoc) : null;
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  async resolveUidByIdOrNumeric(
    idOrNumericId: string,
  ): Promise<{ uid: string; playerId: string; numericId: string } | null> {
    const cleaned = idOrNumericId.trim();
    if (!cleaned || cleaned.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(cleaned)) {
      return null;
    }
    const indexPath = `playerIdIndex/${cleaned}`;
    try {
      const snap = await getDoc(doc(firestoreDb, 'playerIdIndex', cleaned));
      if (!snap.exists()) return null;
      const data = snap.data() as { uid?: string; playerId?: string; numericId?: string };
      if (!data.uid || !data.playerId || !data.numericId) return null;
      return {
        uid: data.uid,
        playerId: data.playerId,
        numericId: data.numericId,
      };
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, indexPath);
    }
  }

  async lookupPublicProfileById(idOrNumericId: string): Promise<{
    uid: string;
    docData: CloudPublicProfileDoc;
    rankedProfile: RankedProfile;
  } | null> {
    const resolved = await this.resolveUidByIdOrNumeric(idOrNumericId);
    if (!resolved) return null;
    const pub = await this.readPublicDoc(resolved.uid);
    if (!pub) return null;
    return {
      uid: resolved.uid,
      docData: pub,
      rankedProfile: cloudPublicToRankedProfile(pub),
    };
  }

  private async ensurePlayerIdIndexEntries(
    uid: string,
    playerId: string,
    numericId: string,
  ): Promise<void> {
    const keys = Array.from(new Set([numericId, playerId]));
    for (const idKey of keys) {
      const indexPath = `playerIdIndex/${idKey}`;
      try {
        const ref = doc(firestoreDb, 'playerIdIndex', idKey);
        const existing = await getDoc(ref);
        if (!existing.exists()) {
          await setDoc(ref, {
            idKey,
            uid,
            playerId,
            numericId,
            createdAt: serverTimestamp(),
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, indexPath);
      }
    }
  }

  async initializeAuthenticatedAccount(input: {
    user: User;
    platform: PlatformType;
    guestCredentials: StoredRankedCredentials | null;
    fallbackVault: RankedVaultState;
    fallbackAccountSnapshot: PlayerAccountSnapshot;
  }): Promise<{
    uid: string;
    profile: RankedProfile;
    secretToken: string;
    vault: RankedVaultState;
    publicDoc: CloudPublicProfileDoc;
  }> {
    const { user, platform, guestCredentials, fallbackVault, fallbackAccountSnapshot } = input;
    const uid = user.uid;
    const idToken = await user.getIdToken();

    const [existingPrivate, existingPublic] = await Promise.all([
      this.readPrivateDoc(uid),
      this.readPublicDoc(uid),
    ]);

    const existingCloudIds =
      existingPublic?.playerId && existingPublic?.numericId
        ? { playerId: existingPublic.playerId, numericId: existingPublic.numericId }
        : existingPrivate?.playerId && existingPrivate?.numericId
          ? { playerId: existingPrivate.playerId, numericId: existingPrivate.numericId }
          : undefined;

    // 1. Resolve permanent collision-free Player ID + Numeric ID on trusted backend
    const res = await fetch(getApiUrl('/api/firebase/session'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        platform,
        displayName: user.displayName || fallbackAccountSnapshot.username,
        existingCloudIds,
        guestLink: !existingCloudIds && guestCredentials ? guestCredentials : undefined,
      }),
    });

    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errBody.error || `Failed to initialize authenticated session (${res.status})`);
    }

    const sessionData = (await res.json()) as {
      uid: string;
      email: string;
      profile: RankedProfile;
      secretToken: string;
      created: boolean;
    };

    const permanentPlayerId = sessionData.profile.playerId;
    const permanentNumericId = sessionData.profile.numericId || permanentPlayerId;
    const email = (user.email || sessionData.email || `${uid}@users.noreply.local`).slice(0, 254);

    // 2. Ensure immutable Player ID index records exist in Firestore
    await this.ensurePlayerIdIndexEntries(uid, permanentPlayerId, permanentNumericId);

    // 3. Reconcile private doc (/players/{uid}) and vault
    const effectiveVault = existingPrivate?.vault
      ? sanitizeVaultForFirestore(existingPrivate.vault)
      : sanitizeVaultForFirestore(sessionData.profile.vault ?? fallbackVault);

    const privatePayload: DocumentData = {
      uid,
      playerId: permanentPlayerId,
      numericId: permanentNumericId,
      email,
      ...(user.photoURL ? { photoURL: user.photoURL.slice(0, 512) } : {}),
      vault: effectiveVault,
      updatedAt: serverTimestamp(),
    };

    const privatePath = `players/${uid}`;
    try {
      const privateRef = doc(firestoreDb, 'players', uid);
      if (!existingPrivate) {
        await setDoc(privateRef, {
          ...privatePayload,
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(privateRef, {
          email,
          ...(user.photoURL ? { photoURL: user.photoURL.slice(0, 512) } : {}),
          vault: effectiveVault,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }

    // 4. Reconcile public profile doc (/publicProfiles/{uid}) — ZERO PII
    const suffix = permanentPlayerId.slice(-4).toUpperCase();
    const serverProf = sessionData.profile;
    const cloudLevel = existingPublic ? clampInt(existingPublic.level, 1, 300, 1) : 1;
    const serverLevel = clampInt(serverProf.level, 1, 300, 1);
    const mergedLevel = Math.max(cloudLevel, serverLevel);
    const mergedXp =
      cloudLevel > serverLevel
        ? clampInt(existingPublic?.xp, 0, 1000000, 0)
        : serverLevel > cloudLevel
          ? clampInt(serverProf.xp, 0, 1000000, 0)
          : Math.max(
              clampInt(existingPublic?.xp, 0, 1000000, 0),
              clampInt(serverProf.xp, 0, 1000000, 0),
            );
    const mergedRp = Math.max(
      clampInt(existingPublic?.rp, 0, 100000, 200),
      clampInt(serverProf.rp, 0, 100000, 200),
    );
    const mergedUsernameChanged = Boolean(
      existingPublic?.usernameChanged || serverProf.usernameChanged,
    );
    const preferredUsername = existingPublic?.usernameChanged
      ? existingPublic.username
      : serverProf.usernameChanged
        ? serverProf.name
        : existingPublic?.username ||
          sanitizeUsername(user.displayName || serverProf.name, suffix);

    const publicPayload: Omit<CloudPublicProfileDoc, 'createdAt' | 'updatedAt'> = {
      uid,
      playerId: permanentPlayerId,
      numericId: permanentNumericId,
      username: sanitizeUsername(preferredUsername, suffix),
      usernameChanged: mergedUsernameChanged,
      avatarId: effectiveVault.equippedAvatarId || DEFAULT_AVATAR_ID,
      bannerId: effectiveVault.equippedBannerId || DEFAULT_BANNER_ID,
      avatarCharacterId: (
        existingPublic?.avatarCharacterId ||
        serverProf.avatarCharacterId ||
        fallbackAccountSnapshot.avatarCharacterId ||
        'char-01'
      ).slice(0, 32),
      gender:
        existingPublic?.gender === 'male' || existingPublic?.gender === 'female'
          ? existingPublic.gender
          : toCloudGender(serverProf.gender),
      platform: sanitizePlatform(platform),
      level: mergedLevel,
      xp: mergedXp,
      rp: mergedRp,
      tier: getRankTier(mergedRp),
      totalMatches: Math.max(
        clampInt(existingPublic?.totalMatches, 0, 1000000, 0),
        clampInt(serverProf.careerMatches ?? serverProf.matchesPlayed, 0, 1000000, 0),
      ),
      wins: Math.max(
        clampInt(existingPublic?.wins, 0, 1000000, 0),
        clampInt(serverProf.careerWins ?? serverProf.wins, 0, 1000000, 0),
      ),
      eliminations: Math.max(
        clampInt(existingPublic?.eliminations, 0, 10000000, 0),
        clampInt(serverProf.careerKills ?? serverProf.kills, 0, 10000000, 0),
      ),
      deaths: Math.max(
        clampInt(existingPublic?.deaths, 0, 1000000, 0),
        clampInt(serverProf.careerDeaths ?? serverProf.deaths, 0, 1000000, 0),
      ),
      totalDamage: Math.max(
        clampInt(existingPublic?.totalDamage, 0, 1000000000, 0),
        clampInt(serverProf.careerDamage ?? serverProf.totalDamage, 0, 1000000000, 0),
      ),
      bestKillsInMatch: Math.max(
        clampInt(existingPublic?.bestKillsInMatch, 0, 200, 0),
        clampInt(serverProf.careerBestKills ?? serverProf.bestKillsInMatch, 0, 200, 0),
      ),
      rankedMatches: Math.max(
        clampInt(existingPublic?.rankedMatches, 0, 1000000, 0),
        clampInt(serverProf.matchesPlayed, 0, 1000000, 0),
      ),
      rankedWins: Math.max(
        clampInt(existingPublic?.rankedWins, 0, 1000000, 0),
        clampInt(serverProf.wins, 0, 1000000, 0),
      ),
      rankedKills: Math.max(
        clampInt(existingPublic?.rankedKills, 0, 10000000, 0),
        clampInt(serverProf.kills, 0, 10000000, 0),
      ),
      rankedTop3: Math.max(
        clampInt(existingPublic?.rankedTop3, 0, 1000000, 0),
        clampInt(serverProf.top3, 0, 1000000, 0),
      ),
    };

    const publicPath = `publicProfiles/${uid}`;
    try {
      const publicRef = doc(firestoreDb, 'publicProfiles', uid);
      if (!existingPublic) {
        await setDoc(publicRef, {
          ...publicPayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(publicRef, {
          username: publicPayload.username,
          usernameChanged: publicPayload.usernameChanged,
          avatarId: publicPayload.avatarId,
          bannerId: publicPayload.bannerId,
          avatarCharacterId: publicPayload.avatarCharacterId,
          gender: publicPayload.gender,
          platform: publicPayload.platform,
          level: publicPayload.level,
          xp: publicPayload.xp,
          rp: publicPayload.rp,
          tier: publicPayload.tier,
          totalMatches: publicPayload.totalMatches,
          wins: publicPayload.wins,
          eliminations: publicPayload.eliminations,
          deaths: publicPayload.deaths,
          totalDamage: publicPayload.totalDamage,
          bestKillsInMatch: publicPayload.bestKillsInMatch,
          rankedMatches: publicPayload.rankedMatches,
          rankedWins: publicPayload.rankedWins,
          rankedKills: publicPayload.rankedKills,
          rankedTop3: publicPayload.rankedTop3,
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, publicPath);
    }

    // 5. Mirror reconciled cloud profile back to Express RankedStore so WebSocket / Ranked matches stay consistent
    let finalProfile = cloudPublicToRankedProfile(publicPayload as CloudPublicProfileDoc, effectiveVault);
    try {
      const syncRes = await fetch(getApiUrl('/api/firebase/sync-cloud'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          username: publicPayload.username,
          usernameChanged: publicPayload.usernameChanged,
          gender: fromCloudGender(publicPayload.gender),
          platform: publicPayload.platform,
          level: publicPayload.level,
          xp: publicPayload.xp,
          rp: publicPayload.rp,
          avatarCharacterId: publicPayload.avatarCharacterId,
          totalMatches: publicPayload.totalMatches,
          wins: publicPayload.wins,
          eliminations: publicPayload.eliminations,
          deaths: publicPayload.deaths,
          totalDamage: publicPayload.totalDamage,
          bestKillsInMatch: publicPayload.bestKillsInMatch,
          rankedMatches: publicPayload.rankedMatches,
          rankedWins: publicPayload.rankedWins,
          rankedKills: publicPayload.rankedKills,
          rankedTop3: publicPayload.rankedTop3,
          vault: effectiveVault,
        }),
      });
      if (syncRes.ok) {
        const synced = (await syncRes.json()) as { profile?: RankedProfile };
        if (synced.profile) {
          finalProfile = {
            ...synced.profile,
            vault: effectiveVault,
          };
        }
      }
    } catch {
      // Non-fatal if Express mirror fails transiently; Firestore holds source of truth
    }

    return {
      uid,
      profile: finalProfile,
      secretToken: sessionData.secretToken,
      vault: effectiveVault,
      publicDoc: publicPayload as CloudPublicProfileDoc,
    };
  }

  async syncPublicProfileSnapshot(
    uid: string,
    snapshot: PlayerAccountSnapshot,
    cosmetics: { avatarId: string; bannerId: string },
  ): Promise<void> {
    const publicPath = `publicProfiles/${uid}`;
    try {
      const publicRef = doc(firestoreDb, 'publicProfiles', uid);
      const existing = await getDoc(publicRef);
      if (!existing.exists()) return;
      const prev = existing.data() as CloudPublicProfileDoc;
      const safeUsername = prev.usernameChanged
        ? prev.username
        : sanitizeUsername(snapshot.username, prev.playerId.slice(-4).toUpperCase());
      await updateDoc(publicRef, {
        username: safeUsername,
        usernameChanged: Boolean(prev.usernameChanged || snapshot.usernameChanged),
        avatarId: isValidAvatarId(cosmetics.avatarId) ? cosmetics.avatarId : DEFAULT_AVATAR_ID,
        bannerId: isValidBannerId(cosmetics.bannerId) ? cosmetics.bannerId : DEFAULT_BANNER_ID,
        avatarCharacterId: (snapshot.avatarCharacterId || 'char-01').slice(0, 32),
        gender: toCloudGender(snapshot.gender),
        platform: sanitizePlatform(snapshot.platform),
        level: clampInt(snapshot.level, 1, 300, 1),
        xp: clampInt(snapshot.xp, 0, 1000000, 0),
        rp: clampInt(snapshot.rp, 0, 100000, 200),
        tier: snapshot.tier || getRankTier(snapshot.rp),
        totalMatches: clampInt(snapshot.totalMatches, 0, 1000000, 0),
        wins: clampInt(snapshot.wins, 0, 1000000, 0),
        eliminations: clampInt(snapshot.eliminations, 0, 10000000, 0),
        deaths: clampInt(snapshot.deaths, 0, 1000000, 0),
        totalDamage: clampInt(snapshot.totalDamage, 0, 1000000000, 0),
        bestKillsInMatch: clampInt(snapshot.bestKillsInMatch, 0, 200, 0),
        rankedMatches: clampInt(snapshot.rankedMatches, 0, 1000000, 0),
        rankedWins: clampInt(snapshot.rankedWins, 0, 1000000, 0),
        rankedKills: clampInt(snapshot.rankedKills, 0, 10000000, 0),
        rankedTop3: clampInt(snapshot.rankedTop3, 0, 1000000, 0),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, publicPath);
    }
  }

  async syncPrivateVault(uid: string, vault: RankedVaultState): Promise<void> {
    const privatePath = `players/${uid}`;
    const cleanVault = sanitizeVaultForFirestore(vault);
    try {
      await updateDoc(doc(firestoreDb, 'players', uid), {
        vault: cleanVault,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, privatePath);
    }
  }
}
