CREATE TABLE oauth_login_states (
    state_hash TEXT PRIMARY KEY,
    browser_binding_hash TEXT NOT NULL,
    nonce TEXT NOT NULL,
    code_verifier TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
