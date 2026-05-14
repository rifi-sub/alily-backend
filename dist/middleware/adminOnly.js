"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = adminOnly;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function adminOnly(req, res, next) {
    try {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = auth.slice(7);
        const secret = process.env.JWT_SECRET;
        if (!secret)
            return res.status(500).json({ error: 'Server misconfiguration' });
        const payload = jsonwebtoken_1.default.verify(token, secret);
        if (payload && payload.admin === true) {
            return next();
        }
        return res.status(401).json({ error: 'Unauthorized' });
    }
    catch (err) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
}
//# sourceMappingURL=adminOnly.js.map