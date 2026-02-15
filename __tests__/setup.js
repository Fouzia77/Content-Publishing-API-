process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || 'postgresql://cms_user:cms_password@localhost:5432/cms_db';
process.env.REDIS_URL = process.env.TEST_REDIS_URL || process.env.REDIS_URL || 'redis://localhost:6379';
process.env.UPLOADS_DIR = require('path').join(__dirname, '../uploads_test');
