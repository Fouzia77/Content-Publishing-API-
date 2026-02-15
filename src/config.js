require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  database: {
    url: process.env.DATABASE_URL || 'postgresql://cms_user:cms_password@localhost:5432/cms_db',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  uploads: {
    dir: process.env.UPLOADS_DIR || './uploads',
    urlPrefix: process.env.UPLOADS_URL_PREFIX || '/uploads',
  },
  pagination: {
    defaultLimit: 20,
    maxLimit: 100,
  },
};
