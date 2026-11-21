CREATE TABLE boards_multiple (
 id INTEGER PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name TEXT NOT NULL DEFAULT 'My board' CHECK (length(trim(name)) BETWEEN 1 AND 100),
 board_json TEXT NOT NULL CHECK (json_valid(board_json)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
INSERT INTO boards_multiple (id, user_id, board_json, revision)
 SELECT id, user_id, board_json, revision FROM boards;
DROP TABLE boards;
ALTER TABLE boards_multiple RENAME TO boards;
CREATE INDEX boards_owner_id ON boards (user_id, id);
