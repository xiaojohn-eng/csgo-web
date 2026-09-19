export const SKINS = [
  { id: 'default', name: '原厂石墨', subtitle: 'FACTORY / GRAPHITE', color: '#3a4145', accent: '#939da4', rarity: '工业级', pattern: 0 },
  { id: 'redline', name: '赤线', subtitle: 'CARBON / CRIMSON', color: '#191e24', accent: '#ea424d', rarity: '保密', pattern: 1 },
  { id: 'arctic', name: '极地迷彩', subtitle: 'ARCTIC / DIGITAL', color: '#d4e5e7', accent: '#668b9d', rarity: '军规级', pattern: 2 },
  { id: 'aurora', name: '极光', subtitle: 'ANODIZED / SPECTRUM', color: '#23cbbf', accent: '#915beb', rarity: '隐秘', pattern: 3 },
  { id: 'hazard', name: '警戒', subtitle: 'INDUSTRIAL / HAZARD', color: '#e9b639', accent: '#252a2f', rarity: '受限', pattern: 4 },
  { id: 'porcelain', name: '青瓷', subtitle: 'CERAMIC / COBALT', color: '#e9e7df', accent: '#23568b', rarity: '保密', pattern: 5 },
] as const;
export type SkinId = (typeof SKINS)[number]['id'];
export function validSkinId(value: unknown): SkinId {
  return SKINS.find(skin => skin.id === value)?.id ?? 'default';
}
