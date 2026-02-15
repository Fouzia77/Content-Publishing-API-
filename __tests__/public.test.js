const request = require('supertest');
const { app } = require('../src/index');
const pool = require('../src/db/pool');
const bcrypt = require('bcryptjs');

let authToken;
let publishedPostId;

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
  const authorId = rows[0].id;
  const { rows: postRows } = await client.query(
    `INSERT INTO posts (title, slug, content, status, author_id, published_at)
     VALUES ('Public Post', 'public-post-' || floor(random()*10000), 'Public content', 'published', $1, NOW())
     RETURNING id`,
    [authorId]
  );
  publishedPostId = postRows[0].id;
  client.release();
  const login = await request(app)
    .post('/auth/login')
    .send({ email: 'test@example.com', password: 'testpass' });
  authToken = login.body.token;
});

afterAll(async () => {
  await pool.end();
});

describe('GET /posts/published', () => {
  it('returns paginated published posts without auth', async () => {
    const res = await request(app).get('/posts/published?page=1&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.posts).toBeInstanceOf(Array);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.limit).toBe(5);
  });

  it('GET /posts/published/:id returns one published post', async () => {
    const res = await request(app).get(`/posts/published/${publishedPostId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(publishedPostId);
    expect(res.body.status).toBe('published');
  });

  it('GET /posts/published/:id returns 404 for draft', async () => {
    const create = await request(app)
      .post('/posts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Draft Only', content: 'Draft' });
    const res = await request(app).get(`/posts/published/${create.body.id}`);
    expect(res.status).toBe(404);
  });
});
