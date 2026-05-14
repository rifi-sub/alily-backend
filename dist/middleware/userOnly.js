"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = userOnly;
const supabase_1 = require("../lib/supabase");
async function userOnly(req, res, next) {
    try {
        const auth = req.headers.authorization;
        if (!auth || !auth.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        const token = auth.slice(7);
        // Verify token with Supabase Auth
        const { data: { user }, error } = await supabase_1.supabase.auth.getUser(token);
        if (error || !user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        req.user = user;
        return next();
    }
    catch (err) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
}
//# sourceMappingURL=userOnly.js.map