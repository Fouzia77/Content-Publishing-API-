const request = require('supertest');
const { app } = require('../src/index');
const pool = require('../src/db/pool');
const bcrypt = require('bcryptjs');

let authToken;
let authorId;

beforeAll(async () => {
  const client = await pool.connect();
  const { rows } = await client.query(
    "SELECT id FROM users WHERE email = 'test@example.com'"
  );
  if (rows.length === 0) {
    const hash = await bcrypt.hash('testpass', 10);
    const ins = await client.query(
      "INSERT INTO users (username, email, password_hash, role) VALUES ('testauthor', 'test@example.com', $1, 'author') RETURNING id",
      [hash]
    );
    authorId = ins.rows[0].id;
  } else {
    authorId = rows[0].id;
  }
  client.release();
  const login = await request(app)
    .post('/auth/login')
    .send({ email: 'test@example.com', password: 'testpass' });
  authToken = login.body.token;
});

afterAll(async () => {
  await pool.end();
});

describe('Posts CRUD (author)', () => {
  let postId;

  it('POST /posts creates draft', async () => {
    const res = await request(app)
      .post('/posts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Test Post', content: 'Hello world' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.slug).toBeDefined();
    expect(res.body.title).toBe('Test Post');
    postId = res.body.id;
  });

  it('GET /posts lists author posts with pagination', async () => {
    const res = await request(app)
      .get('/posts?page=1&limit=10')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.posts).toBeInstanceOf(Array);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
  });

  it('GET /posts/:id returns own post', async () => {
    const res = await request(app)
      .get(`/posts/${postId}`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(postId);
  });

  it('PUT /posts/:id updates and creates revision', async () => {
    const res = await request(app)
      .put(`/posts/${postId}`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Updated Title', content: 'Updated content' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Updated Title');
    expect(res.body.content).toBe('Updated content');
  });

  it('GET /posts/:id/revisions returns history', async () => {
    const res = await request(app)
      .get(`/posts/${postId}/revisions`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('title_snapshot');
    expect(res.body[0]).toHaveProperty('revision_author');
    expect(res.body[0]).toHaveProperty('revision_timestamp');
  });

  it('POST /posts/:id/publish publishes draft', async () => {
    const res = await request(app)
      .post(`/posts/${postId}/publish`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('published');
    expect(res.body.published_at).toBeDefined();
  });

  it('POST /posts/:id/publish on non-draft returns 400', async () => {
    const res = await request(app)
      .post(`/posts/${postId}/publish`)
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(400);
  });
});

describe('Posts schedule', () => {
  let draftId;

  beforeAll(async () => {
    const create = await request(app)
      .post('/posts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Scheduled Post', content: 'Future' });
    draftId = create.body.id;
  });

  it('POST /posts/:id/schedule with future date', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app)
      .post(`/posts/${draftId}/schedule`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ scheduled_for: future });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('scheduled');
    expect(res.body.scheduled_for).toBeDefined();
  });

  it('POST /posts/:id/schedule with past date returns 400', async () => {
    const create2 = await request(app)
      .post('/posts')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ title: 'Another Draft', content: 'x' });
    const past = new Date(Date.now() - 1000).toISOString();
    const res = await request(app)
      .post(`/posts/${create2.body.id}/schedule`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ scheduled_for: past });
    expect(res.status).toBe(400);
  });
});

describe('Authorization', () => {
  it('GET /posts without token returns 401', async () => {
    const res = await request(app).get('/posts');
    expect(res.status).toBe(401);
  });

  it('POST /posts without token returns 401', async () => {
    const res = await request(app).post('/posts').send({ title: 'X', content: 'Y' });
    expect(res.status).toBe(401);
  });
});
