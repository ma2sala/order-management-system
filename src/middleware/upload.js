const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Payment-proof screenshots (e.g. a Telebirr confirmation screen) live
// under public/, so express.static in app.js serves them directly at
// /uploads/payment-screenshots/<filename> — no separate download route
// needed.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads', 'payment-screenshots');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}${ext}`);
  },
});

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function fileFilter(req, file, cb) {
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return cb(new Error('Screenshot must be an image (JPEG, PNG, WEBP, or GIF)'));
  }
  cb(null, true);
}

const uploadPaymentScreenshot = multer({
  storage,
  fileFilter,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — plenty for a phone screenshot
});

module.exports = uploadPaymentScreenshot;
