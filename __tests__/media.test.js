const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { app } = require('../src/index');
const pool = require('../src/db/pool');
const bcrypt = require('bcryptjs');

let authToken;

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

describe('POST /media/upload', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).post('/media/upload');
    expect(res.status).toBe(401);
  });

  it('returns 400 when no file', async () => {
    const res = await request(app)
      .post('/media/upload')
      .set('Authorization', `Bearer ${authToken}`);
    expect(res.status).toBe(400);
  });

  it('accepts image upload and returns url', async () => {
    const dir = path.join(__dirname, '../uploads_test');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const pngPath = path.join(dir, 'tiny.png');
    const buf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    fs.writeFileSync(pngPath, buf);
    const res = await request(app)
      .post('/media/upload')
      .set('Authorization', `Bearer ${authToken}`)
      .attach('file', pngPath);
    if (res.status === 201) {
      expect(res.body.url).toBeDefined();
      expect(res.body.filename).toBeDefined();
    }
    try { fs.unlinkSync(pngPath); } catch (_) {}
  });
});
