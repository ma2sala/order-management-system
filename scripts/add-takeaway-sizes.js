// One-off: copy every food item (everything under "Meals", except the
// Takeaway category itself) into "Takeaway" twice, as
// "<name> (Small)" and "<name> (Big)".
//
// Price can't be blank in the database, so each new item is created at
// price 0, and Available — it shows on the Cashier/Waiter screens right
// away. Until a real price is set in Manager → Menu it rings up as $0.
//
// Removable ingredients / extras are copied from the original item;
// stock links are NOT (a small and a big portion use different amounts).
// Items that already exist by name aren't duplicated, so it's safe to
// re-run; a Small/Big item an earlier run left hidden at $0 is un-hidden.
//
// Run on Railway (it needs the app's database connection):
//   railway ssh --service order-management-system -- node scripts/add-takeaway-sizes.js           (dry run — writes nothing)
//   railway ssh --service order-management-system -- node scripts/add-takeaway-sizes.js --apply   (creates them)
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  const meals = await prisma.category.findFirst({ where: { name: 'Meals', parentId: null } });
  if (!meals) throw new Error('No top-level "Meals" category found');

  const takeaway = await prisma.category.findFirst({
    where: { name: 'Takeaway' },
    include: { _count: { select: { children: true, menuItems: true } } },
  });
  if (!takeaway) throw new Error('No "Takeaway" category found');
  if (takeaway._count.children > 0) throw new Error('"Takeaway" has sub-categories — items can\'t go in it directly');

  // Every category under Meals (up to 2 levels deep), minus Takeaway
  const subs = await prisma.category.findMany({ where: { parentId: meals.id }, include: { children: true } });
  const sourceCategoryIds = [meals.id];
  subs.forEach((c) => {
    sourceCategoryIds.push(c.id);
    c.children.forEach((g) => sourceCategoryIds.push(g.id));
  });

  const foods = await prisma.menuItem.findMany({
    where: { categoryId: { in: sourceCategoryIds.filter((id) => id !== takeaway.id) } },
    include: { category: true },
    orderBy: [{ categoryId: 'asc' }, { name: 'asc' }],
  });

  const existing = await prisma.menuItem.findMany({
    select: { id: true, name: true, price: true, isAvailable: true, categoryId: true },
  });
  const existingByName = new Map(existing.map((m) => [m.name, m]));
  const toCreate = [];
  const skipped = [];
  const toUnhide = []; // created hidden by an earlier run of this script
  for (const food of foods) {
    for (const size of ['Small', 'Big']) {
      const name = `${food.name} (${size})`;
      const found = existingByName.get(name);
      if (found) {
        if (found.categoryId === takeaway.id && !found.isAvailable && Number(found.price) === 0) {
          toUnhide.push(found);
        } else {
          skipped.push(name);
        }
        continue;
      }
      toCreate.push({
        name,
        price: 0,
        isAvailable: true, // shows on the ordering screens now; price set later
        isFeatured: false,
        categoryId: takeaway.id,
        imageUrl: food.imageUrl,
        hasTemperatureOption: food.hasTemperatureOption,
        temperatureOptions: food.temperatureOptions,
        customizableIngredients: food.customizableIngredients,
        extraOptions: food.extraOptions === null ? undefined : food.extraOptions,
      });
    }
  }

  console.log(`Takeaway currently has ${takeaway._count.menuItems} item(s).`);
  console.log(`Food items found: ${foods.length}`);
  const byCategory = {};
  foods.forEach((f) => {
    (byCategory[f.category.name] = byCategory[f.category.name] || []).push(f.name);
  });
  Object.entries(byCategory).forEach(([cat, names]) => console.log(`  ${cat}: ${names.join(', ')}`));
  console.log(`To create: ${toCreate.length}   To un-hide: ${toUnhide.length}   Already there (skipped): ${skipped.length}`);

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to create them.');
    return;
  }

  // All or nothing — one transaction
  const results = await prisma.$transaction([
    ...toCreate.map((data) => prisma.menuItem.create({ data, select: { id: true, name: true } })),
    ...toUnhide.map((m) =>
      prisma.menuItem.update({ where: { id: m.id }, data: { isAvailable: true }, select: { id: true, name: true } })
    ),
  ]);
  console.log(`\nDone: ${toCreate.length} created, ${toUnhide.length} un-hidden — in Takeaway, Available, price $0:`);
  results.forEach((c) => console.log(`  ${c.name}`));
  console.log('\nSet their prices in Manager → Menu — until then they ring up as $0.');
  console.log('Open Manager/Cashier/Waiter screens need a refresh to see the new items.');
}

main()
  .catch((err) => {
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
