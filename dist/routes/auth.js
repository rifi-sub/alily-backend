"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const crypto_1 = __importDefault(require("crypto"));
const router = express_1.default.Router();
const fails = new Map();
const MAX_FAILS = 5;
const BLOCK_MS = 15 * 60 * 1000; // 15 minutes
function getIp(req) {
    return req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown';
}
router.post('/login', (req, res) => {
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
        const hashA = crypto_1.default.createHash('sha256').update(password).digest();
        const hashB = crypto_1.default.createHash('sha256').update(envPass).digest();
        let ok = false;
        if (hashA.length === hashB.length) {
            ok = crypto_1.default.timingSafeEqual(hashA, hashB);
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
        if (!secret)
            return res.status(500).json({ error: 'Server misconfiguration' });
        const token = jsonwebtoken_1.default.sign({ admin: true }, secret, { expiresIn: '30d' });
        return res.json({ token });
    }
    catch (err) {
        return res.status(500).json({ error: 'Server error' });
    }
});
const adminOnly_1 = __importDefault(require("../middleware/adminOnly"));
router.get('/verify', adminOnly_1.default, (_req, res) => {
    return res.json({ admin: true, ok: true });
});
exports.default = router;
