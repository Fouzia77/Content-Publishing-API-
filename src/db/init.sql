-- CMS Database Schema
-- Runs automatically when PostgreSQL container starts

-- Enum types
CREATE TYPE user_role AS ENUM ('author', 'public');
CREATE TYPE post_status AS ENUM ('draft', 'scheduled', 'published');

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role user_role NOT NULL DEFAULT 'author',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Posts table
CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  slug VARCHAR(600) UNIQUE NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status post_status NOT NULL DEFAULT 'draft',
  author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scheduled_for TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_author_id ON posts(author_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled_for ON posts(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_posts_published_at ON posts(published_at) WHERE status = 'published';

-- Full-text search: tsvector column and GIN index for published posts
ALTER TABLE posts ADD COLUMN IF NOT EXISTS search_vector tsvector;
CREATE INDEX IF NOT EXISTS idx_posts_search ON posts USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_posts_status_published ON posts(id) WHERE status = 'published';

-- Trigger to maintain search_vector
CREATE OR REPLACE FUNCTION posts_search_trigger() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.content, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tsvector_update ON posts;
CREATE TRIGGER tsvector_update
  BEFORE INSERT OR UPDATE ON posts
  FOR EACH ROW EXECUTE PROCEDURE posts_search_trigger();

-- Backfill existing rows (for init)
UPDATE posts SET search_vector = setweight(to_tsvector('english', COALESCE(title, '')), 'A') || setweight(to_tsvector('english', COALESCE(content, '')), 'B') WHERE search_vector IS NULL;

-- Post revisions table
CREATE TABLE IF NOT EXISTS post_revisions (
  id SERIAL PRIMARY KEY,
  post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  title_snapshot VARCHAR(500) NOT NULL,
  content_snapshot TEXT NOT NULL DEFAULT '',
  revision_author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_post_revisions_post_id ON post_revisions(post_id);
CREATE INDEX IF NOT EXISTS idx_post_revisions_timestamp ON post_revisions(revision_timestamp DESC);
