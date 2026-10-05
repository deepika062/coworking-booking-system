import { Router } from 'express';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import * as auth from '../services/authService.js';
import { loginBody, registerBody } from '../validators.js';

const router = Router();

// The refresh token lives in an httpOnly cookie scoped to /api/auth: JavaScript can't read it
// (XSS can't steal it) and the browser only sends it to the auth endpoints.
const REFRESH_COOKIE = 'refreshToken';
const cookieOptions = {
  httpOnly: true,
  secure: config.cookieSecure,
  sameSite: 'strict',
  path: '/api/auth',
};

function sendSession(res, status, { user, accessToken, refreshToken, refreshTokenExpiresAt }) {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions, expires: refreshTokenExpiresAt });
  res.status(status).json({ data: { user, accessToken, accessTokenExpiresIn: config.jwt.accessTtl } });
}

router.post('/register', authLimiter, validate({ body: registerBody }), async (req, res) => {
  sendSession(res, 201, await auth.register(req.valid.body));
});

router.post('/login', authLimiter, validate({ body: loginBody }), async (req, res) => {
  sendSession(res, 200, await auth.login(req.valid.body));
});

router.post('/refresh', async (req, res) => {
  try {
    sendSession(res, 200, await auth.refresh(req.cookies?.[REFRESH_COOKIE]));
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    throw err;
  }
});

router.post('/logout', async (req, res) => {
  await auth.logout(req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
  res.status(204).end();
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ data: await auth.getUser(req.user.id) });
});

export default router;
