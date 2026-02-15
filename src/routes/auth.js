const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const config = require('../config');

const router = express.Router();

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { email, password } = req.body;
      const { rows } = await pool.query(
        'SELECT id, username, email, password_hash, role FROM users WHERE email = $1',
        [email]
      );
      if (rows.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const user = rows[0];
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      const token = jwt.sign(
        { userId: user.id, role: user.role, username: user.username },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );
      return res.json({
        token,
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
        },
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
