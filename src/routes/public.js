const express = require('express');
const { query, validationResult } = require('express-validator');
const pool = require('../db/pool');
const config = require('../config');
const {
  getCachedPublishedPost,
  setCachedPublishedPost,
  getCachedPublishedList,
  setCachedPublishedList,
} = require('../lib/redis');

const router = express.Router();
const defaultLimit = config.pagination.defaultLimit;
const maxLimit = config.pagination.maxLimit;

// GET /posts/published - list published (public, paginated)
router.get(
  '/published',
  [
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: maxLimit }).toInt(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const page = Math.max(1, req.query.page || 1);
      const limit = Math.min(maxLimit, req.query.limit || defaultLimit);
      const offset = (page - 1) * limit;

      const cached = await getCachedPublishedList(page, limit);
      if (cached) return res.json(cached);

      const [countResult, listResult] = await Promise.all([
        pool.query(
          "SELECT COUNT(*)::int AS total FROM posts WHERE status = 'published'"
        ),
        pool.query(
          `SELECT id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at
           FROM posts WHERE status = 'published'
           ORDER BY published_at DESC NULLS LAST, updated_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
      ]);
      const total = countResult.rows[0].total;
      const payload = {
        posts: listResult.rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
      await setCachedPublishedList(page, limit, payload);
      res.json(payload);
    } catch (err) {
      console.error('List published error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /posts/published/:id - get one published (public)
router.get(
  '/published/:id',
  async (req, res) => {
    try {
      const id = req.params.id;
      const cached = await getCachedPublishedPost(id);
      if (cached) return res.json(cached);

      const { rows } = await pool.query(
        `SELECT id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at
         FROM posts WHERE id = $1 AND status = 'published'`,
        [id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Post not found' });
      const post = rows[0];
      await setCachedPublishedPost(id, post);
      res.json(post);
    } catch (err) {
      console.error('Get published post error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
