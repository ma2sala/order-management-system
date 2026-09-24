const fs = require('fs');
const path = require('path');
const prisma = require('../prisma/client');

// Railway's own database backups need the Pro plan, so this is the
// restaurant's backup system:
//   - a full copy of every table (read-only SELECTs) as one JSON file,
//   - saved automatically every night at 04:00 Addis time, plus on demand
//     ("Back up now" in the Manager Dashboard),
//   - kept on the app's Railway volume (mounted at /app/uploads, so it
//     survives deploys) for BACKUP_KEEP_DAYS, and downloadable by managers.
//
// Staff password hashes are left out on purpose: the file ends up on
// whatever laptop/phone downloads it. (Restoring staff accounts just
// means setting their passwords again.)
//
// The backups folder is deliberately NOT under a publicly served path —
// app.js only serves /uploads/payment-screenshots — so a backup can only
// be fetched through the manager-only routes below.

const BACKUP_DIR = path.join(__dirname, '..', '..', 'uploads', 'backups');
const BACKUP_KEEP_DAYS = 30;
const BACKUP_HOUR_ADDIS = 4; // after closing, before opening
const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000; // UTC+3, no DST
const FILE_PATTERN = /^restaurant-backup-\d{4}-\d{2}-\d{2}-\d{4}(-auto|-manual)?\.json$/;
const OMIT_COLUMNS = { User: ['passwordHash'] };

fs.mkdirSync(BACKUP_DIR, { recursive: true });

// On Railway, files only survive a redeploy on a volume. Without one the
// backups (and payment photos) are wiped on every deploy — surfaced in
// the Manager Dashboard so it can't go unnoticed.
function storageIsPermanent() {
  if (!process.env.RAILWAY_ENVIRONMENT) return true; // local machine: plain disk
  return Boolean(process.env.RAILWAY_VOLUME_MOUNT_PATH);
}

async function buildBackup(exportedBy) {
  const tables = await prisma.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
  );

  const backup = {
    app: 'order-management-system',
    exportedAt: new Date().toISOString(),
    exportedBy,
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
  return backup;
}

function serialize(backup) {
  return JSON.stringify(backup, (key, value) => (typeof value === 'bigint' ? value.toString() : value), 1);
}

// Addis Ababa local time, e.g. 2026-09-25-0400
function addisStamp(date = new Date()) {
  const local = new Date(date.getTime() + ADDIS_OFFSET_MS).toISOString();
  return `${local.slice(0, 10)}-${local.slice(11, 13)}${local.slice(14, 16)}`;
}

function listBackupFiles() {
  return fs
    .readdirSync(BACKUP_DIR)
    .filter((name) => FILE_PATTERN.test(name))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUP_DIR, name));
      return { name, size: stat.size, createdAt: stat.mtime.toISOString(), kind: name.includes('-auto') ? 'auto' : 'manual' };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// Old backups are removed after BACKUP_KEEP_DAYS so the volume never
// fills up — but the newest few are always kept, even if the app was
// switched off for a while and they're all "old".
function pruneOldBackups() {
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 24 * 60 * 60 * 1000;
  listBackupFiles()
    .slice(5)
    .filter((f) => new Date(f.createdAt).getTime() < cutoff)
    .forEach((f) => {
      fs.unlinkSync(path.join(BACKUP_DIR, f.name));
      console.log(`[backup] removed old backup ${f.name}`);
    });
}

async function saveBackup(kind, exportedBy) {
  const backup = await buildBackup(exportedBy);
  const name = `restaurant-backup-${addisStamp()}-${kind}.json`;
  fs.writeFileSync(path.join(BACKUP_DIR, name), serialize(backup));
  console.log(`[backup] saved ${name} (${kind}, by ${exportedBy}) —`, JSON.stringify(backup.rowCounts));
  pruneOldBackups();
  return name;
}

// ---------------- Nightly schedule ----------------
function msUntilNextBackupHour() {
  const nowAddis = new Date(Date.now() + ADDIS_OFFSET_MS);
  const next = new Date(nowAddis);
  next.setUTCHours(BACKUP_HOUR_ADDIS, 0, 0, 0);
  if (next <= nowAddis) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - nowAddis.getTime();
}

function scheduleNextNightlyBackup() {
  setTimeout(async () => {
    try {
      await saveBackup('auto', 'automatic nightly backup');
    } catch (err) {
      console.error('[backup] nightly backup FAILED:', err);
    }
    scheduleNextNightlyBackup();
  }, msUntilNextBackupHour());
}

// Called once from server.js. Also takes a backup right away if the
// newest one is over a day old (first start, or the app was down at 04:00).
function startBackupSchedule() {
  if (!storageIsPermanent()) {
    console.warn('[backup] WARNING: no Railway volume attached — backups and payment photos are lost on every deploy');
  }
  const newest = listBackupFiles()[0];
  if (!newest || Date.now() - new Date(newest.createdAt).getTime() > 24 * 60 * 60 * 1000) {
    saveBackup('auto', 'automatic backup (on start-up)').catch((err) => console.error('[backup] start-up backup FAILED:', err));
  }
  scheduleNextNightlyBackup();
}

// ---------------- Manager-only routes ----------------

// GET /api/reports/backup — build a fresh backup and download it directly
async function downloadBackup(req, res) {
  try {
    const backup = await buildBackup(req.user.name);
    console.log(`[backup] downloaded by ${req.user.name} —`, JSON.stringify(backup.rowCounts));
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="restaurant-backup-${addisStamp()}.json"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(serialize(backup));
  } catch (err) {
    console.error('downloadBackup error:', err);
    res.status(500).json({ error: 'Failed to create backup' });
  }
}

// GET /api/reports/backups — saved backups, newest first
function listBackups(req, res) {
  try {
    res.json({ backups: listBackupFiles(), keepDays: BACKUP_KEEP_DAYS, nightlyAt: '04:00', storageIsPermanent: storageIsPermanent() });
  } catch (err) {
    console.error('listBackups error:', err);
    res.status(500).json({ error: 'Failed to list backups' });
  }
}

// POST /api/reports/backups — "Back up now"
async function createBackupNow(req, res) {
  try {
    const name = await saveBackup('manual', req.user.name);
    res.status(201).json({ name });
  } catch (err) {
    console.error('createBackupNow error:', err);
    res.status(500).json({ error: 'Failed to save backup' });
  }
}

// GET /api/reports/backups/:name — download one saved backup
function downloadSavedBackup(req, res) {
  const { name } = req.params;
  // Strict filename check — never lets a path like ../../.env through
  if (!FILE_PATTERN.test(name)) return res.status(400).json({ error: 'Invalid backup name' });
  const file = path.join(BACKUP_DIR, name);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Backup not found' });
  console.log(`[backup] ${name} downloaded by ${req.user.name}`);
  res.setHeader('Cache-Control', 'no-store');
  res.download(file, name);
}

module.exports = { downloadBackup, listBackups, createBackupNow, downloadSavedBackup, startBackupSchedule };
