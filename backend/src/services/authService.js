import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query, withTransaction } from '../db/pool.js';
import { AppError } from '../utils/AppError.js';

const BCRYPT_ROUNDS = 10;
// If a refresh token that was already rotated is presented again after this grace period,
// we treat it as stolen and revoke every session of that user (refresh-token reuse detection).
// The grace period tolerates harmless races such as two browser tabs refreshing together.
const REUSE_GRACE_SECONDS = 30;
// Used to make login take the same time whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', BCRYPT_ROUNDS);

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

function signAccessToken(user) {
  return jwt.sign({ role: user.role, name: user.name, email: user.email }, config.jwt.accessSecret, {
    subject: user.id,
    expiresIn: config.jwt.accessTtl,
    algorithm: 'HS256',
  });
}

/** Creates an access token (JWT, short-lived) + a refresh token (opaque, stored hashed). */
async function issueTokens(db, user) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
  await db.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    user.id,
    hashToken(refreshToken),
    expiresAt,
  ]);
  return {
    user: publicUser(user),
    accessToken: signAccessToken(user),
    refreshToken,
    refreshTokenExpiresAt: expiresAt,
  };
}

export async function register({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    const { rows } = await query(
      `INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3)
       RETURNING id, name, email, role`,
      [name, email, passwordHash],
    );
    return issueTokens({ query }, rows[0]);
  } catch (err) {
    if (err.code === '23505') throw AppError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
    throw err;
  }
}

export async function login({ email, password }) {
  const { rows } = await query('SELECT id, name, email, role, password_hash FROM users WHERE lower(email) = $1', [
    email,
  ]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw AppError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  return issueTokens({ query }, user);
}

/**
 * Refresh-token rotation: the presented token is revoked and a brand-new pair is issued.
 * Runs in a transaction with a row lock so the same token can't be redeemed twice in parallel.
 */
export async function refresh(refreshToken) {
  if (!refreshToken) throw AppError.unauthorized('Missing refresh token', 'INVALID_REFRESH_TOKEN');

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT rt.id, rt.user_id, rt.expires_at, rt.revoked_at,
              (rt.revoked_at < now() - make_interval(secs => $2)) AS reused,
              u.id AS uid, u.name, u.email, u.role
         FROM refresh_tokens rt
         JOIN users u ON u.id = rt.user_id
        WHERE rt.token_hash = $1
        FOR UPDATE OF rt`,
      [hashToken(refreshToken), REUSE_GRACE_SECONDS],
    );
    const row = rows[0];
    if (!row) return { error: 'invalid' };

    if (row.revoked_at) {
      if (row.reused) {
        await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
          row.user_id,
        ]);
        return { error: 'reused' };
      }
      return { error: 'invalid' };
    }
    if (row.expires_at <= new Date()) return { error: 'expired' };

    await client.query('UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1', [row.id]);
    return issueTokens(client, { id: row.uid, name: row.name, email: row.email, role: row.role });
  });

  // Errors are thrown after the transaction so that the reuse-revocation above is committed.
  if (result.error === 'reused') {
    throw AppError.unauthorized('Refresh token reuse detected; all sessions revoked', 'REFRESH_TOKEN_REUSED');
  }
  if (result.error === 'expired') throw AppError.unauthorized('Refresh token expired', 'REFRESH_TOKEN_EXPIRED');
  if (result.error) throw AppError.unauthorized('Invalid refresh token', 'INVALID_REFRESH_TOKEN');
  return result;
}

export async function logout(refreshToken) {
  if (!refreshToken) return;
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL', [
    hashToken(refreshToken),
  ]);
}

export async function getUser(id) {
  const { rows } = await query('SELECT id, name, email, role FROM users WHERE id = $1', [id]);
  if (!rows[0]) throw AppError.notFound('User not found');
  return rows[0];
}
