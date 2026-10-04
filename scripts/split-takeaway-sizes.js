// One-off: split the Takeaway category into two sub-categories, "Small"
// and "Big", and move each "... (Small)" / "... (Big)" item into its one.
//
// The Manager screen can't do this by itself: it won't add a sub-category
// under a category that still holds items (they'd vanish from the ordering
// screens in between). Here the subs are created and the items moved in a
// single transaction, so the menu is never in that half-way state.
//
// Item names keep their "(Small)" / "(Big)" ending — the Chef's ticket and
// the receipt show only the item name, so that's how they know the size.
//
// Run on Railway (it needs the app's database connection):
//   railway ssh --service order-management-system -- node scripts/split-takeaway-sizes.js           (dry run — writes nothing)
//   railway ssh --service order-management-system -- node scripts/split-takeaway-sizes.js --apply   (does it)
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');
const SIZES = ['Small', 'Big'];

async function main() {
  const takeaway = await prisma.category.findFirst({
    where: { name: 'Takeaway' },
    include: { children: true, menuItems: { orderBy: { name: 'asc' } } },
  });
  if (!takeaway) throw new Error('No "Takeaway" category found');

  // Each size's sub-category: reuse it if a previous run already made it
  const subs = {};
  for (const size of SIZES) {
    const own = takeaway.children.find((c) => c.name.toLowerCase() === size.toLowerCase());
    if (own) {
      subs[size] = own;
      continue;
    }
    const clash = await prisma.category.findFirst({ where: { name: { equals: size, mode: 'insensitive' } } });
    if (clash) throw new Error(`A category named "${clash.name}" already exists elsewhere — rename it first`);
    subs[size] = null; // to be created
  }

  const moves = { Small: [], Big: [] };
  const leftOver = [];
  for (const item of takeaway.menuItems) {
    const size = SIZES.find((s) => item.name.endsWith(`(${s})`));
    if (size) moves[size].push(item);
    else leftOver.push(item.name);
  }

  // Takeaway will have sub-categories, so nothing may stay directly in it
  if (leftOver.length > 0) {
    throw new Error(
      `These Takeaway items aren't "(Small)" or "(Big)", so they'd disappear from the ordering screens: ` +
        `${leftOver.join(', ')}. Rename or move them first.`
    );
  }

  for (const size of SIZES) {
    console.log(`${size}: ${subs[size] ? 'sub-category exists' : 'sub-category will be created'} · ${moves[size].length} item(s) to move`);
    moves[size].forEach((i) => console.log(`  ${i.name}`));
  }

  if (!APPLY) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to do it.');
    return;
  }

  // All or nothing — one transaction
  await prisma.$transaction(async (tx) => {
    for (const size of SIZES) {
      const sub = subs[size] || (await tx.category.create({ data: { name: size, parentId: takeaway.id } }));
      if (moves[size].length > 0) {
        await tx.menuItem.updateMany({
          where: { id: { in: moves[size].map((i) => i.id) } },
          data: { categoryId: sub.id },
        });
      }
    }
  });

  console.log(`\nDone: Takeaway → Small (${moves.Small.length} items), Takeaway → Big (${moves.Big.length} items).`);
  console.log('Refresh the Manager/Cashier/Waiter screens to see the new tabs.');
}

main()
  .catch((err) => {
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
