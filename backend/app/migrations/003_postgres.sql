ALTER TABLE boards DROP CONSTRAINT boards_user_id_key;
ALTER TABLE boards ADD COLUMN name TEXT NOT NULL DEFAULT 'My board'
 CHECK (length(trim(name)) BETWEEN 1 AND 100);
CREATE INDEX boards_owner_id ON boards (user_id, id);
