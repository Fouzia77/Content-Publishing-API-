const request = require('supertest');
const { app } = require('../src/index');
const pool = require('../src/db/pool');
const bcrypt = require('bcryptjs');

beforeAll(async () => {
  const client = await pool.connect();
  await client.query(
    "INSERT INTO users (username, email, password_hash, role) VALUES ('testauthor', 'test@example.com', $1, 'author') ON CONFLICT (email) DO NOTHING",
    [await bcrypt.hash('testpass', 10)]
  );
  client.release();
});

afterAll(async () => {
  await pool.end();
});

describe('POST /auth/login', () => {
  it('returns 400 for invalid body', async () => {
    const res = await request(app).post('/auth/login').send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for wrong password', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid|password/i);
  });

  it('returns 401 for unknown email', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nonexistent@example.com', password: 'any' });
    expect(res.status).toBe(401);
  });

  it('returns token and user for valid credentials', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'test@example.com', password: 'testpass' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toBeDefined();
    expect(res.body.user.username).toBe('testauthor');
    expect(res.body.user.role).toBe('author');
  });
});
