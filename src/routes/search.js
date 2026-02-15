const express = require('express');
const { query, validationResult } = require('express-validator');
const pool = require('../db/pool');
const config = require('../config');

const router = express.Router();
const defaultLimit = config.pagination.defaultLimit;
const maxLimit = config.pagination.maxLimit;

// GET /search?q=... - full-text search on published posts (public)
router.get(
  '/',
  [
    query('q').trim().notEmpty(),
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: maxLimit }).toInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const searchQuery = req.query.q;
      const page = Math.max(1, req.query.page || 1);
      const limit = Math.min(maxLimit, req.query.limit || defaultLimit);
      const offset = (page - 1) * limit;

      const tsQuery = searchQuery.trim().split(/\s+/).filter(Boolean).map((w) => `${w}:*`).join(' & ') || searchQuery;
      const countResult = await pool.query(
        `SELECT COUNT(*)::int AS total
         FROM posts
         WHERE status = 'published' AND search_vector @@ plainto_tsquery('english', $1)`,
        [searchQuery]
      );
      const total = countResult.rows[0].total;

      const listResult = await pool.query(
        `SELECT id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at
         FROM posts
         WHERE status = 'published' AND search_vector @@ plainto_tsquery('english', $1)
         ORDER BY ts_rank(search_vector, plainto_tsquery('english', $1)) DESC
         LIMIT $2 OFFSET $3`,
        [searchQuery, limit, offset]
      );

      res.json({
        posts: listResult.rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err) {
      console.error('Search error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
