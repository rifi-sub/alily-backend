import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Request, Response } from 'express';

const router = express.Router();

interface FailRecord {
  count: number;
  blockedUntil?: number;
}

const fails = new Map<string, FailRecord>();
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60 * 1000; // 15 minutes

function getIp(req: Request) {
  return req.ip || (req.headers['x-forwarded-for'] as string) || req.connection.remoteAddress || 'unknown';
}

router.post('/login', (req: Request, res: Response) => {
  try {
    const ip = getIp(req);
    const rec = fails.get(ip) || { count: 0 };
    if (rec.blockedUntil && Date.now() < rec.blockedUntil) {
      return res.status(429).json({ error: 'Too many attempts. Try later.' });
    }

    const { password } = req.body || {};
    if (typeof password !== 'string') {
      return res.status(400).json({ error: 'Invalid request' });
    }

    const envPass = process.env.ADMIN_PASSWORD || '';
    const hashA = crypto.createHash('sha256').update(password).digest();
    const hashB = crypto.createHash('sha256').update(envPass).digest();

    let ok = false;
    if (hashA.length === hashB.length) {
      ok = crypto.timingSafeEqual(hashA, hashB);
    }

    if (!ok) {
      rec.count = (rec.count || 0) + 1;
      if (rec.count >= MAX_FAILS) {
        rec.blockedUntil = Date.now() + BLOCK_MS;
      }
      fails.set(ip, rec);
      return res.status(401).json({ error: 'Invalid password' });
    }

    // reset on success
    fails.delete(ip);

    const secret = process.env.JWT_SECRET;
    if (!secret) return res.status(500).json({ error: 'Server misconfiguration' });

    const token = jwt.sign({ admin: true }, secret, { expiresIn: '30d' });
    return res.json({ token });
  } catch (err) {
    return res.status(500).json({ error: 'Server error' });
  }
});

import adminOnly from '../middleware/adminOnly';

router.get('/verify', adminOnly, (_req: Request, res: Response) => {
  return res.json({ admin: true, ok: true });
});

export default router;
