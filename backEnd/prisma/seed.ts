import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface SeedGarment {
  category: string;
  itemName: string;
  serviceType: string;
  price: number;
  priceMax?: number;
  note?: string;
  _needsConfirmation?: string;
}

interface SeedData {
  garments: SeedGarment[];
  branch: {
    branchName: string;
    branchType: 'apartment' | 'area';
    phoneNumber: string;
    whatsappNumber?: string;
    address: string;
    city: string;
  };
}

const seedDataPath = path.join(__dirname, 'seed-data', 'garments-seed-data.json');
const seedData: SeedData = JSON.parse(fs.readFileSync(seedDataPath, 'utf-8'));

async function main() {
  const existingBranch = await prisma.branch.findFirst({
    where: { branchName: seedData.branch.branchName },
  });

  const branch =
    existingBranch ??
    (await prisma.branch.create({
      data: {
        branchName: seedData.branch.branchName,
        branchType: seedData.branch.branchType,
        phoneNumber: seedData.branch.phoneNumber,
        whatsappNumber: seedData.branch.whatsappNumber,
        address: seedData.branch.address,
        city: seedData.branch.city,
      },
    }));

  console.log(existingBranch ? `Branch "${branch.branchName}" already exists — reusing it.` : `Created branch "${branch.branchName}".`);

  const needsConfirmation = seedData.garments.filter((g) => g._needsConfirmation);

  let created = 0;
  let skipped = 0;

  for (const garment of seedData.garments) {
    const existing = await prisma.garmentCatalogue.findFirst({
      where: { itemName: garment.itemName, branchId: null },
    });

    if (existing) {
      skipped += 1;
      continue;
    }

    // branchId left null — matches garment_catalogue's null-means-global
    // convention (CLAUDE.md / seed-data _comment), so these apply to every
    // branch, not just Attapur.
    await prisma.garmentCatalogue.create({
      data: {
        itemName: garment.itemName,
        serviceType: garment.serviceType,
        price: garment.price,
        priceMax: garment.priceMax ?? null,
        branchId: null,
      },
    });
    created += 1;
  }

  const totalGarments = await prisma.garmentCatalogue.count();

  console.log(`Garments: ${created} created, ${skipped} already present, ${totalGarments} total in catalogue.`);

  if (needsConfirmation.length > 0) {
    console.warn('\n⚠ Seeded items that need client confirmation before treating as final:');
    for (const item of needsConfirmation) {
      console.warn(`  - ${item.itemName} (₹${item.price}${item.priceMax ? `–₹${item.priceMax}` : ''}): ${item._needsConfirmation}`);
    }
    console.warn('See CLAUDE.md "Services — RESOLVED" and "Still open" sections.\n');
  }

  const sample = await prisma.garmentCatalogue.findMany({ take: 5, orderBy: { createdAt: 'asc' } });
  console.log('\nSample of 5 seeded items:');
  for (const item of sample) {
    console.log(`  - ${item.itemName} [${item.serviceType}] ₹${item.price}${item.priceMax ? `–₹${item.priceMax}` : ''}`);
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
