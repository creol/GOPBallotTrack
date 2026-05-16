-- Migration 041: voter_tokens.token_last2 (Prompt H, stage H3)
--
-- The credentialing "recent activations" list shows each activated token
-- redacted to its last 2 characters. Tokens are stored only as HMAC hashes
-- (the plaintext cannot be derived back), so the 2-char suffix is captured
-- here at activation time. Disclosing 2 of 6 characters is negligible —
-- ~31^4 (≈ 920k) combinations remain — and the full token is never stored.
--
-- Null for tokens that have never been activated.

ALTER TABLE voter_tokens
  ADD COLUMN IF NOT EXISTS token_last2 VARCHAR(2);
