const Redis = require('ioredis');
const config = require('../config');

let client = null;

function getRedis() {
  if (!client) {
    client = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 100, 3000);
      },
    });
    client.on('error', (err) => console.error('Redis error:', err));
  }
  return client;
}

const CACHE_TTL = 300; // 5 minutes
const LIST_KEY = 'published_posts_list';
const POST_KEY_PREFIX = 'published_post:';
const LIST_DEFAULT_TTL = 60;

async function safeRedis(fn) {
  try {
    const redis = getRedis();
    return await fn(redis);
  } catch (err) {
    return null;
  }
}

async function getCachedPublishedPost(id) {
  const data = await safeRedis((r) => r.get(`${POST_KEY_PREFIX}${id}`));
  return data ? JSON.parse(data) : null;
}

async function setCachedPublishedPost(id, post) {
  await safeRedis((r) => r.setex(`${POST_KEY_PREFIX}${id}`, CACHE_TTL, JSON.stringify(post)));
}

async function invalidatePublishedPost(id) {
  await safeRedis(async (r) => {
    await r.del(`${POST_KEY_PREFIX}${id}`);
    await r.del(LIST_KEY);
  });
}

async function getCachedPublishedList(page, limit) {
  const data = await safeRedis((r) => r.get(`${LIST_KEY}:${page}:${limit}`));
  return data ? JSON.parse(data) : null;
}

async function setCachedPublishedList(page, limit, data) {
  await safeRedis((r) => r.setex(`${LIST_KEY}:${page}:${limit}`, LIST_DEFAULT_TTL, JSON.stringify(data)));
}

async function invalidatePublishedList() {
  await safeRedis(async (r) => {
    const keys = await r.keys(`${LIST_KEY}:*`);
    if (keys.length) await r.del(...keys);
  });
}

async function invalidateAllPublished() {
  await safeRedis(async (r) => {
    const postKeys = await r.keys(`${POST_KEY_PREFIX}*`);
    const listKeys = await r.keys(`${LIST_KEY}*`);
    const all = [...postKeys, ...listKeys];
    if (all.length) await r.del(...all);
  });
}

module.exports = {
  getRedis,
  getCachedPublishedPost,
  setCachedPublishedPost,
  invalidatePublishedPost,
  getCachedPublishedList,
  setCachedPublishedList,
  invalidatePublishedList,
  invalidateAllPublished,
};
