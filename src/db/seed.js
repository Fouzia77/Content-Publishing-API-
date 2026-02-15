const pool = require('./pool');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query(
      "SELECT 1 FROM users WHERE email = $1",
      ['author@example.com']
    );
    if (existing.length > 0) {
      console.log('Seed already applied (author exists).');
      return;
    }
    const hash = await bcrypt.hash('password123', 10);
    await client.query(
      `INSERT INTO users (username, email, password_hash, role)
       VALUES ($1, $2, $3, 'author')`,
      ['author1', 'author@example.com', hash]
    );
    console.log('Seed completed: author1 / author@example.com / password123');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
