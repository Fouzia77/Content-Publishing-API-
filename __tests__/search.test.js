const request = require('supertest');
const { app } = require('../src/index');
const pool = require('../src/db/pool');
const bcrypt = require('bcryptjs');

beforeAll(async () => {
  const client = await pool.connect();
  let { rows } = await client.query(
    "SELECT id FROM users WHERE email = 'test@example.com'"
  );
  if (rows.length === 0) {
    const hash = await bcrypt.hash('testpass', 10);
    await client.query(
      "INSERT INTO users (username, email, password_hash, role) VALUES ('testauthor', 'test@example.com', $1, 'author')",
      [hash]
    );
    rows = await client.query("SELECT id FROM users WHERE email = 'test@example.com'").then((r) => r.rows);
  }
  const authorId = rows[0].id;
  await client.query(
    `INSERT INTO posts (title, slug, content, status, author_id, published_at)
     VALUES ('Searchable Unique Title XYZ', 'search-xyz-' || floor(random()*100000), 'Unique searchable content XYZ', 'published', $1, NOW())
     ON CONFLICT (slug) DO NOTHING`,
    [authorId]
  );
  client.release();
});

afterAll(async () => {
  await pool.end();
});

describe('GET /search', () => {
  it('returns 400 without q', async () => {
    const res = await request(app).get('/search');
    expect(res.status).toBe(400);
  });

  it('returns results for matching query', async () => {
    const res = await request(app).get('/search?q=Searchable+Unique+Title+XYZ');
    expect(res.status).toBe(200);
    expect(res.body.posts).toBeInstanceOf(Array);
    expect(res.body.pagination).toBeDefined();
  });

  it('returns results for content search', async () => {
    const res = await request(app).get('/search?q=Unique+searchable+content+XYZ');
    expect(res.status).toBe(200);
    expect(res.body.posts).toBeInstanceOf(Array);
  });
});
