CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0)
);
CREATE TABLE IF NOT EXISTS boards (
 id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 board_json TEXT NOT NULL CHECK (json_valid(board_json)), revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
CREATE TABLE google_identities (
 issuer TEXT NOT NULL CHECK (issuer = 'https://accounts.google.com'),
 subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 255),
 user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 email TEXT, display_name TEXT, PRIMARY KEY (issuer, subject)
);
