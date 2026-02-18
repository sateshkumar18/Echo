-- Run this on your Echo database. Adds users table and user_id to echo_sessions.
-- Production: set JWT secret via environment variable JWT_SECRET (min 32 chars) or config Auth:JwtSecret.

CREATE TABLE IF NOT EXISTS echo_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    display_name VARCHAR(128) NOT NULL DEFAULT '',
    email VARCHAR(256) NOT NULL UNIQUE,
    password_hash VARCHAR(256) NOT NULL,
    subscription_tier VARCHAR(32) NOT NULL DEFAULT 'free',
    created_at TIMESTAMP NOT NULL DEFAULT (NOW() AT TIME ZONE 'utc')
);

ALTER TABLE echo_users ADD COLUMN IF NOT EXISTS display_name VARCHAR(128) NOT NULL DEFAULT '';
ALTER TABLE echo_users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(32) NOT NULL DEFAULT 'free';

CREATE INDEX IF NOT EXISTS idx_echo_users_email ON echo_users(email);

ALTER TABLE echo_sessions ADD COLUMN IF NOT EXISTS user_id UUID NULL REFERENCES echo_users(id);
CREATE INDEX IF NOT EXISTS idx_echo_sessions_user_id ON echo_sessions(user_id);
