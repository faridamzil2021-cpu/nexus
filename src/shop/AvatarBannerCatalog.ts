export type CosmeticRarity = 'Common' | 'Rare' | 'Epic' | 'Legendary';

export interface AvatarDefinition {
  id: string;
  shopItemId: string;
  name: string;
  rarity: CosmeticRarity;
  priceCredits: number;
  accentHex: string;
  bgHex: string;
  secondaryHex: string;
  motif:
    | 'recruit'
    | 'visor'
    | 'fox'
    | 'oni'
    | 'eagle'
    | 'skull'
    | 'valkyrie'
    | 'void';
  description: string;
  defaultOwned?: boolean;
}

export interface BannerDefinition {
  id: string;
  shopItemId: string;
  name: string;
  rarity: CosmeticRarity;
  priceCredits: number;
  accentHex: string;
  bgStartHex: string;
  bgEndHex: string;
  pattern:
    | 'standard'
    | 'solar'
    | 'frost'
    | 'circuit'
    | 'dragon'
    | 'crown'
    | 'horizon'
    | 'hazard';
  description: string;
  defaultOwned?: boolean;
}

export const DEFAULT_AVATAR_ID = 'avatar-nexus-recruit';
export const DEFAULT_BANNER_ID = 'banner-nexus-standard';

export const AVATAR_CATALOG: readonly AvatarDefinition[] = [
  {
    id: DEFAULT_AVATAR_ID,
    shopItemId: 'shop-avatar-recruit',
    name: 'NEXUS RECRUIT',
    rarity: 'Common',
    priceCredits: 0,
    accentHex: '#38bdf8',
    bgHex: '#0f172a',
    secondaryHex: '#1e293b',
    motif: 'recruit',
    description: 'Standard-issue Nexus Tactical Division emblem badge.',
    defaultOwned: true,
  },
  {
    id: 'avatar-apex-visor',
    shopItemId: 'shop-avatar-apex-visor',
    name: 'APEX HOLO VISOR',
    rarity: 'Rare',
    priceCredits: 320,
    accentHex: '#22d3ee',
    bgHex: '#082f49',
    secondaryHex: '#0e7490',
    motif: 'visor',
    description: 'Dual-optic cybernetic helmet crest worn by orbital drop recon units.',
  },
  {
    id: 'avatar-cyber-fox',
    shopItemId: 'shop-avatar-cyber-fox',
    name: 'KITSUNE CIRCUIT',
    rarity: 'Rare',
    priceCredits: 380,
    accentHex: '#fb923c',
    bgHex: '#1f1612',
    secondaryHex: '#c2410c',
    motif: 'fox',
    description: 'Razor-angled cyber fox mask insignia engineered for flankers.',
  },
  {
    id: 'avatar-crimson-oni',
    shopItemId: 'shop-avatar-crimson-oni',
    name: 'CRIMSON ONI',
    rarity: 'Epic',
    priceCredits: 580,
    accentHex: '#ef4444',
    bgHex: '#24090c',
    secondaryHex: '#991b1b',
    motif: 'oni',
    description: 'Fanged war-demon crest forged for relentless frontline rushers.',
  },
  {
    id: 'avatar-frost-valkyrie',
    shopItemId: 'shop-avatar-frost-valkyrie',
    name: 'FROST VALKYRIE',
    rarity: 'Epic',
    priceCredits: 620,
    accentHex: '#7dd3fc',
    bgHex: '#0c1e35',
    secondaryHex: '#0284c7',
    motif: 'valkyrie',
    description: 'Winged glacier helm emblem from the Cryo Citadel elite.',
  },
  {
    id: 'avatar-phantom-skull',
    shopItemId: 'shop-avatar-phantom-skull',
    name: 'PHANTOM REAPER',
    rarity: 'Epic',
    priceCredits: 680,
    accentHex: '#34d399',
    bgHex: '#071d18',
    secondaryHex: '#047857',
    motif: 'skull',
    description: 'Venom-green ballistic skull emblem struck across night-ops squads.',
  },
  {
    id: 'avatar-golden-eagle',
    shopItemId: 'shop-avatar-golden-eagle',
    name: 'SOLARIS SOVEREIGN',
    rarity: 'Legendary',
    priceCredits: 950,
    accentHex: '#facc15',
    bgHex: '#1c1507',
    secondaryHex: '#b45309',
    motif: 'eagle',
    description: '24-karat imperial eagle crest awarded to apex arena champions.',
  },
  {
    id: 'avatar-void-sentinel',
    shopItemId: 'shop-avatar-void-sentinel',
    name: 'VOID SENTINEL',
    rarity: 'Legendary',
    priceCredits: 1100,
    accentHex: '#c084fc',
    bgHex: '#160b29',
    secondaryHex: '#7e22ce',
    motif: 'void',
    description: 'Tri-eye singularity mask glowing with violet orbital plasma.',
  },
];

