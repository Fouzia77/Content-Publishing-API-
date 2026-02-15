const express = require('express');
const slugify = require('slugify');
const { body, param, query, validationResult } = require('express-validator');
const pool = require('../db/pool');
const config = require('../config');
const { authRequired, authorOwnsPost } = require('../middleware/auth');
const {
  invalidatePublishedPost,
  invalidatePublishedList,
} = require('../lib/redis');

const router = express.Router();
const defaultLimit = config.pagination.defaultLimit;
const maxLimit = config.pagination.maxLimit;

function ensureUniqueSlug(baseSlug) {
  const slug = slugify(baseSlug, { lower: true, strict: true }) || 'post';
  return slug;
}

async function generateUniqueSlug(client, title) {
  let base = ensureUniqueSlug(title);
  let slug = base;
  let counter = 0;
  for (;;) {
    const { rows } = await client.query(
      'SELECT 1 FROM posts WHERE slug = $1',
      [slug]
    );
    if (rows.length === 0) return slug;
    counter += 1;
    slug = `${base}-${counter}`;
  }
}

// POST /posts - Create (author only)
router.post(
  '/',
  authRequired,
  [
    body('title').trim().notEmpty().isLength({ max: 500 }),
    body('content').optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const { title, content = '' } = req.body;
      const authorId = req.user.id;
      const client = await pool.connect();
      try {
        const slug = await generateUniqueSlug(client, title);
        const { rows } = await client.query(
          `INSERT INTO posts (title, slug, content, status, author_id)
           VALUES ($1, $2, $3, 'draft', $4)
           RETURNING id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at`,
          [title, slug, content, authorId]
        );
        res.status(201).json(rows[0]);
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Create post error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /posts - List author's posts with pagination
router.get(
  '/',
  authRequired,
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
      const authorId = req.user.id;
      const [countResult, listResult] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS total FROM posts WHERE author_id = $1', [authorId]),
        pool.query(
          `SELECT id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at
           FROM posts WHERE author_id = $1
           ORDER BY updated_at DESC
           LIMIT $2 OFFSET $3`,
          [authorId, limit, offset]
        ),
      ]);
      const total = countResult.rows[0].total;
      res.json({
        posts: listResult.rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (err) {
      console.error('List posts error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /posts/:id - Get one (author, own only)
router.get(
  '/:id',
  authRequired,
  authorOwnsPost,
  async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at
         FROM posts WHERE id = $1`,
        [req.params.id]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Post not found' });
      res.json(rows[0]);
    } catch (err) {
      console.error('Get post error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// PUT /posts/:id - Update (author, own only) + create revision
router.put(
  '/:id',
  authRequired,
  authorOwnsPost,
  [
    body('title').optional().trim().notEmpty().isLength({ max: 500 }),
    body('content').optional().trim(),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const postId = req.params.id;
      const authorId = req.user.id;
      const updates = {};
      if (req.body.title !== undefined) updates.title = req.body.title;
      if (req.body.content !== undefined) updates.content = req.body.content;
      if (Object.keys(updates).length === 0) {
        const { rows } = await pool.query(
          'SELECT id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at FROM posts WHERE id = $1',
          [postId]
        );
        return res.json(rows[0]);
      }
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: current } = await client.query(
          'SELECT title, content, status FROM posts WHERE id = $1',
          [postId]
        );
        if (current.length === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Post not found' });
        }
        const prev = current[0];
        const newTitle = updates.title !== undefined ? updates.title : prev.title;
        const newContent = updates.content !== undefined ? updates.content : prev.content;
        await client.query(
          `INSERT INTO post_revisions (post_id, title_snapshot, content_snapshot, revision_author_id)
           VALUES ($1, $2, $3, $4)`,
          [postId, prev.title, prev.content, authorId]
        );
        let newSlug = null;
        if (updates.title !== undefined) {
          newSlug = ensureUniqueSlug(newTitle);
          const { rows: slugCheck } = await client.query(
            'SELECT 1 FROM posts WHERE slug = $1 AND id != $2',
            [newSlug, postId]
          );
          if (slugCheck.length > 0) newSlug = `${newSlug}-${Date.now()}`;
        }
        if (newSlug !== null) {
          await client.query(
            'UPDATE posts SET title = $1, content = $2, slug = $3, updated_at = NOW() WHERE id = $4',
            [newTitle, newContent, newSlug, postId]
          );
        } else {
          await client.query(
            'UPDATE posts SET title = $1, content = $2, updated_at = NOW() WHERE id = $3',
            [newTitle, newContent, postId]
          );
        }
        const { rows: updated } = await client.query(
          'SELECT id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at FROM posts WHERE id = $1',
          [postId]
        );
        await client.query('COMMIT');
        if (prev.status === 'published') {
          await invalidatePublishedPost(postId);
          await invalidatePublishedList();
        }
        res.json(updated[0]);
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Update post error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// DELETE /posts/:id (author, own only)
router.delete(
  '/:id',
  authRequired,
  authorOwnsPost,
  async (req, res) => {
    try {
      const postId = req.params.id;
      const { rows } = await pool.query('SELECT status FROM posts WHERE id = $1', [postId]);
      if (rows.length === 0) return res.status(404).json({ error: 'Post not found' });
      await pool.query('DELETE FROM posts WHERE id = $1', [postId]);
      if (rows[0].status === 'published') {
        await invalidatePublishedPost(postId);
        await invalidatePublishedList();
      }
      res.status(204).send();
    } catch (err) {
      console.error('Delete post error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /posts/:id/publish - draft -> published
router.post(
  '/:id/publish',
  authRequired,
  authorOwnsPost,
  async (req, res) => {
    try {
      const postId = req.params.id;
      const client = await pool.connect();
      try {
        const { rows } = await client.query(
          'SELECT id, status FROM posts WHERE id = $1',
          [postId]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Post not found' });
        if (rows[0].status !== 'draft') {
          return res.status(400).json({ error: 'Only draft posts can be published immediately' });
        }
        await client.query(
          `UPDATE posts SET status = 'published', published_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [postId]
        );
        const { rows: updated } = await client.query(
          'SELECT id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at FROM posts WHERE id = $1',
          [postId]
        );
        await invalidatePublishedList();
        res.json(updated[0]);
      } finally {
        client.release();
      }
    } catch (err) {
      console.error('Publish post error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// POST /posts/:id/schedule - draft -> scheduled
router.post(
  '/:id/schedule',
  authRequired,
  authorOwnsPost,
  [body('scheduled_for').isISO8601()],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
      const postId = req.params.id;
      const scheduledFor = new Date(req.body.scheduled_for);
      if (scheduledFor <= new Date()) {
        return res.status(400).json({ error: 'scheduled_for must be a future date and time' });
      }
      const { rows } = await pool.query(
        'SELECT id, status FROM posts WHERE id = $1',
        [postId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Post not found' });
      if (rows[0].status !== 'draft') {
        return res.status(400).json({ error: 'Only draft posts can be scheduled' });
      }
      await pool.query(
        `UPDATE posts SET status = 'scheduled', scheduled_for = $1, updated_at = NOW() WHERE id = $2`,
        [scheduledFor, postId]
      );
      const { rows: updated } = await pool.query(
        'SELECT id, title, slug, content, status, author_id, scheduled_for, published_at, created_at, updated_at FROM posts WHERE id = $1',
        [postId]
      );
      res.json(updated[0]);
    } catch (err) {
      console.error('Schedule post error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// GET /posts/:id/revisions - version history (author, own only)
router.get(
  '/:id/revisions',
  authRequired,
  authorOwnsPost,
  async (req, res) => {
    try {
      const postId = req.params.id;
      const { rows } = await pool.query(
        `SELECT pr.id AS revision_id, pr.post_id, pr.title_snapshot, pr.content_snapshot,
                pr.revision_timestamp, u.username AS revision_author
         FROM post_revisions pr
         JOIN users u ON u.id = pr.revision_author_id
         WHERE pr.post_id = $1
         ORDER BY pr.revision_timestamp DESC`,
        [postId]
      );
      const list = rows.map((r) => ({
        revision_id: r.revision_id,
        post_id: r.post_id,
        title_snapshot: r.title_snapshot,
        content_snapshot: r.content_snapshot,
        revision_author: r.revision_author,
        revision_timestamp: r.revision_timestamp,
      }));
      res.json(list);
    } catch (err) {
      console.error('Get revisions error:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
