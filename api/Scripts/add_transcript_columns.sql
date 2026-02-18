-- Run in pgAdmin (echo database) if echo_sessions already exists and you added transcript/summary to the model.
-- Adds columns for AI worker output.

ALTER TABLE echo_sessions ADD COLUMN IF NOT EXISTS transcript TEXT NULL;
ALTER TABLE echo_sessions ADD COLUMN IF NOT EXISTS summary TEXT NULL;
ALTER TABLE echo_sessions ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP NULL;
ALTER TABLE echo_sessions ADD COLUMN IF NOT EXISTS error_message TEXT NULL;
