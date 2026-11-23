import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_AVATAR_ID,
  DEFAULT_BANNER_ID,
  isValidAvatarId,
  isValidBannerId,
} from '../src/shop/AvatarBannerCatalog.ts';
import {
  calculateMatchRpDelta,
  getRankTier,
  type FriendLookupPlayerSummary,
  type FriendLookupResponse,
  type FriendRelationStatus,
  type FriendRequestEntry,
  type LeaderboardEntry,
  type PlatformType,
  type PlayerGender,
  type RankedMapId,
  type RankedMatchHistoryEntry,
  type RankedProfile,
  type RankedVaultState,
  type RankTier,
} from '../src/ranked/RankedTypes.ts';
import { isValidWeaponSkinId } from '../src/weapons/WeaponSkins.ts';

interface StoredPlayerRecord extends RankedProfile {
  secretToken: string;
  numericId: string;
  gender: PlayerGender | null;
  firebaseUid?: string;
}

export interface StoredFriendshipRecord {
  playerA: string;
  playerB: string;
  createdAt: number;
}

export interface StoredFriendRequestRecord {
  requestId: string;
  fromPlayerId: string;
  toPlayerId: string;
  createdAt: number;
}

interface StoreFileShape {
  version: number;
  players: Record<string, StoredPlayerRecord>;
  friendships?: StoredFriendshipRecord[];
  friendRequests?: StoredFriendRequestRecord[];
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

function createDefaultVaultState(): RankedVaultState {
  return {
    credits: 2000,
    ownedIds: [...DEFAULT_VAULT_OWNED_IDS],
    equippedOutfitId: null,
    equippedGliderId: 'glider-nexus-standard',
    equippedEmoteId: 'emote-amber-flare',
    equippedGlooSkinId: 'shop-gloo-arctic-classic',
    equippedAvatarId: DEFAULT_AVATAR_ID,
    equippedBannerId: DEFAULT_BANNER_ID,
    equippedWeaponSkins: {},
    equippedEmoteWheel: ['dance-floss', null, null, null, null, null, null, null],
    equippedArmoryIds: {},
  };
}

function sanitizeVaultState(
  raw: Partial<RankedVaultState> | undefined,
  existing?: RankedVaultState,
): RankedVaultState {
  const base = existing ?? createDefaultVaultState();
  const ownedSet = new Set<string>([...DEFAULT_VAULT_OWNED_IDS, ...base.ownedIds]);
  if (raw && Array.isArray(raw.ownedIds)) {
    for (const id of raw.ownedIds) {
      if (typeof id === 'string') {
        const cleaned = id.trim().slice(0, 64);
        if (cleaned) ownedSet.add(cleaned);
      }
    }
  }

  const equippedWeaponSkins: Record<string, string> = {};
  const sourceSkins =
    raw && raw.equippedWeaponSkins && typeof raw.equippedWeaponSkins === 'object'
      ? raw.equippedWeaponSkins
      : base.equippedWeaponSkins;
  for (const [wId, skinId] of Object.entries(sourceSkins)) {
    if (
      typeof wId === 'string' &&
      wId.trim() &&
      typeof skinId === 'string' &&
      isValidWeaponSkinId(skinId)
    ) {
      equippedWeaponSkins[wId.trim().slice(0, 32)] = skinId;
    }
  }

  const equippedArmoryIds: Record<string, string> = {};
  const sourceArmory =
    raw && raw.equippedArmoryIds && typeof raw.equippedArmoryIds === 'object'
      ? raw.equippedArmoryIds
      : base.equippedArmoryIds;
  for (const [cat, itemId] of Object.entries(sourceArmory)) {
    if (
      typeof cat === 'string' &&
      typeof itemId === 'string' &&
      ownedSet.has(itemId)
    ) {
      equippedArmoryIds[cat.slice(0, 32)] = itemId;
    }
  }

  const wheel: (string | null)[] = new Array(8).fill(null);
  const sourceWheel =
    raw && Array.isArray(raw.equippedEmoteWheel)
      ? raw.equippedEmoteWheel
      : base.equippedEmoteWheel;
  for (let i = 0; i < 8; i++) {
    const val = sourceWheel[i];
    wheel[i] = typeof val === 'string' && val.trim() ? val.trim().slice(0, 48) : null;
  }

  return {
    credits:
      raw && typeof raw.credits === 'number' && Number.isFinite(raw.credits) && raw.credits >= 0
        ? Math.floor(raw.credits)
        : base.credits,
    ownedIds: Array.from(ownedSet),
    equippedOutfitId:
      raw && raw.equippedOutfitId === null
        ? null
        : raw && typeof raw.equippedOutfitId === 'string' && ownedSet.has(raw.equippedOutfitId)
          ? raw.equippedOutfitId
          : base.equippedOutfitId,
    equippedGliderId:
      raw && typeof raw.equippedGliderId === 'string' && ownedSet.has(raw.equippedGliderId)
        ? raw.equippedGliderId
        : base.equippedGliderId,
    equippedEmoteId:
      raw && typeof raw.equippedEmoteId === 'string' && ownedSet.has(raw.equippedEmoteId)
        ? raw.equippedEmoteId
        : base.equippedEmoteId,
    equippedGlooSkinId:
      raw && typeof raw.equippedGlooSkinId === 'string' && ownedSet.has(raw.equippedGlooSkinId)
        ? raw.equippedGlooSkinId
        : base.equippedGlooSkinId,
    equippedAvatarId:
      raw && isValidAvatarId(raw.equippedAvatarId)
        ? raw.equippedAvatarId
        : isValidAvatarId(base.equippedAvatarId)
          ? base.equippedAvatarId
          : DEFAULT_AVATAR_ID,
    equippedBannerId:
      raw && isValidBannerId(raw.equippedBannerId)
        ? raw.equippedBannerId
        : isValidBannerId(base.equippedBannerId)
          ? base.equippedBannerId
          : DEFAULT_BANNER_ID,
    equippedWeaponSkins,
    equippedEmoteWheel: wheel,
    equippedArmoryIds,
  };
}

const MAX_HISTORY_ENTRIES = 25;

function sanitizePlayerName(rawName: unknown, fallbackSuffix: string): string {
  if (typeof rawName !== 'string') {
    return `FIGHTER-${fallbackSuffix}`;
  }
  const cleaned = rawName.replace(/[\r\n\t<>]/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < 2) {
    return `FIGHTER-${fallbackSuffix}`;
  }
  return cleaned.slice(0, 18);
}

function sanitizePlatform(raw: unknown): PlatformType {
  if (raw === 'android' || raw === 'ios' || raw === 'tablet' || raw === 'pc') {
    return raw;
  }
  return 'pc';
}

function sanitizeGender(raw: unknown): PlayerGender | null {
  if (raw === 'male' || raw === 'female') {
    return raw;
  }
  return null;
}

function isValidNumericId(raw: unknown): raw is string {
  return typeof raw === 'string' && /^\d{8,12}$/.test(raw.trim());
}

function computeNextLevelXp(level: number): number {
  const safeLevel = Math.max(1, Math.min(300, Math.floor(level)));
  return 100 + (safeLevel - 1) * 35;
}

function tokensMatch(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function canonicalFriendshipKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

export class RankedStore {
  private readonly filePath: string;
  private readonly players = new Map<string, StoredPlayerRecord>();
  private readonly numericIdToPlayerId = new Map<string, string>();
  private readonly firebaseUidToPlayerId = new Map<string, string>();
  private readonly friendships = new Map<string, StoredFriendshipRecord>();
  private readonly friendsByPlayerId = new Map<string, Set<string>>();
  private readonly friendRequests = new Map<string, StoredFriendRequestRecord>();
  private readonly requestPairToId = new Map<string, string>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private writeInProgress = false;
  private pendingWrite = false;

  constructor(storePath?: string) {
    this.filePath =
      storePath ?? path.resolve(process.cwd(), 'data', 'ranked-store.json');
    this.loadFromDisk();
  }

  private generateUniqueNumericId(): string {
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = String(crypto.randomInt(100_000_000, 1_000_000_000));
      if (!this.numericIdToPlayerId.has(candidate)) {
        return candidate;
      }
    }
    let fallback = Date.now() % 900_000_000 + 100_000_000;
    while (this.numericIdToPlayerId.has(String(fallback))) {
      fallback = (fallback + 1) % 900_000_000 + 100_000_000;
    }
    return String(fallback);
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreFileShape>;
      const missingNumericIds: StoredPlayerRecord[] = [];
      if (parsed && parsed.players && typeof parsed.players === 'object') {
        for (const [id, rec] of Object.entries(parsed.players)) {
          if (rec && typeof rec.playerId === 'string' && typeof rec.secretToken === 'string') {
            const rawNumeric = isValidNumericId(rec.numericId) ? rec.numericId.trim() : '';
            const assignedNumeric =
              rawNumeric && !this.numericIdToPlayerId.has(rawNumeric) ? rawNumeric : '';
            const stored: StoredPlayerRecord = {
              ...rec,
              numericId: assignedNumeric,
              gender: sanitizeGender(rec.gender),
              usernameChanged: Boolean(rec.usernameChanged),
              level: typeof rec.level === 'number' && rec.level >= 1 ? Math.floor(rec.level) : 1,
              xp: typeof rec.xp === 'number' && rec.xp >= 0 ? Math.floor(rec.xp) : 0,
              avatarCharacterId:
                typeof rec.avatarCharacterId === 'string' && rec.avatarCharacterId
                  ? rec.avatarCharacterId
                  : 'char-01',
              careerMatches:
                typeof rec.careerMatches === 'number'
                  ? rec.careerMatches
                  : (rec.matchesPlayed ?? 0),
              careerWins:
                typeof rec.careerWins === 'number' ? rec.careerWins : (rec.wins ?? 0),
              careerKills:
                typeof rec.careerKills === 'number' ? rec.careerKills : (rec.kills ?? 0),
              careerDeaths:
                typeof rec.careerDeaths === 'number' ? rec.careerDeaths : (rec.deaths ?? 0),
              careerDamage:
                typeof rec.careerDamage === 'number' ? rec.careerDamage : (rec.totalDamage ?? 0),
              careerBestKills:
                typeof rec.careerBestKills === 'number'
                  ? rec.careerBestKills
                  : (rec.bestKillsInMatch ?? 0),
              tier: getRankTier(rec.rp ?? 0),
              vault: sanitizeVaultState(rec.vault),
              history: Array.isArray(rec.history) ? rec.history.slice(0, MAX_HISTORY_ENTRIES) : [],
            };
            this.players.set(id, stored);
            if (typeof stored.firebaseUid === 'string' && stored.firebaseUid.trim()) {
              const cleanedUid = stored.firebaseUid.trim();
              stored.firebaseUid = cleanedUid;
              this.firebaseUidToPlayerId.set(cleanedUid, id);
            }
            if (assignedNumeric) {
              this.numericIdToPlayerId.set(assignedNumeric, id);
            } else {
              missingNumericIds.push(stored);
            }
          }
        }
      }
      if (Array.isArray(parsed?.friendships)) {
        for (const f of parsed.friendships) {
          if (
            f &&
            typeof f.playerA === 'string' &&
            typeof f.playerB === 'string' &&
            f.playerA !== f.playerB &&
            this.players.has(f.playerA) &&
            this.players.has(f.playerB)
          ) {
            this.addMutualFriendshipInternal(
              f.playerA,
              f.playerB,
              typeof f.createdAt === 'number' && Number.isFinite(f.createdAt)
                ? f.createdAt
                : Date.now(),
            );
          }
        }
      }
      if (Array.isArray(parsed?.friendRequests)) {
        for (const r of parsed.friendRequests) {
          if (
            r &&
            typeof r.requestId === 'string' &&
            r.requestId.trim() &&
            typeof r.fromPlayerId === 'string' &&
            typeof r.toPlayerId === 'string' &&
            r.fromPlayerId !== r.toPlayerId &&
            this.players.has(r.fromPlayerId) &&
            this.players.has(r.toPlayerId) &&
            !this.areFriends(r.fromPlayerId, r.toPlayerId)
          ) {
            const pairKey = `${r.fromPlayerId}->${r.toPlayerId}`;
            if (!this.requestPairToId.has(pairKey)) {
              const cleaned: StoredFriendRequestRecord = {
                requestId: r.requestId.trim(),
                fromPlayerId: r.fromPlayerId,
                toPlayerId: r.toPlayerId,
                createdAt:
                  typeof r.createdAt === 'number' && Number.isFinite(r.createdAt)
                    ? r.createdAt
                    : Date.now(),
              };
              this.friendRequests.set(cleaned.requestId, cleaned);
              this.requestPairToId.set(pairKey, cleaned.requestId);
            }
          }
        }
      }
      if (missingNumericIds.length > 0) {
        for (const stored of missingNumericIds) {
          const nextNum = this.generateUniqueNumericId();
          stored.numericId = nextNum;
          this.numericIdToPlayerId.set(nextNum, stored.playerId);
        }
        this.scheduleSave();
      }
    } catch (err) {
      console.warn('[RankedStore] Could not read existing store, starting fresh:', err);
    }
  }

