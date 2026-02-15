const express = require('express');
const cors = require('cors');
const path = require('path');
const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const config = require('./config');
const { ensureSeed } = require('./db/ensureSeed');
const authRoutes = require('./routes/auth');
const postsRoutes = require('./routes/posts');
const publicRoutes = require('./routes/public');
const searchRoutes = require('./routes/search');
const mediaRoutes = require('./routes/media');

const app = express();

app.use(cors());
app.use(express.json());

if (config.uploads.urlPrefix) {
  app.use(config.uploads.urlPrefix, express.static(path.resolve(config.uploads.dir)));
}

try {
  const openapiPath = path.join(__dirname, '..', 'openapi.yaml');
  const openapiSpec = YAML.load(openapiPath);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec, { explorer: true }));
  app.get('/openapi.json', (req, res) => {
    res.json(openapiSpec);
  });
} catch (err) {
  console.warn('OpenAPI/Swagger not loaded:', err.message);
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRoutes);
app.use('/posts', publicRoutes);
app.use('/posts', postsRoutes);
app.use('/search', searchRoutes);
app.use('/media', mediaRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

let server = null;
if (require.main === module) {
  server = app.listen(config.port, () => {
    console.log(`CMS API listening on port ${config.port}`);
    ensureSeed().catch(() => {});
  });
}

module.exports = { app, server };
