"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const supabase_1 = require("../lib/supabase");
const adminOnly_1 = __importDefault(require("../middleware/adminOnly"));
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
function hasAdminAccess(req, res) {
    let authorized = false;
    (0, adminOnly_1.default)(req, res, () => {
        authorized = true;
    });
    return authorized;
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
router.get('/', async (req, res) => {
    try {
        console.log('GET /api/items called');
        const all = req.query.all === 'true';
        if (all && !hasAdminAccess(req, res)) {
            return;
        }
        let query = supabase_1.supabase.from('items').select('*').order('created_at', { ascending: false });
        if (!all) {
            query = query.eq('status', 'available');
        }
        const { data, error } = await query;
        if (error) {
            console.error('Supabase error:', error);
            return res.status(500).json({ error: error.message });
        }
        console.log('Items retrieved:', data?.length);
        return res.json(data || []);
    }
    catch (err) {
        console.error('Exception in GET /api/items:', err);
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.patch('/:id', adminOnly_1.default, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = {};
        const { title, description, price, status } = req.body || {};
        if (typeof title === 'string' && title.trim())
            updates.title = title.trim();
        if (typeof description === 'string')
            updates.description = description;
        if (price !== undefined) {
            const priceNum = Number(price);
            if (Number.isNaN(priceNum) || priceNum <= 0) {
                return res.status(400).json({ error: 'Price must be a positive number' });
            }
            updates.price = priceNum;
        }
        if (typeof status === 'string') {
            if (!['available', 'sold'].includes(status)) {
                return res.status(400).json({ error: 'Invalid status' });
            }
            updates.status = status;
        }
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }
        const { data, error } = await supabase_1.supabase
            .from('items')
            .update(updates)
            .eq('id', id)
            .select('*')
            .single();
        if (error)
            return res.status(500).json({ error: error.message });
        return res.json(data);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { data, error } = await supabase_1.supabase
            .from('items')
            .select('*')
            .eq('id', id)
            .single();
        if (error)
            return res.status(404).json({ error: 'Item not found' });
        return res.json(data);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.post('/', adminOnly_1.default, upload.single('image'), async (req, res) => {
    try {
        const { title, description, price } = req.body;
        const file = req.file;
        if (!title || typeof title !== 'string')
            return res.status(400).json({ error: 'Title is required' });
        const priceNum = Number(price);
        if (Number.isNaN(priceNum) || priceNum <= 0)
            return res.status(400).json({ error: 'Price must be a positive number' });
        if (!file)
            return res.status(400).json({ error: 'Image is required' });
        const filename = `${Date.now()}-${file.originalname}`;
        const { error: uploadError } = await supabase_1.supabase.storage.from('items').upload(filename, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
        });
        if (uploadError)
            return res.status(500).json({ error: uploadError.message });
        const { data: publicData } = supabase_1.supabase.storage.from('items').getPublicUrl(filename);
        const image_url = publicData?.publicUrl || '';
        const insertRes = await supabase_1.supabase
            .from('items')
            .insert([{ title, description, price: priceNum, image_url, status: 'available' }])
            .select()
            .single();
        if (insertRes.error)
            return res.status(500).json({ error: insertRes.error.message });
        return res.status(201).json(insertRes.data);
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
router.delete('/:id', adminOnly_1.default, async (req, res) => {
    try {
        const { id } = req.params;
        const { data: item, error: fetchError } = await supabase_1.supabase.from('items').select('*').eq('id', id).single();
        if (fetchError) {
            return res.status(404).json({ error: 'Item not found' });
        }
        const filename = getStoragePath(item.image_url || '');
        if (filename) {
            const { error: deleteError } = await supabase_1.supabase.storage.from('items').remove([filename]);
            if (deleteError)
                return res.status(500).json({ error: deleteError.message });
        }
        const { error: delRowError } = await supabase_1.supabase.from('items').delete().eq('id', id);
        if (delRowError)
            return res.status(500).json({ error: delRowError.message });
        return res.json({ success: true });
    }
    catch (err) {
        return res.status(500).json({ error: err.message || 'Server error' });
    }
});
exports.default = router;
