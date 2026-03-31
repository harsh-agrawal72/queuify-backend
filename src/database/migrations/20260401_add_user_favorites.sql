-- Create user_favorites table to store bookmarked organizations
CREATE TABLE IF NOT EXISTS user_favorites (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, org_id)
);

-- Add index for performance on filtering by user
CREATE INDEX IF NOT EXISTS idx_user_favorites_user_id ON user_favorites(user_id);
