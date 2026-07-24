// CLAUDE.md "Icons for garment types" — a small shared icon set mapped by
// garment-name keyword, used to auto-assign GarmentCatalogue.iconKey at seed
// time. Values are @expo/vector-icons MaterialCommunityIcons names, so the
// mobile app renders them directly with no second translation table.
//
// MaterialCommunityIcons has good coverage for bags/footwear/bedding/home
// items but genuinely no dedicated icons for most ethnic wear (saree, kurta,
// lehenga, dhoti, sherwani) or lower-body garments (pants, jeans, dhoti) —
// those fall back to a generic icon and are marked 'weak' rather than
// silently picking something that looks precise but isn't. Admin can
// override any of these per item via the catalogue CRUD (iconKey field).
export type IconConfidence = 'strong' | 'weak';

export interface IconMatch {
  iconKey: string;
  confidence: IconConfidence;
}

const FALLBACK_ICON = 'hanger';

// Ordered, first match wins. Keep specific/compound rules above generic ones
// (e.g. "steam iron" must be checked before a bare "iron"-adjacent rule).
const RULES: [RegExp, string, IconConfidence][] = [
  [/wash\s*&?\s*steam iron|steam iron/i, 'iron', 'strong'],
  [/wash\s*&?\s*fold/i, 'washing-machine', 'strong'],
  [/premium laundry/i, 'washing-machine', 'strong'],
  [/trolley bag/i, 'bag-suitcase', 'strong'],
  [/laptop bag/i, 'laptop', 'strong'],
  [/hand\s*bag/i, 'bag-personal', 'strong'],
  [/backpack/i, 'bag-backpack', 'strong'],
  [/helmet/i, FALLBACK_ICON, 'weak'],
  [/leather shoes|\bshoes\b/i, 'shoe-formal', 'strong'],
  [/sandals|slippers|crocs/i, 'shoe-sneaker', 'weak'],
  [/bed sheet/i, 'bed', 'strong'],
  [/pillow/i, 'pillow', 'strong'],
  [/blanket|quilt/i, 'blanket', 'strong'],
  [/curtain/i, 'curtains', 'strong'],
  [/sofa cover/i, 'sofa', 'strong'],
  [/carpet|door mat/i, 'rug', 'weak'],
  [/towel/i, FALLBACK_ICON, 'weak'],
  [/t-?shirt/i, 'tshirt-crew', 'strong'],
  [/shirt/i, 'tshirt-crew', 'strong'],
  [/kurti|kurta/i, 'tshirt-crew', 'weak'],
  [/blouse|\btop\b|hoodie|sweater/i, 'tshirt-crew', 'weak'],
  [/jeans|\bpants\b|trouser|shorts|leggings|palazzo|dhoti/i, FALLBACK_ICON, 'weak'],
  [/saree|lehenga|gown|dress|frock|anarkali|salwar|dupatta/i, FALLBACK_ICON, 'weak'],
  [/blazer|suit|sherwani|waistcoat|jacket|coat/i, 'tie', 'weak'],
];

export const resolveIconKey = (itemName: string): IconMatch => {
  for (const [pattern, iconKey, confidence] of RULES) {
    if (pattern.test(itemName)) return { iconKey, confidence };
  }
  return { iconKey: FALLBACK_ICON, confidence: 'weak' };
};
