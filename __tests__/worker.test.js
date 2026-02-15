const pool = require('../src/db/pool');
const bcrypt = require('bcryptjs');
const { processScheduledPublish } = require('../src/worker/index');

let authorId;
let scheduledPostId;

beforeAll(async () => {
  const client = await pool.connect();
  let { rows } = await client.query(
    "SELECT id FROM users WHERE email = 'test@example.com'"
  );
  if (rows.length === 0) {
    const hash = await bcrypt.hash('testpass', 10);
    await client.query(
      "INSERT INTO users (username, email, password_hash, role) VALUES ('testauthor', 'test@example.com', $1, 'author') RETURNING id",
      [hash]
    );
    rows = await client.query("SELECT id FROM users WHERE email = 'test@example.com'").then((r) => r.rows);
  }
  authorId = rows[0].id;
  const past = new Date(Date.now() - 60000);
  const { rows: postRows } = await client.query(
    `INSERT INTO posts (title, slug, content, status, author_id, scheduled_for)
     VALUES ('Worker Test Post', 'worker-test-' || floor(random()*100000), 'Content', 'scheduled', $1, $2)
     RETURNING id`,
    [authorId, past]
  );
  scheduledPostId = postRows[0].id;
  client.release();
});

afterAll(async () => {
  await pool.end();
});

describe('Scheduled publish worker', () => {
  it('publishes posts with scheduled_for in the past', async () => {
    await processScheduledPublish();
    const { rows } = await pool.query(
      'SELECT status, published_at FROM posts WHERE id = $1',
      [scheduledPostId]
    );
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('published');
    expect(rows[0].published_at).toBeDefined();
  });

  it('is idempotent - second run does not error', async () => {
    await expect(processScheduledPublish()).resolves.not.toThrow();
    const { rows } = await pool.query(
      'SELECT status FROM posts WHERE id = $1',
      [scheduledPostId]
    );
    expect(rows[0].status).toBe('published');
  });
});
