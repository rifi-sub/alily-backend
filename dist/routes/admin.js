"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const crypto_1 = __importDefault(require("crypto"));
const adminOnly_1 = __importDefault(require("../middleware/adminOnly"));
const supabase_1 = require("../lib/supabase");
const router = express_1.default.Router();
router.use(adminOnly_1.default);
const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
function toNumber(value) {
    const num = Number(value ?? 0);
    return Number.isFinite(num) ? num : 0;
}
function getStoragePath(imageUrl) {
    if (!imageUrl)
        return '';
    try {
        const url = new URL(imageUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        return parts[parts.length - 1] || '';
    }
    catch {
        const parts = imageUrl.split('/').filter(Boolean);
        return parts[parts.length - 1] || '';
    }
}
async function listAllAuthUsers() {
    const users = [];
    let page = 1;
    const perPage = 100;
    while (true) {
        const { data, error } = await supabase_1.supabase.auth.admin.listUsers({ page, perPage });
        if (error)
            throw new Error(error.message);
        const pageUsers = data?.users || [];
        users.push(...pageUsers);
        if (pageUsers.length < perPage)
            break;
        page += 1;
    }
    return users;
}
async function getItemsMap(ids) {
    if (ids.length === 0)
        return new Map();
    const { data, error } = await supabase_1.supabase
        .from('items')
        .select('id, title, price, image_url, status')
        .in('id', ids);
    if (error)
        throw new Error(error.message);
    return new Map((data || []).map((item) => [item.id, item]));
}
async function decorateOrders(rows) {
    const users = await listAllAuthUsers();
    const itemsMap = await getItemsMap([...new Set(rows.map((row) => row.item_id).filter((id) => !!id))]);
    const usersMap = new Map(users.map((user) => [user.id, user]));
    return rows.map((row) => {
        const user = row.user_id ? usersMap.get(row.user_id) : null;
        const item = row.item_id ? itemsMap.get(row.item_id) : null;
        return {
            ...row,
            amount: toNumber(row.amount),
            user_email: user?.email || 'Unknown user',
            item_title: item?.title || 'Unknown item',
            item_image_url: item?.image_url || '',
        };
    });
}
router.get('/users', async (_req, res) => {
    try {
        const users = await listAllAuthUsers();
        const { data: profiles, error } = await supabase_1.supabase
            .from('profiles')
            .select('id, voucher_balance')
            .in('id', users.map((user) => user.id));
        if (error)
            return res.status(500).json({ error: error.message });
        const profileMap = new Map((profiles || []).map((profile) => [profile.id, profile]));
        return res.json(users.map((user) => ({
            id: user.id,
            email: user.email || '',
            created_at: user.created_at || '',
            last_sign_in_at: user.last_sign_in_at || null,
            voucher_balance: toNumber(profileMap.get(user.id)?.voucher_balance),
        })));
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data: authUser, error: userError } = await supabase_1.supabase.auth.admin.getUserById(id);
        if (userError || !authUser?.user) {
            return res.status(404).json({ error: 'User not found' });
        }
        const [profileRes, vouchersRes, ordersRes] = await Promise.all([
            supabase_1.supabase.from('profiles').select('id, voucher_balance, created_at').eq('id', id).maybeSingle(),
            supabase_1.supabase.from('vouchers').select('id, code, amount, used, user_id, created_at').eq('user_id', id).order('created_at', { ascending: false }),
            supabase_1.supabase.from('orders').select('id, user_id, item_id, amount, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
        ]);
        if (profileRes.error)
            return res.status(500).json({ error: profileRes.error.message });
        if (vouchersRes.error)
            return res.status(500).json({ error: vouchersRes.error.message });
        if (ordersRes.error)
            return res.status(500).json({ error: ordersRes.error.message });
        const orders = await decorateOrders((ordersRes.data || []));
        return res.json({
            id: authUser.user.id,
            email: authUser.user.email || '',
            created_at: authUser.user.created_at || '',
            last_sign_in_at: authUser.user.last_sign_in_at || null,
            voucher_balance: toNumber(profileRes.data?.voucher_balance),
            profile: profileRes.data || null,
            vouchers: (vouchersRes.data || []).map((voucher) => ({ ...voucher, amount: toNumber(voucher.amount) })),
            orders,
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.patch('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { voucher_balance } = req.body || {};
        if (voucher_balance === undefined) {
            return res.status(400).json({ error: 'voucher_balance is required' });
        }
        const balance = Number(voucher_balance);
        if (!Number.isFinite(balance) || balance < 0) {
            return res.status(400).json({ error: 'Invalid voucher balance' });
        }
        const { data, error } = await supabase_1.supabase
            .from('profiles')
            .upsert({ id, voucher_balance: balance }, { onConflict: 'id' })
            .select('id, voucher_balance, created_at')
            .single();
        if (error)
            return res.status(500).json({ error: error.message });
        return res.json({
            id: data.id,
            voucher_balance: toNumber(data.voucher_balance),
            created_at: data.created_at,
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.delete('/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const [ordersUpdate, vouchersDelete, profileDelete, authDelete] = await Promise.all([
            supabase_1.supabase.from('orders').update({ user_id: null }).eq('user_id', id),
            supabase_1.supabase.from('vouchers').delete().eq('user_id', id),
            supabase_1.supabase.from('profiles').delete().eq('id', id),
            supabase_1.supabase.auth.admin.deleteUser(id),
        ]);
        if (ordersUpdate.error)
            return res.status(500).json({ error: ordersUpdate.error.message });
        if (vouchersDelete.error)
            return res.status(500).json({ error: vouchersDelete.error.message });
        if (profileDelete.error)
            return res.status(500).json({ error: profileDelete.error.message });
        if (authDelete.error)
            return res.status(500).json({ error: authDelete.error.message });
        return res.json({ success: true });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.get('/orders', async (_req, res) => {
    try {
        const { data, error } = await supabase_1.supabase
            .from('orders')
            .select('id, user_id, item_id, amount, status, created_at')
            .order('created_at', { ascending: false });
        if (error)
            return res.status(500).json({ error: error.message });
        return res.json(await decorateOrders((data || [])));
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.patch('/orders/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body || {};
        if (typeof status !== 'string' || !ORDER_STATUSES.includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        const { data, error } = await supabase_1.supabase
            .from('orders')
            .update({ status })
            .eq('id', id)
            .select('id, user_id, item_id, amount, status, created_at')
            .single();
        if (error)
            return res.status(500).json({ error: error.message });
        const [order] = await decorateOrders([data]);
        return res.json(order);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.get('/vouchers', async (_req, res) => {
    try {
        const [vouchersRes, users] = await Promise.all([
            supabase_1.supabase.from('vouchers').select('id, code, amount, used, user_id, created_at').order('created_at', { ascending: false }),
            listAllAuthUsers(),
        ]);
        if (vouchersRes.error)
            return res.status(500).json({ error: vouchersRes.error.message });
        const userMap = new Map(users.map((user) => [user.id, user]));
        return res.json((vouchersRes.data || []).map((voucher) => ({
            ...voucher,
            amount: toNumber(voucher.amount),
            user_email: voucher.user_id ? (userMap.get(voucher.user_id)?.email || 'Unknown user') : '',
        })));
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.post('/vouchers/generate', async (req, res) => {
    try {
        const { amount, userId } = req.body || {};
        const parsedAmount = Number(amount);
        if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: 'Invalid amount' });
        }
        const exists = async (code) => {
            const { data, error } = await supabase_1.supabase.from('vouchers').select('id').eq('code', code).maybeSingle();
            if (error && error.code !== 'PGRST116')
                throw new Error(error.message);
            return !!data;
        };
        let code = '';
        for (let i = 0; i < 10; i += 1) {
            const candidate = crypto_1.default.randomBytes(4).toString('hex').toUpperCase();
            if (!(await exists(candidate))) {
                code = candidate;
                break;
            }
        }
        if (!code) {
            return res.status(500).json({ error: 'Failed to generate unique code' });
        }
        const payload = {
            code,
            amount: parsedAmount,
            used: false,
        };
        if (typeof userId === 'string' && userId) {
            payload.user_id = userId;
        }
        const { data, error } = await supabase_1.supabase
            .from('vouchers')
            .insert([payload])
            .select('id, code, amount, used, user_id, created_at')
            .single();
        if (error)
            return res.status(500).json({ error: error.message });
        if (typeof userId === 'string' && userId) {
            const { data: profile } = await supabase_1.supabase.from('profiles').select('voucher_balance').eq('id', userId).maybeSingle();
            const currentBalance = toNumber(profile?.voucher_balance);
            const { error: profileError } = await supabase_1.supabase.from('profiles').upsert({ id: userId, voucher_balance: currentBalance + parsedAmount }, { onConflict: 'id' });
            if (profileError) {
                await supabase_1.supabase.from('vouchers').delete().eq('id', data.id);
                return res.status(500).json({ error: profileError.message });
            }
        }
        return res.status(201).json({ code: data.code, amount: toNumber(data.amount) });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.delete('/vouchers/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { error } = await supabase_1.supabase.from('vouchers').delete().eq('id', id);
        if (error)
            return res.status(500).json({ error: error.message });
        return res.json({ success: true });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.get('/stats', async (_req, res) => {
    try {
        const [itemsRes, vouchersRes, ordersRes, users, recentOrdersRes] = await Promise.all([
            supabase_1.supabase.from('items').select('id, status'),
            supabase_1.supabase.from('vouchers').select('id, amount, used').eq('used', false),
            supabase_1.supabase.from('orders').select('id, user_id, item_id, amount, status, created_at'),
            listAllAuthUsers(),
            supabase_1.supabase.from('orders').select('id, user_id, item_id, amount, status, created_at').order('created_at', { ascending: false }).limit(5),
        ]);
        if (itemsRes.error)
            return res.status(500).json({ error: itemsRes.error.message });
        if (vouchersRes.error)
            return res.status(500).json({ error: vouchersRes.error.message });
        if (ordersRes.error)
            return res.status(500).json({ error: ordersRes.error.message });
        if (recentOrdersRes.error)
            return res.status(500).json({ error: recentOrdersRes.error.message });
        const items = itemsRes.data || [];
        const vouchers = vouchersRes.data || [];
        const orders = ordersRes.data || [];
        const recentOrders = await decorateOrders((recentOrdersRes.data || []));
        return res.json({
            totalItems: items.length,
            availableItems: items.filter((item) => item.status === 'available').length,
            soldItems: items.filter((item) => item.status === 'sold').length,
            totalUsers: users.length,
            totalVouchers: vouchers.length,
            totalVoucherValue: vouchers.reduce((sum, voucher) => sum + toNumber(voucher.amount), 0),
            recentOrders,
            pendingOrders: orders.filter((order) => order.status === 'pending').length,
        });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.delete('/items/sold', async (_req, res) => {
    try {
        const { data: soldItems, error } = await supabase_1.supabase.from('items').select('id, image_url').eq('status', 'sold');
        if (error)
            return res.status(500).json({ error: error.message });
        for (const item of soldItems || []) {
            const filename = getStoragePath(item.image_url || '');
            if (filename) {
                const { error: removeError } = await supabase_1.supabase.storage.from('items').remove([filename]);
                if (removeError)
                    return res.status(500).json({ error: removeError.message });
            }
        }
        const { error: deleteError } = await supabase_1.supabase.from('items').delete().eq('status', 'sold');
        if (deleteError)
            return res.status(500).json({ error: deleteError.message });
        return res.json({ success: true, deleted: soldItems?.length || 0 });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
exports.default = router;
