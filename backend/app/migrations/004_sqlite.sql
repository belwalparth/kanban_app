ALTER TABLE google_identities ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1));
CREATE TABLE board_memberships (
 board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 joined_at INTEGER NOT NULL,
 PRIMARY KEY (board_id, user_id)
);
CREATE INDEX board_memberships_user ON board_memberships (user_id, board_id);
CREATE TABLE board_invitations (
 id INTEGER PRIMARY KEY,
 board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
 email TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 accepted_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
 accepted_at INTEGER
);
CREATE INDEX board_invitations_board ON board_invitations (board_id, email);
