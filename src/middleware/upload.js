const fs = require('fs');
const path = require('path');
const multer = require('multer');

// Payment-proof screenshots (e.g. a Telebirr confirmation screen) live
// OUTSIDE public/, at the repo root's uploads/ folder — see app.js for
// the matching /uploads static route. This path is meant to be a
// Railway persistent volume mount (Settings -> Volumes on the
// order-management-system service, mount path /app/uploads), so files
// written here survive future deploys instead of being wiped along with
// the rest of the container on every redeploy.
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'payment-screenshots');
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
