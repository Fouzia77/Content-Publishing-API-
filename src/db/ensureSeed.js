const pool = require('./pool');
const bcrypt = require('bcryptjs');

async function ensureSeed() {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      "SELECT 1 FROM users WHERE email = 'author@example.com'"
    );
    if (rows.length > 0) return;
    const hash = await bcrypt.hash('password123', 10);
    await client.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ('author1', 'author@example.com', $1, 'author')`,
      [hash]
    );
    console.log('Seeded default author: author@example.com / password123');
  } catch (err) {
    console.error('Ensure seed error:', err);
  } finally {
    client.release();
  }
}

module.exports = { ensureSeed };
