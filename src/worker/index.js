const Bull = require('bull');
const config = require('../config');
const pool = require('../db/pool');
const { invalidatePublishedPost, invalidatePublishedList } = require('../lib/redis');

const QUEUE_NAME = 'scheduled-publish';
const redisOpts = { redis: config.redis.url };

const queue = new Bull(QUEUE_NAME, redisOpts);

async function processScheduledPublish() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `SELECT id FROM posts
       WHERE status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= NOW()`
    );
    for (const row of rows) {
      await client.query('BEGIN');
      try {
        const { rows: updated } = await client.query(
          `UPDATE posts
           SET status = 'published', published_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND status = 'scheduled' AND scheduled_for <= NOW()
           RETURNING id`,
          [row.id]
        );
        if (updated.length > 0) {
          await client.query('COMMIT');
          await invalidatePublishedList();
          await invalidatePublishedPost(row.id);
        } else {
          await client.query('ROLLBACK');
        }
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Publish failed for post', row.id, e);
      }
    }
  } finally {
    client.release();
  }
}

queue.process(async () => {
  await processScheduledPublish();
});

processScheduledPublish().catch((err) => console.error('Initial run error:', err));
queue.add({}, { repeat: { every: 60 * 1000 } });

console.log('Scheduled publish worker started (runs every 60s).');
process.on('SIGTERM', () => {
  queue.close();
  pool.end();
  process.exit(0);
});

module.exports = { processScheduledPublish };
