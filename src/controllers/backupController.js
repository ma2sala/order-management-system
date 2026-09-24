const prisma = require('../prisma/client');

// GET /api/reports/backup — manager only.
//
// Railway's own database backups need the Pro plan, so this is the
// restaurant's backup: one JSON file with every row of every table,
// downloaded from the Manager Dashboard's "Backup" button. It only ever
// SELECTs — nothing is changed.
//
// Staff password hashes are left out on purpose: the file ends up on
// whatever laptop/phone downloaded it. (Restoring staff accounts just
// means setting their passwords again.)
const OMIT_COLUMNS = { users: ['passwordHash'], User: ['passwordHash'] };

async function downloadBackup(req, res) {
  try {
    const tables = await prisma.$queryRawUnsafe(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    );

    const backup = {
      app: 'order-management-system',
      exportedAt: new Date().toISOString(),
      exportedBy: req.user.name,
      rowCounts: {},
      tables: {},
    };

    for (const { table_name: table } of tables) {
      // Table names come from the database's own catalog, not the request
      let rows = await prisma.$queryRawUnsafe(`SELECT * FROM "${table}"`);
      const omit = OMIT_COLUMNS[table];
      if (omit) rows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([k]) => !omit.includes(k))));
      backup.tables[table] = rows;
      backup.rowCounts[table] = rows.length;
    }

    // Addis Ababa local time in the filename, e.g. restaurant-backup-2026-09-25-0130.json
    const local = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
    const stamp = `${local.slice(0, 10)}-${local.slice(11, 13)}${local.slice(14, 16)}`;

    console.log(`[backup] downloaded by ${req.user.name} —`, JSON.stringify(backup.rowCounts));

    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="restaurant-backup-${stamp}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(JSON.stringify(backup, (key, value) => (typeof value === 'bigint' ? value.toString() : value), 1));
  } catch (err) {
    console.error('downloadBackup error:', err);
    res.status(500).json({ error: 'Failed to create backup' });
  }
}

module.exports = { downloadBackup };
