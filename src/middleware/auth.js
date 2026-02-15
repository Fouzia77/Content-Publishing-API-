const jwt = require('jsonwebtoken');
const config = require('../config');
const pool = require('../db/pool');

function authOptional(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = { id: decoded.userId, role: decoded.role, username: decoded.username };
    return next();
  } catch {
    req.user = null;
    return next();
  }
}

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = header.slice(7);
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (decoded.role !== 'author') {
      return res.status(403).json({ error: 'Author role required' });
    }
    req.user = { id: decoded.userId, role: decoded.role, username: decoded.username };
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function authorOwnsPost(req, res, next) {
  const postId = req.params.id;
  const userId = req.user.id;
  const { rows } = await pool.query(
    'SELECT id, author_id FROM posts WHERE id = $1',
    [postId]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'Post not found' });
  }
  if (rows[0].author_id !== userId) {
    return res.status(403).json({ error: 'Not authorized to access this post' });
  }
  req.post = rows[0];
  next();
}

module.exports = {
  authOptional,
  authRequired,
  authorOwnsPost,
};
