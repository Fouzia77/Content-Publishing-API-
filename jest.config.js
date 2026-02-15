module.exports = {
  testEnvironment: 'node',
  testTimeout: 10000,
  setupFiles: ['<rootDir>/__tests__/setup.js'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.js', '!src/db/seed.js', '!src/db/migrate.js'],
  testMatch: ['**/__tests__/**/*.test.js'],
};
