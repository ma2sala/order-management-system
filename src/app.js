const path = require('path');
const express = require('express');
const cors = require('cors');

const authRouter = require('./routes/auth');
const ordersRouter = require('./routes/orders');
const catalogRouter = require('./routes/catalog');
const reportsRouter = require('./routes/reports');
const usersRouter = require('./routes/users');
const stockRouter = require('./routes/stock');
const menuItemsRouter = require('./routes/menuItems');
const paymentsRouter = require('./routes/payments');
const multer = require('multer');

function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Silences the browser's automatic GET /favicon.ico request (every
  // browser makes this on its own, regardless of whether any page links
  // a favicon) that would otherwise 404 and clutter the console/logs on
  // every screen. 204 No Content is the correct "nothing here, and
  // that's fine" response — no fake/placeholder icon file needed.
  app.get('/favicon.ico', (req, res) => res.status(204).end());

  // Serve the plain HTML/CSS/JS frontends
  // http://localhost:PORT/waiter/  and  http://localhost:PORT/barista/
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Payment-proof screenshots live OUTSIDE public/ on purpose — public/ is
  // part of the git repo and gets replaced wholesale on every deploy,
  // which would wipe any uploaded file. This directory instead lives at
  // the repo root (../uploads) and is meant to be a Railway persistent
  // volume mounted there, so uploads survive redeploys. Served at the
  // same /uploads/... URL the app already used, so no frontend/DB change
  // is needed — see UPLOAD_DIR in middleware/upload.js for the matching
  // write-side path.
  app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

  app.use('/api/auth', authRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api', catalogRouter); // /api/tables, /api/categories
  app.use('/api/reports', reportsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/stock', stockRouter);
  app.use('/api/menu-items', menuItemsRouter);
  app.use('/api/payments', paymentsRouter);

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Fallback error handler
  app.use((err, req, res, next) => {
    // multer surfaces file-size/type problems (e.g. a non-image payment
    // screenshot) as an error passed to next() rather than a thrown
    // exception a controller's try/catch would see — handle those here
    // with a proper 400 instead of the generic 500 below.
    if (err instanceof multer.MulterError || (err && err.message && err.message.includes('Screenshot must be'))) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = createApp;
