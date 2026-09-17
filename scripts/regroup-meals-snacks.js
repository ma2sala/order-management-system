// One-off data fix: makes "Meals" a parent category with two children —
// "Food" (holding all the existing burger/pasta/salad-type items that used
// to sit directly under Meals) and "Snacks" (the existing Snacks category,
// reparented in place — its items and their ids are untouched).
//
// This is NOT a schema migration — parentId/children already exist on
// Category (see prisma/schema.prisma). It's just data: moving a few rows.
// Safe to run more than once (idempotent) — re-running does nothing new
// once Food exists and Snacks is already reparented.
//
// Run from the project root:
//   node scripts/regroup-meals-snacks.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const meals = await prisma.category.findUnique({ where: { name: 'Meals' } });
  if (!meals) {
    throw new Error('No "Meals" category found — check the exact name in your database before running this.');
  }

  const snacks = await prisma.category.findUnique({ where: { name: 'Snacks' } });
  if (!snacks) {
    throw new Error('No "Snacks" category found — check the exact name in your database before running this.');
  }

  await prisma.$transaction(async (tx) => {
    // 1. Create "Food" as a child of Meals if it doesn't already exist.
    const food = await tx.category.upsert({
      where: { name: 'Food' },
      update: { parentId: meals.id },
      create: { name: 'Food', parentId: meals.id },
    });
    console.log(`Food category ready: ${food.id} (parent: Meals)`);

    // 2. Move every menu item that was directly under Meals onto Food.
    //    (Anything already under Food, e.g. from a prior run, is untouched.)
    const moved = await tx.menuItem.updateMany({
      where: { categoryId: meals.id },
      data: { categoryId: food.id },
    });
    console.log(`Moved ${moved.count} menu item(s) from Meals to Food.`);

    // 3. Reparent Snacks under Meals. Its own items and their ids never
    //    change — this only updates the Snacks category row itself.
    if (snacks.parentId !== meals.id) {
      await tx.category.update({
        where: { id: snacks.id },
        data: { parentId: meals.id },
      });
      console.log('Snacks reparented under Meals.');
    } else {
      console.log('Snacks already parented under Meals — nothing to do.');
    }
  });

  console.log('\nDone. Meals now has two subcategories: Food and Snacks.');
}

main()
  .catch((err) => {
    console.error('regroup-meals-snacks failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
