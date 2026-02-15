const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const config = require('../config');
const { authRequired } = require('../middleware/auth');

const router = express.Router();

const uploadDir = config.uploads.dir;
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext.toLowerCase()) ? ext : '.jpg';
    cb(null, `${uuidv4()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /^image\/(jpeg|png|gif|webp)$/;
    if (allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image files (jpeg, png, gif, webp) are allowed'));
  },
});

// POST /media/upload (author only)
router.post(
  '/upload',
  authRequired,
  (req, res, next) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'File too large (max 5MB)' });
        }
        return res.status(400).json({ error: err.message || 'Upload failed' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }
      next();
    });
  },
  (req, res) => {
    const url = `${config.uploads.urlPrefix}/${req.file.filename}`;
    res.status(201).json({ url, filename: req.file.filename });
  }
);

module.exports = router;