  private addMutualFriendshipInternal(idA: string, idB: string, createdAt: number): boolean {
    if (!idA || !idB || idA === idB) return false;
    const key = canonicalFriendshipKey(idA, idB);
    if (this.friendships.has(key)) return false;
    const [playerA, playerB] = idA < idB ? [idA, idB] : [idB, idA];
    this.friendships.set(key, { playerA, playerB, createdAt });
    let setA = this.friendsByPlayerId.get(playerA);
    if (!setA) {
      setA = new Set<string>();
      this.friendsByPlayerId.set(playerA, setA);
    }
    setA.add(playerB);
    let setB = this.friendsByPlayerId.get(playerB);
    if (!setB) {
      setB = new Set<string>();
      this.friendsByPlayerId.set(playerB, setB);
    }
    setB.add(playerA);
    return true;
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushToDisk();
    }, 120);
  }

  async flushToDisk(): Promise<void> {
    if (this.writeInProgress) {
      this.pendingWrite = true;
      return;
    }
    this.writeInProgress = true;
    try {
      const dir = path.dirname(this.filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      const obj: StoreFileShape = {
        version: 1,
        players: Object.fromEntries(this.players.entries()),
        friendships: Array.from(this.friendships.values()),
        friendRequests: Array.from(this.friendRequests.values()),
      };
      const tmpPath = `${this.filePath}.tmp`;
      await fs.promises.writeFile(tmpPath, JSON.stringify(obj, null, 2), 'utf8');
      await fs.promises.rename(tmpPath, this.filePath);
    } catch (err) {
      console.error('[RankedStore] Failed to persist store:', err);
    } finally {
      this.writeInProgress = false;
      if (this.pendingWrite) {
        this.pendingWrite = false;
        void this.flushToDisk();
      }
    }
  }

  private toPublicProfile(rec: StoredPlayerRecord, stripPrivateVault = false): RankedProfile {
    const { secretToken: _omitted, firebaseUid: _omittedUid, ...pub } = rec;
    const level = typeof pub.level === 'number' && pub.level >= 1 ? Math.floor(pub.level) : 1;
    const equippedAvatarId =
      pub.vault && isValidAvatarId(pub.vault.equippedAvatarId)
        ? pub.vault.equippedAvatarId
        : DEFAULT_AVATAR_ID;
    const equippedBannerId =
      pub.vault && isValidBannerId(pub.vault.equippedBannerId)
        ? pub.vault.equippedBannerId
        : DEFAULT_BANNER_ID;
    const out: RankedProfile = {
      ...pub,
      numericId: pub.numericId,
      gender: sanitizeGender(pub.gender),
      level,
      xp: typeof pub.xp === 'number' && pub.xp >= 0 ? Math.floor(pub.xp) : 0,
      nextLevelXp: computeNextLevelXp(level),
      equippedAvatarId,
      equippedBannerId,
      history: [...pub.history],
    };
    if (stripPrivateVault) {
      delete out.vault;
    }
    return out;
  }

  upsertProfile(input: {
    playerId?: string;
    secretToken?: string;
    name?: string;
    platform?: PlatformType;
  }): { profile: RankedProfile; secretToken: string; created: boolean } {
    const now = Date.now();
    const existing =
      input.playerId && typeof input.playerId === 'string'
        ? this.players.get(input.playerId)
        : undefined;

    if (existing && input.secretToken && existing.secretToken === input.secretToken) {
      if (!isValidNumericId(existing.numericId)) {
        existing.numericId = this.generateUniqueNumericId();
        this.numericIdToPlayerId.set(existing.numericId, existing.playerId);
      }
      if (input.platform) {
        existing.platform = sanitizePlatform(input.platform);
      }
      existing.updatedAt = now;
      this.scheduleSave();
      return {
        profile: this.toPublicProfile(existing),
        secretToken: existing.secretToken,
        created: false,
      };
    }

    const playerId = `p_${crypto.randomBytes(8).toString('hex')}`;
    const secretToken = crypto.randomBytes(24).toString('hex');
    const numericId = this.generateUniqueNumericId();
    const suffix = playerId.slice(-4).toUpperCase();
    const record: StoredPlayerRecord = {
      playerId,
      numericId,
      secretToken,
      name: sanitizePlayerName(input.name, suffix),
      usernameChanged: false,
      platform: sanitizePlatform(input.platform),
      gender: null,
      rp: 200, // Start in Bronze with 200 RP
      tier: getRankTier(200),
      wins: 0,
      kills: 0,
      deaths: 0,
      top3: 0,
      matchesPlayed: 0,
      totalDamage: 0,
      bestKillsInMatch: 0,
      level: 1,
      xp: 0,
      avatarCharacterId: 'char-01',
      vault: createDefaultVaultState(),
      careerMatches: 0,
      careerWins: 0,
      careerKills: 0,
      careerDeaths: 0,
      careerDamage: 0,
      careerBestKills: 0,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    this.players.set(playerId, record);
    this.numericIdToPlayerId.set(numericId, playerId);
    this.scheduleSave();
    return {
      profile: this.toPublicProfile(record),
      secretToken,
      created: true,
    };
  }

  private generateUniquePlayerId(): string {
    for (let attempt = 0; attempt < 64; attempt++) {
      const candidate = `p_${crypto.randomBytes(8).toString('hex')}`;
      if (!this.players.has(candidate)) {
        return candidate;
      }
    }
    let fallback = `p_${Date.now().toString(16)}${crypto.randomBytes(4).toString('hex')}`;
    while (this.players.has(fallback)) {
      fallback = `p_${crypto.randomBytes(8).toString('hex')}`;
    }
    return fallback;
  }

  resolveFirebaseSession(input: {
    firebaseUid: string;
    displayName?: string;
    platform?: PlatformType;
    existingCloudIds?: {
      playerId?: string;
      numericId?: string;
    };
    guestLink?: {
      playerId?: string;
      secretToken?: string;
    };
  }): { profile: RankedProfile; secretToken: string; created: boolean } {
    const now = Date.now();
    const uid = input.firebaseUid.trim();
    const boundPlayerId = this.firebaseUidToPlayerId.get(uid);
    const existingBound = boundPlayerId ? this.players.get(boundPlayerId) : undefined;

    if (existingBound) {
      if (!isValidNumericId(existingBound.numericId)) {
        existingBound.numericId = this.generateUniqueNumericId();
        this.numericIdToPlayerId.set(existingBound.numericId, existingBound.playerId);
      }
      if (input.platform) {
        existingBound.platform = sanitizePlatform(input.platform);
      }
      existingBound.updatedAt = now;
      this.scheduleSave();
      return {
        profile: this.toPublicProfile(existingBound),
        secretToken: existingBound.secretToken,
        created: false,
      };
    }

    // If Firestore already holds permanent IDs for this UID (e.g. after server store reset), restore them without altering IDs
    const cloudPid =
      typeof input.existingCloudIds?.playerId === 'string' &&
      /^[a-zA-Z0-9_-]{3,64}$/.test(input.existingCloudIds.playerId.trim())
        ? input.existingCloudIds.playerId.trim()
        : '';
    const cloudNumeric = isValidNumericId(input.existingCloudIds?.numericId)
      ? input.existingCloudIds!.numericId!.trim()
      : '';

    if (cloudPid && cloudNumeric) {
      const pidRecord = this.players.get(cloudPid);
      const numericOwner = this.numericIdToPlayerId.get(cloudNumeric);
      if (pidRecord && (!pidRecord.firebaseUid || pidRecord.firebaseUid === uid)) {
        pidRecord.firebaseUid = uid;
        this.firebaseUidToPlayerId.set(uid, pidRecord.playerId);
        if (input.platform) {
          pidRecord.platform = sanitizePlatform(input.platform);
        }
        pidRecord.updatedAt = now;
        this.scheduleSave();
        return {
          profile: this.toPublicProfile(pidRecord),
          secretToken: pidRecord.secretToken,
          created: false,
        };
      }
      if (!pidRecord && !numericOwner) {
        const secretToken = crypto.randomBytes(24).toString('hex');
        const suffix = cloudPid.slice(-4).toUpperCase();
        const restored: StoredPlayerRecord = {
          playerId: cloudPid,
          numericId: cloudNumeric,
          firebaseUid: uid,
          secretToken,
          name: sanitizePlayerName(input.displayName, suffix),
          usernameChanged: false,
          platform: sanitizePlatform(input.platform),
          gender: null,
          rp: 200,
          tier: getRankTier(200),
          wins: 0,
          kills: 0,
          deaths: 0,
          top3: 0,
          matchesPlayed: 0,
          totalDamage: 0,
          bestKillsInMatch: 0,
          level: 1,
          xp: 0,
          avatarCharacterId: 'char-01',
          vault: createDefaultVaultState(),
          careerMatches: 0,
          careerWins: 0,
          careerKills: 0,
          careerDeaths: 0,
          careerDamage: 0,
          careerBestKills: 0,
          history: [],
          createdAt: now,
          updatedAt: now,
        };
        this.players.set(cloudPid, restored);
        this.numericIdToPlayerId.set(cloudNumeric, cloudPid);
        this.firebaseUidToPlayerId.set(uid, cloudPid);
        this.scheduleSave();
        return {
          profile: this.toPublicProfile(restored),
          secretToken,
          created: false,
        };
      }
    }

    // Optional one-time link of an unlinked guest session on initial registration
    if (input.guestLink?.playerId && input.guestLink?.secretToken) {
      const guestRec = this.players.get(input.guestLink.playerId);
      if (
        guestRec &&
        !guestRec.firebaseUid &&
        tokensMatch(guestRec.secretToken, input.guestLink.secretToken)
      ) {
        guestRec.firebaseUid = uid;
        if (!isValidNumericId(guestRec.numericId)) {
          guestRec.numericId = this.generateUniqueNumericId();
          this.numericIdToPlayerId.set(guestRec.numericId, guestRec.playerId);
        }
        if (input.platform) {
          guestRec.platform = sanitizePlatform(input.platform);
        }
        guestRec.updatedAt = now;
        this.firebaseUidToPlayerId.set(uid, guestRec.playerId);
        this.scheduleSave();
        return {
          profile: this.toPublicProfile(guestRec),
          secretToken: guestRec.secretToken,
          created: false,
        };
      }
    }

    // Issue brand new permanent collision-free Player ID and 9-digit Numeric ID
    const playerId = this.generateUniquePlayerId();
    const secretToken = crypto.randomBytes(24).toString('hex');
    const numericId = this.generateUniqueNumericId();
    const suffix = playerId.slice(-4).toUpperCase();
    const record: StoredPlayerRecord = {
      playerId,
      numericId,
      firebaseUid: uid,
      secretToken,
      name: sanitizePlayerName(input.displayName, suffix),
      usernameChanged: false,
      platform: sanitizePlatform(input.platform),
      gender: null,
      rp: 200,
      tier: getRankTier(200),
      wins: 0,
      kills: 0,
      deaths: 0,
      top3: 0,
      matchesPlayed: 0,
      totalDamage: 0,
      bestKillsInMatch: 0,
      level: 1,
      xp: 0,
      avatarCharacterId: 'char-01',
      vault: createDefaultVaultState(),
      careerMatches: 0,
      careerWins: 0,
      careerKills: 0,
      careerDeaths: 0,
      careerDamage: 0,
      careerBestKills: 0,
      history: [],
      createdAt: now,
      updatedAt: now,
    };
    this.players.set(playerId, record);
    this.numericIdToPlayerId.set(numericId, playerId);
    this.firebaseUidToPlayerId.set(uid, playerId);
    this.scheduleSave();
    return {
      profile: this.toPublicProfile(record),
      secretToken,
      created: true,
    };
  }

  syncCloudProfileSnapshot(input: {
    firebaseUid: string;
    username?: string;
    usernameChanged?: boolean;
    gender?: PlayerGender | null;
    platform?: PlatformType;
    level?: number;
    xp?: number;
    rp?: number;
    avatarCharacterId?: string;
    totalMatches?: number;
    wins?: number;
    eliminations?: number;
    deaths?: number;
    totalDamage?: number;
    bestKillsInMatch?: number;
    rankedMatches?: number;
    rankedWins?: number;
    rankedKills?: number;
    rankedTop3?: number;
    vault?: Partial<RankedVaultState>;
  }): RankedProfile | null {
    const pid = this.firebaseUidToPlayerId.get(input.firebaseUid.trim());
    const rec = pid ? this.players.get(pid) : undefined;
    if (!rec) return null;

    if (typeof input.username === 'string') {
      const cleaned = input.username.replace(/[\r\n\t<>]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 2 && cleaned.length <= 18) {
        if (!rec.usernameChanged) {
          rec.name = cleaned;
        }
      }
    }
    if (input.usernameChanged === true) {
      rec.usernameChanged = true;
    }
    if (input.gender === 'male' || input.gender === 'female') {
      rec.gender = input.gender;
    }
    if (input.platform) {
      rec.platform = sanitizePlatform(input.platform);
    }
    if (typeof input.level === 'number' && Number.isFinite(input.level) && input.level >= 1) {
      const lvl = Math.min(300, Math.floor(input.level));
      if (lvl > (rec.level ?? 1)) {
        rec.level = lvl;
        rec.xp = typeof input.xp === 'number' && input.xp >= 0 ? Math.floor(input.xp) : 0;
      } else if (lvl === (rec.level ?? 1) && typeof input.xp === 'number' && input.xp >= 0) {
        rec.xp = Math.max(rec.xp ?? 0, Math.floor(input.xp));
      }
    }
    if (typeof input.rp === 'number' && Number.isFinite(input.rp) && input.rp >= 0) {
      rec.rp = Math.max(rec.rp, Math.floor(input.rp));
      rec.tier = getRankTier(rec.rp);
    }
    if (typeof input.avatarCharacterId === 'string' && input.avatarCharacterId.trim()) {
      rec.avatarCharacterId = input.avatarCharacterId.trim().slice(0, 32);
    }
    if (typeof input.totalMatches === 'number' && Number.isFinite(input.totalMatches)) {
      rec.careerMatches = Math.max(rec.careerMatches ?? 0, Math.floor(input.totalMatches));
    }
    if (typeof input.wins === 'number' && Number.isFinite(input.wins)) {
      rec.careerWins = Math.max(rec.careerWins ?? 0, Math.floor(input.wins));
    }
    if (typeof input.eliminations === 'number' && Number.isFinite(input.eliminations)) {
      rec.careerKills = Math.max(rec.careerKills ?? 0, Math.floor(input.eliminations));
    }
    if (typeof input.deaths === 'number' && Number.isFinite(input.deaths)) {
      rec.careerDeaths = Math.max(rec.careerDeaths ?? 0, Math.floor(input.deaths));
    }
    if (typeof input.totalDamage === 'number' && Number.isFinite(input.totalDamage)) {
      rec.careerDamage = Math.max(rec.careerDamage ?? 0, Math.floor(input.totalDamage));
    }
    if (typeof input.bestKillsInMatch === 'number' && Number.isFinite(input.bestKillsInMatch)) {
      rec.careerBestKills = Math.max(rec.careerBestKills ?? 0, Math.floor(input.bestKillsInMatch));
    }
    if (typeof input.rankedMatches === 'number' && Number.isFinite(input.rankedMatches)) {
      rec.matchesPlayed = Math.max(rec.matchesPlayed, Math.floor(input.rankedMatches));
    }
    if (typeof input.rankedWins === 'number' && Number.isFinite(input.rankedWins)) {
      rec.wins = Math.max(rec.wins, Math.floor(input.rankedWins));
    }
    if (typeof input.rankedKills === 'number' && Number.isFinite(input.rankedKills)) {
      rec.kills = Math.max(rec.kills, Math.floor(input.rankedKills));
    }
    if (typeof input.rankedTop3 === 'number' && Number.isFinite(input.rankedTop3)) {
      rec.top3 = Math.max(rec.top3, Math.floor(input.rankedTop3));
    }
    if (input.vault && typeof input.vault === 'object') {
      rec.vault = sanitizeVaultState(input.vault, rec.vault);
    }

    rec.updatedAt = Date.now();
    this.scheduleSave();
    return this.toPublicProfile(rec);
  }

  renameOnce(input: {
    playerId: string;
    secretToken: string;
    newName: string;
  }):
    | { ok: true; profile: RankedProfile }
    | { ok: false; status: number; code: string; error: string } {
    const rec = this.players.get(input.playerId);
    if (!rec || rec.secretToken !== input.secretToken) {
      return {
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED',
        error: 'Invalid player credentials.',
      };
    }
    if (rec.usernameChanged) {
      return {
        ok: false,
        status: 409,
        code: 'USERNAME_ALREADY_CHANGED',
        error: 'Your one-time username change has already been used for this account.',
      };
    }
    const cleaned = input.newName.replace(/[\r\n\t<>]/g, ' ').replace(/\s+/g, ' ').trim();
    if (cleaned.length < 2 || cleaned.length > 18) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_USERNAME',
        error: 'Username must be between 2 and 18 characters.',
      };
    }
    if (cleaned.toLowerCase() === rec.name.trim().toLowerCase()) {
      return {
        ok: false,
        status: 400,
        code: 'SAME_USERNAME',
        error: 'New username must be different from your current username.',
      };
    }

    rec.name = cleaned;
    rec.usernameChanged = true;
    rec.updatedAt = Date.now();
    this.scheduleSave();
    return {
      ok: true,
      profile: this.toPublicProfile(rec),
    };
  }

  updateGender(input: {
    playerId: string;
    secretToken: string;
    gender: unknown;
  }):
    | { ok: true; profile: RankedProfile }
    | { ok: false; status: number; code: string; error: string } {
    const rec = this.players.get(input.playerId);
    if (!rec || rec.secretToken !== input.secretToken) {
      return {
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED',
        error: 'Invalid player credentials.',
      };
    }
    const sanitized = sanitizeGender(input.gender);
    if (!sanitized) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_GENDER',
        error: 'Gender must be either male or female.',
      };
    }
    rec.gender = sanitized;
    rec.updatedAt = Date.now();
    this.scheduleSave();
    return {
      ok: true,
      profile: this.toPublicProfile(rec),
    };
  }

  syncAccountProgression(input: {
    playerId: string;
    secretToken: string;
    level?: number;
    xp?: number;
    avatarCharacterId?: string;
    gender?: unknown;
    brMatch?: {
      kills: number;
      damage: number;
      died: boolean;
      isWinner: boolean;
    };
  }): RankedProfile | null {
    const rec = this.players.get(input.playerId);
    if (!rec || rec.secretToken !== input.secretToken) {
      return null;
    }

    if (typeof input.level === 'number' && Number.isFinite(input.level) && input.level >= 1) {
      const nextLvl = Math.min(300, Math.floor(input.level));
      const curLvl = rec.level ?? 1;
      if (nextLvl > curLvl) {
        rec.level = nextLvl;
        rec.xp = typeof input.xp === 'number' && input.xp >= 0 ? Math.floor(input.xp) : 0;
      } else if (nextLvl === curLvl && typeof input.xp === 'number' && input.xp >= 0) {
        rec.xp = Math.max(rec.xp ?? 0, Math.floor(input.xp));
      }
    }

    if (typeof input.avatarCharacterId === 'string' && input.avatarCharacterId.trim()) {
      rec.avatarCharacterId = input.avatarCharacterId.trim().slice(0, 32);
    }

    const sanitizedGender = sanitizeGender(input.gender);
    if (sanitizedGender) {
      rec.gender = sanitizedGender;
    }

    if (input.brMatch) {
      const kills = Math.max(0, Math.floor(input.brMatch.kills));
      const damage = Math.max(0, Math.round(input.brMatch.damage));
      rec.careerMatches = (rec.careerMatches ?? rec.matchesPlayed) + 1;
      if (input.brMatch.isWinner) {
        rec.careerWins = (rec.careerWins ?? rec.wins) + 1;
      }
      rec.careerKills = (rec.careerKills ?? rec.kills) + kills;
      if (input.brMatch.died) {
        rec.careerDeaths = (rec.careerDeaths ?? rec.deaths) + 1;
      }
      rec.careerDamage = (rec.careerDamage ?? rec.totalDamage) + damage;
      rec.careerBestKills = Math.max(rec.careerBestKills ?? rec.bestKillsInMatch, kills);
    }

    rec.updatedAt = Date.now();
    this.scheduleSave();
    return this.toPublicProfile(rec);
  }

  syncVaultState(input: {
    playerId: string;
    secretToken: string;
    vault: Partial<RankedVaultState>;
  }): RankedProfile | null {
    const rec = this.players.get(input.playerId);
    if (!rec || rec.secretToken !== input.secretToken) {
      return null;
    }
    rec.vault = sanitizeVaultState(input.vault, rec.vault);
    rec.updatedAt = Date.now();
    this.scheduleSave();
    return this.toPublicProfile(rec);
  }

  verifyCredentials(playerId: string, secretToken: string): RankedProfile | null {
    const rec = this.players.get(playerId);
    if (!rec || !tokensMatch(rec.secretToken, secretToken)) return null;
    return this.toPublicProfile(rec);
  }

  private resolvePlayerRecord(idOrNumericId: string): StoredPlayerRecord | null {
    const trimmed = idOrNumericId.trim();
    if (!trimmed || trimmed.length > 64) return null;
    let rec = this.players.get(trimmed);
    if (!rec) {
      const resolvedId = this.numericIdToPlayerId.get(trimmed);
      if (resolvedId) {
        rec = this.players.get(resolvedId);
      }
    }
    return rec ?? null;
  }

  private toFriendPlayerSummary(rec: StoredPlayerRecord): FriendLookupPlayerSummary {
    const avatarId =
      rec.vault && isValidAvatarId(rec.vault.equippedAvatarId)
        ? rec.vault.equippedAvatarId
        : DEFAULT_AVATAR_ID;
    const bannerId =
      rec.vault && isValidBannerId(rec.vault.equippedBannerId)
        ? rec.vault.equippedBannerId
        : DEFAULT_BANNER_ID;
    return {
      playerId: rec.playerId,
      numericId: rec.numericId,
      name: rec.name,
      tier: rec.tier,
      rp: rec.rp,
      level: typeof rec.level === 'number' && rec.level >= 1 ? Math.floor(rec.level) : 1,
      gender: sanitizeGender(rec.gender),
      avatarId,
      bannerId,
    };
  }

  private toFriendRequestEntry(
    rec: StoredFriendRequestRecord,
    sender: StoredPlayerRecord,
  ): FriendRequestEntry {
    const avatarId =
      sender.vault && isValidAvatarId(sender.vault.equippedAvatarId)
        ? sender.vault.equippedAvatarId
        : DEFAULT_AVATAR_ID;
    return {
      requestId: rec.requestId,
      fromPlayerId: sender.playerId,
      fromNumericId: sender.numericId,
      fromName: sender.name,
      fromTier: sender.tier,
      fromRp: sender.rp,
      fromLevel: typeof sender.level === 'number' && sender.level >= 1 ? Math.floor(sender.level) : 1,
      fromGender: sanitizeGender(sender.gender),
      fromAvatarId: avatarId,
      createdAt: rec.createdAt,
    };
  }

  areFriends(playerIdA: string, playerIdB: string): boolean {
    if (!playerIdA || !playerIdB || playerIdA === playerIdB) return false;
    return this.friendships.has(canonicalFriendshipKey(playerIdA, playerIdB));
  }

  getFriendIds(playerId: string): string[] {
    const set = this.friendsByPlayerId.get(playerId);
    return set ? Array.from(set) : [];
  }

  getIncomingFriendRequests(playerId: string): FriendRequestEntry[] {
    const list: FriendRequestEntry[] = [];
    for (const req of this.friendRequests.values()) {
      if (req.toPlayerId !== playerId) continue;
      const sender = this.players.get(req.fromPlayerId);
      if (!sender) continue;
      list.push(this.toFriendRequestEntry(req, sender));
    }
    list.sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }

  getOutgoingFriendRequestTargetIds(playerId: string): string[] {
    const ids: string[] = [];
    for (const req of this.friendRequests.values()) {
      if (req.fromPlayerId === playerId) {
        ids.push(req.toPlayerId);
      }
    }
    return ids;
  }

  lookupPlayerForFriendAdd(input: {
    playerId: string;
    secretToken: string;
    queryId: string;
  }):
    | ({ ok: true } & FriendLookupResponse)
    | { ok: false; status: number; code: string; error: string } {
    const caller = this.players.get(input.playerId);
    if (!caller || !tokensMatch(caller.secretToken, input.secretToken)) {
      return {
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED',
        error: 'Invalid player credentials.',
      };
    }

    const cleanedQuery = typeof input.queryId === 'string' ? input.queryId.trim() : '';
    if (!cleanedQuery || cleanedQuery.length > 64) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_PLAYER_ID',
        error: 'Enter a valid Player ID.',
      };
    }

    const target = this.resolvePlayerRecord(cleanedQuery);
    if (!target) {
      return {
        ok: false,
        status: 404,
        code: 'PLAYER_NOT_FOUND',
        error: 'No player found with that ID.',
      };
    }

    let relationStatus: FriendRelationStatus = 'none';
    let pendingRequestId: string | undefined;

    if (target.playerId === caller.playerId) {
      relationStatus = 'self';
    } else if (this.areFriends(caller.playerId, target.playerId)) {
      relationStatus = 'friends';
    } else if (this.requestPairToId.has(`${caller.playerId}->${target.playerId}`)) {
      relationStatus = 'outgoing_pending';
    } else {
      const incomingId = this.requestPairToId.get(`${target.playerId}->${caller.playerId}`);
      if (incomingId) {
        relationStatus = 'incoming_pending';
        pendingRequestId = incomingId;
      }
    }

    return {
      ok: true,
      player: this.toFriendPlayerSummary(target),
      relationStatus,
      pendingRequestId,
    };
  }

  sendFriendRequest(input: {
    playerId: string;
    secretToken: string;
    targetIdOrNumericId: string;
  }):
    | {
        ok: true;
        request: FriendRequestEntry;
        fromPlayerId: string;
        toPlayerId: string;
      }
    | { ok: false; status: number; code: string; error: string } {
    const caller = this.players.get(input.playerId);
    if (!caller || !tokensMatch(caller.secretToken, input.secretToken)) {
      return {
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED',
        error: 'Invalid player credentials.',
      };
    }

    const cleanedTarget =
      typeof input.targetIdOrNumericId === 'string' ? input.targetIdOrNumericId.trim() : '';
    if (!cleanedTarget || cleanedTarget.length > 64) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_PLAYER_ID',
        error: 'Enter a valid Player ID.',
      };
    }

    const target = this.resolvePlayerRecord(cleanedTarget);
    if (!target) {
      return {
        ok: false,
        status: 404,
        code: 'PLAYER_NOT_FOUND',
        error: 'No player found with that ID.',
      };
    }

    if (target.playerId === caller.playerId) {
      return {
        ok: false,
        status: 400,
        code: 'CANNOT_ADD_SELF',
        error: 'You cannot send a friend request to yourself.',
      };
    }

    if (this.areFriends(caller.playerId, target.playerId)) {
      return {
        ok: false,
        status: 409,
        code: 'ALREADY_FRIENDS',
        error: 'You are already friends with this player.',
      };
    }

    const outgoingKey = `${caller.playerId}->${target.playerId}`;
    if (this.requestPairToId.has(outgoingKey)) {
      return {
        ok: false,
        status: 409,
        code: 'REQUEST_ALREADY_SENT',
        error: 'Friend request already sent.',
      };
    }

    const reverseKey = `${target.playerId}->${caller.playerId}`;
    if (this.requestPairToId.has(reverseKey)) {
      return {
        ok: false,
        status: 409,
        code: 'INCOMING_REQUEST_EXISTS',
        error: 'This player already sent you a friend request.',
      };
    }

    const requestId = `fr_${crypto.randomBytes(6).toString('hex')}`;
    const storedReq: StoredFriendRequestRecord = {
      requestId,
      fromPlayerId: caller.playerId,
      toPlayerId: target.playerId,
      createdAt: Date.now(),
    };
    this.friendRequests.set(requestId, storedReq);
    this.requestPairToId.set(outgoingKey, requestId);
    this.scheduleSave();

    return {
      ok: true,
      request: this.toFriendRequestEntry(storedReq, caller),
      fromPlayerId: caller.playerId,
      toPlayerId: target.playerId,
    };
  }

  respondToFriendRequest(input: {
    playerId: string;
    secretToken: string;
    requestId: string;
    accept: boolean;
  }):
    | {
        ok: true;
        accepted: boolean;
        fromPlayerId: string;
        toPlayerId: string;
        responderName: string;
      }
    | { ok: false; status: number; code: string; error: string } {
    const caller = this.players.get(input.playerId);
    if (!caller || !tokensMatch(caller.secretToken, input.secretToken)) {
      return {
        ok: false,
        status: 401,
        code: 'UNAUTHORIZED',
        error: 'Invalid player credentials.',
      };
    }

    const cleanedReqId = typeof input.requestId === 'string' ? input.requestId.trim() : '';
    if (!cleanedReqId || cleanedReqId.length > 64) {
      return {
        ok: false,
        status: 400,
        code: 'INVALID_REQUEST_ID',
        error: 'Invalid friend request identifier.',
      };
    }

    const req = this.friendRequests.get(cleanedReqId);
    if (!req) {
      return {
        ok: false,
        status: 404,
        code: 'REQUEST_NOT_FOUND',
        error: 'Friend request not found or already handled.',
      };
    }

    // Strict authorization check: only the intended receiver may accept or reject
    if (req.toPlayerId !== caller.playerId) {
      return {
        ok: false,
        status: 403,
        code: 'UNAUTHORIZED_REQUEST_ACTION',
        error: 'You are not authorized to respond to this friend request.',
      };
    }

    this.friendRequests.delete(req.requestId);
    this.requestPairToId.delete(`${req.fromPlayerId}->${req.toPlayerId}`);

    if (input.accept) {
      // Clean up any reverse pending request if present
      const reverseKey = `${req.toPlayerId}->${req.fromPlayerId}`;
      const reverseId = this.requestPairToId.get(reverseKey);
      if (reverseId) {
        this.friendRequests.delete(reverseId);
        this.requestPairToId.delete(reverseKey);
      }

      if (this.players.has(req.fromPlayerId) && this.players.has(req.toPlayerId)) {
        this.addMutualFriendshipInternal(req.fromPlayerId, req.toPlayerId, Date.now());
      }
    }

    this.scheduleSave();
    return {
      ok: true,
      accepted: Boolean(input.accept),
      fromPlayerId: req.fromPlayerId,
      toPlayerId: req.toPlayerId,
      responderName: caller.name,
    };
  }

  getFirebaseUidByPlayerId(playerId: string): string | null {
    const rec = this.resolvePlayerRecord(playerId);
    return rec?.firebaseUid ?? null;
  }

  getProfile(idOrNumericId: string, stripPrivateVault = false): RankedProfile | null {
    const rec = this.resolvePlayerRecord(idOrNumericId);
    return rec ? this.toPublicProfile(rec, stripPrivateVault) : null;
  }

  getLeaderboard(limit = 50): LeaderboardEntry[] {
    const all = Array.from(this.players.values());
    all.sort((a, b) => {
      if (b.rp !== a.rp) return b.rp - a.rp;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.kills !== a.kills) return b.kills - a.kills;
      return a.createdAt - b.createdAt;
    });

    return all.slice(0, Math.max(1, limit)).map((rec, idx) => ({
      rank: idx + 1,
      playerId: rec.playerId,
      numericId: rec.numericId,
      name: rec.name,
      platform: rec.platform,
      gender: sanitizeGender(rec.gender),
      level: typeof rec.level === 'number' && rec.level >= 1 ? Math.floor(rec.level) : 1,
      avatarId:
        rec.vault && isValidAvatarId(rec.vault.equippedAvatarId)
          ? rec.vault.equippedAvatarId
          : DEFAULT_AVATAR_ID,
      bannerId:
        rec.vault && isValidBannerId(rec.vault.equippedBannerId)
          ? rec.vault.equippedBannerId
          : DEFAULT_BANNER_ID,
      rp: rec.rp,
      tier: rec.tier,
      wins: rec.wins,
      kills: rec.kills,
      deaths: rec.deaths,
      matchesPlayed: rec.matchesPlayed,
    }));
  }

  recordMatchOutcome(input: {
    playerId: string;
    matchId: string;
    mapId: RankedMapId;
    placement: number;
    totalPlayers: number;
    kills: number;
    damage: number;
    survivedSec: number;
    died: boolean;
  }): {
    rpBefore: number;
    rpAfter: number;
    rpDelta: number;
    tierBefore: RankTier;
    tierAfter: RankTier;
    profile: RankedProfile;
  } | null {
    const rec = this.players.get(input.playerId);
    if (!rec) return null;

    const rpBefore = rec.rp;
    const tierBefore = rec.tier;
    const { rpDelta, rpAfter } = calculateMatchRpDelta({
      currentRp: rpBefore,
      placement: input.placement,
      totalPlayers: input.totalPlayers,
      kills: input.kills,
      damage: input.damage,
      survivedSec: input.survivedSec,
    });
    const tierAfter = getRankTier(rpAfter);

    rec.rp = rpAfter;
    rec.tier = tierAfter;
    rec.matchesPlayed += 1;
    rec.careerMatches = (rec.careerMatches ?? 0) + 1;
    if (input.placement === 1) {
      rec.wins += 1;
      rec.careerWins = (rec.careerWins ?? 0) + 1;
    }
    if (input.placement <= 3) {
      rec.top3 += 1;
    }
    const safeKills = Math.max(0, input.kills);
    const safeDmg = Math.max(0, Math.round(input.damage));
    rec.kills += safeKills;
    rec.careerKills = (rec.careerKills ?? 0) + safeKills;
    if (input.died) {
      rec.deaths += 1;
      rec.careerDeaths = (rec.careerDeaths ?? 0) + 1;
    }
    rec.totalDamage += safeDmg;
    rec.careerDamage = (rec.careerDamage ?? 0) + safeDmg;
    if (input.kills > rec.bestKillsInMatch) {
      rec.bestKillsInMatch = input.kills;
    }
    rec.careerBestKills = Math.max(rec.careerBestKills ?? 0, safeKills);
    rec.updatedAt = Date.now();

    const histEntry: RankedMatchHistoryEntry = {
      matchId: input.matchId,
      mapId: input.mapId,
      placement: input.placement,
      totalPlayers: input.totalPlayers,
      kills: input.kills,
      damage: Math.round(input.damage),
      survivedSec: Math.round(input.survivedSec),
      rpBefore,
      rpAfter,
      rpDelta,
      tierAfter,
      timestamp: Date.now(),
    };
    rec.history.unshift(histEntry);
    if (rec.history.length > MAX_HISTORY_ENTRIES) {
      rec.history.length = MAX_HISTORY_ENTRIES;
    }

    this.scheduleSave();
    return {
      rpBefore,
      rpAfter,
      rpDelta,
      tierBefore,
      tierAfter,
      profile: this.toPublicProfile(rec),
    };
  }
}
