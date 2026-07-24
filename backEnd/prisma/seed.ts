import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { resolveIconKey } from './iconMapping';

const prisma = new PrismaClient();

interface SeedGarment {
  category: string;
  itemName: string;
  serviceType: string;
  pricingUnit: string;
  price: number;
  priceMax?: number;
  isStartingPrice?: boolean;
  requiresSpecialCare?: boolean;
  // Optional per-item override — if present, wins over the auto keyword
  // match below (CLAUDE.md "Icons for garment types": admin/seed-data can
  // override an item the auto-mapping guesses wrong on).
  iconKey?: string;
  _note?: string;
  _tier?: string;
}

interface SeedData {
  garments: SeedGarment[];
}

// v2 superseded the earlier ~40-item catalogue entirely (see CLAUDE.md
// "Major pricing model update") and doesn't carry branch data — branches
// are created/managed separately via the branch admin API, not seeded here.
const seedDataPath = path.join(__dirname, 'seed-data', 'garments-seed-data-v2.json');
const seedData: SeedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));

// The same itemName can legitimately appear more than once (e.g. "Shirt
// (Cotton)" at ₹199 under Women's Wear and ₹129 under Men's Wear) — these
// are distinct catalogue entries, not duplicates. itemName alone is NOT a
// unique key; (itemName, category) is.
const identityKey = (g: { itemName: string; category: string }) => `${g.itemName}::${g.category}`;

async function main() {
  const newKeys = new Set(seedData.garments.map(identityKey));

  // Deactivate (not delete — past orders reference these rows) global
  // catalogue items the v2 rate card no longer includes.
  const existingGlobal = await prisma.garmentCatalogue.findMany({
    where: { branchId: null, isActive: true },
  });
  const staleItems = existingGlobal.filter((g) => !newKeys.has(identityKey({ itemName: g.itemName, category: g.category ?? '' })));

  if (staleItems.length > 0) {
    await prisma.garmentCatalogue.updateMany({
      where: { id: { in: staleItems.map((g) => g.id) } },
      data: { isActive: false },
    });
  }

  let created = 0;
  let updated = 0;
  const weakIconMatches: { itemName: string; category: string; iconKey: string }[] = [];

  for (const garment of seedData.garments) {
    const existing = await prisma.garmentCatalogue.findFirst({
      where: { itemName: garment.itemName, category: garment.category, branchId: null },
    });

    const iconMatch = resolveIconKey(garment.itemName);
    const iconKey = garment.iconKey ?? iconMatch.iconKey;
    if (!garment.iconKey && iconMatch.confidence === 'weak') {
      weakIconMatches.push({ itemName: garment.itemName, category: garment.category, iconKey });
    }

    // branchId left null — matches garment_catalogue's null-means-global
    // convention (CLAUDE.md / seed-data _comment), so these apply to every
    // branch, not just one.
    const data = {
      itemName: garment.itemName,
      category: garment.category,
      serviceType: garment.serviceType,
      pricingUnit: garment.pricingUnit,
      price: garment.price,
      priceMax: garment.priceMax ?? null,
      isStartingPrice: garment.isStartingPrice ?? false,
      requiresSpecialCare: garment.requiresSpecialCare ?? false,
      iconKey,
      isActive: true,
      branchId: null,
    };

    if (existing) {
      await prisma.garmentCatalogue.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.garmentCatalogue.create({ data });
      created += 1;
    }
  }

  const totalGarments = await prisma.garmentCatalogue.count();
  const activeGarments = await prisma.garmentCatalogue.count({ where: { isActive: true } });

  console.log(
    `Garments: ${created} created, ${updated} updated, ${staleItems.length} deactivated (not deleted), ` +
      `${activeGarments} active / ${totalGarments} total in catalogue.`
  );

  const flagged = seedData.garments.filter((g) => g._note);
  if (flagged.length > 0) {
    console.warn(`\n⚠ ${flagged.length} seeded items have unresolved _note flags — see CLAUDE.md "Major pricing model update":`);
    for (const item of flagged) {
      console.warn(`  - ${item.itemName} [${item.category}]: ${item._note}`);
    }
    console.warn('');
  }

  if (weakIconMatches.length > 0) {
    console.warn(
      `\n⚠ ${weakIconMatches.length} items got a weak/uncertain auto-mapped icon — see CLAUDE.md "Icons for garment types":`
    );
    for (const item of weakIconMatches) {
      console.warn(`  - ${item.itemName} [${item.category}] -> ${item.iconKey}`);
    }
    console.warn('');
  }

  const perKgSample = await prisma.garmentCatalogue.findMany({
    where: { pricingUnit: 'per_kg' },
    orderBy: { itemName: 'asc' },
  });
  console.log('\nPer-KG items:');
  for (const item of perKgSample) {
    console.log(`  - ${item.itemName} [${item.category}] ₹${item.price}/kg`);
  }

  const startingPriceSample = await prisma.garmentCatalogue.findMany({
    where: { isStartingPrice: true },
    orderBy: { itemName: 'asc' },
    take: 2,
  });
  console.log('\nStarting-price ("onwards") items (sample of 2):');
  for (const item of startingPriceSample) {
    console.log(`  - ${item.itemName} [${item.category}] ₹${item.price} onwards`);
  }

  // CLAUDE.md 'New "Wash" service' — confirm the 1.5x-Ironing generation
  // actually landed by comparing 3 Iron Services items against their paired
  // Wash Services item (same itemName, "Iron Services — X" vs "Wash Services
  // — X" category).
  const ironItems = await prisma.garmentCatalogue.findMany({
    where: { category: { startsWith: 'Iron Services —' } },
    orderBy: { itemName: 'asc' },
    take: 3,
  });
  console.log('\nIron price vs generated Wash price (sample of 3):');
  for (const iron of ironItems) {
    const washCategory = iron.category!.replace('Iron Services —', 'Wash Services —');
    const wash = await prisma.garmentCatalogue.findFirst({
      where: { itemName: iron.itemName, category: washCategory },
    });
    console.log(
      `  - ${iron.itemName}: Iron ₹${iron.price} -> Wash ₹${wash ? wash.price : '(not found)'}`
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
