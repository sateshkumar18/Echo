-- Run this in pgAdmin or psql if the echo_sessions table was not created by the API.
-- Make sure you are connected to the "echo" database.

CREATE TABLE IF NOT EXISTS echo_sessions (
    id UUID PRIMARY KEY,
    created_at TIMESTAMP NOT NULL,
    finished_at TIMESTAMP NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'Recording'
);

-- Optional: list tables to verify
-- \dt