export const BANNER_CATALOG: readonly BannerDefinition[] = [
  {
    id: DEFAULT_BANNER_ID,
    shopItemId: 'shop-banner-standard',
    name: 'NEXUS CARBON',
    rarity: 'Common',
    priceCredits: 0,
    accentHex: '#38bdf8',
    bgStartHex: '#0f172a',
    bgEndHex: '#1e293b',
    pattern: 'standard',
    description: 'Standard tactical slate calling card with subtle Nexus hex grid.',
    defaultOwned: true,
  },
  {
    id: 'banner-hazard-strike',
    shopItemId: 'shop-banner-hazard-strike',
    name: 'HAZARD STRIKE',
    rarity: 'Rare',
    priceCredits: 340,
    accentHex: '#f97316',
    bgStartHex: '#1c1917',
    bgEndHex: '#7c2d12',
    pattern: 'hazard',
    description: 'High-contrast industrial chevron stripes with amber tactical telemetry.',
  },
  {
    id: 'banner-frost-citadel',
    shopItemId: 'shop-banner-frost-citadel',
    name: 'CRYO CITADEL',
    rarity: 'Rare',
    priceCredits: 380,
    accentHex: '#7dd3fc',
    bgStartHex: '#082f49',
    bgEndHex: '#0369a1',
    pattern: 'frost',
    description: 'Shattered glacier facets framing a frozen mountain horizon.',
  },
  {
    id: 'banner-neon-circuit',
    shopItemId: 'shop-banner-neon-circuit',
    name: 'NEON UPLINK',
    rarity: 'Epic',
    priceCredits: 560,
    accentHex: '#22d3ee',
    bgStartHex: '#042f2e',
    bgEndHex: '#0e7490',
    pattern: 'circuit',
    description: 'Cybernetic telemetry traces pulsing across deep emerald-cyan alloy.',
  },
  {
    id: 'banner-crimson-dragon',
    shopItemId: 'shop-banner-crimson-dragon',
    name: 'CRIMSON WYRM',
    rarity: 'Epic',
    priceCredits: 640,
    accentHex: '#ef4444',
    bgStartHex: '#1f080a',
    bgEndHex: '#991b1b',
    pattern: 'dragon',
    description: 'Blazing scarlet scales & ember slashes forged for aggressive duelists.',
  },
  {
    id: 'banner-starlight-horizon',
    shopItemId: 'shop-banner-starlight-horizon',
    name: 'VOID HORIZON',
    rarity: 'Epic',
    priceCredits: 720,
    accentHex: '#c084fc',
    bgStartHex: '#120824',
    bgEndHex: '#581c87',
    pattern: 'horizon',
    description: 'Orbital eclipse silhouette over deep violet atmospheric rings.',
  },
  {
    id: 'banner-solar-flare',
    shopItemId: 'shop-banner-solar-flare',
    name: 'SOLAR FLARE',
    rarity: 'Legendary',
    priceCredits: 920,
    accentHex: '#fbbf24',
    bgStartHex: '#1c1204',
    bgEndHex: '#b45309',
    pattern: 'solar',
    description: 'Radiant golden sunbeams bursting behind matte obsidian armor.',
  },
  {
    id: 'banner-obsidian-crown',
    shopItemId: 'shop-banner-obsidian-crown',
    name: 'APEX CROWN',
    rarity: 'Legendary',
    priceCredits: 1150,
    accentHex: '#facc15',
    bgStartHex: '#09090b',
    bgEndHex: '#854d0e',
    pattern: 'crown',
    description: 'Championship Obsidian & Gold insignia reserved for top survivors.',
  },
];

const AVATAR_BY_ID = new Map(AVATAR_CATALOG.map((a) => [a.id, a]));
const BANNER_BY_ID = new Map(BANNER_CATALOG.map((b) => [b.id, b]));

export function getAvatarById(id?: string | null): AvatarDefinition {
  if (id && AVATAR_BY_ID.has(id)) {
    return AVATAR_BY_ID.get(id)!;
  }
  return AVATAR_BY_ID.get(DEFAULT_AVATAR_ID)!;
}

export function getBannerById(id?: string | null): BannerDefinition {
  if (id && BANNER_BY_ID.has(id)) {
    return BANNER_BY_ID.get(id)!;
  }
  return BANNER_BY_ID.get(DEFAULT_BANNER_ID)!;
}

export function isValidAvatarId(id: unknown): id is string {
  return typeof id === 'string' && AVATAR_BY_ID.has(id);
}

export function isValidBannerId(id: unknown): id is string {
  return typeof id === 'string' && BANNER_BY_ID.has(id);
}
