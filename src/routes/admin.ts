import express from 'express';
import crypto from 'crypto';
import adminOnly from '../middleware/adminOnly';
import { supabase } from '../lib/supabase';

const router = express.Router();

router.use(adminOnly);

type AuthUser = {
  id: string;
  email?: string | null;
  created_at?: string;
  last_sign_in_at?: string | null;
};

type ItemRow = {
  id: string;
  title: string;
  price: number | string;
  image_url?: string | null;
  status?: string;
};

type ProfileRow = {
  id: string;
  voucher_balance: number | string | null;
  created_at?: string;
};

type VoucherRow = {
  id: string;
  code: string;
  amount: number | string;
  used: boolean | null;
  user_id?: string | null;
  created_at?: string;
};

type OrderRow = {
  id: string;
  user_id: string | null;
  item_id: string | null;
  amount: number | string;
  status: string;
  items?: Array<{ name?: string; productId?: string; quantity?: number }> | null;
  created_at?: string;
};

type GuestOrderRow = {
  id: string;
  order_code: string;
  customer_email: string;
  customer_name?: string | null;
  items?: Array<{ name?: string; productId?: string; quantity?: number }> | null;
  total_amount: number | string;
  status: string;
  created_at?: string;
};

type EnrichedOrder = OrderRow & {
  user_email: string;
  item_title: string;
  item_image_url: string;
  order_code?: string;
  source?: 'registered' | 'guest';
  customer_name?: string;
};

function isGuestOrdersMissingTableError(err: unknown) {
  const anyErr = err as { code?: string; message?: string } | null;
  if (!anyErr) return false;

  // Postgres undefined_table
  if (anyErr.code === '42P01') return true;

  const message = (anyErr.message || '').toLowerCase();
  return message.includes('guest_orders') && (message.includes('does not exist') || message.includes('not found'));
}

const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;

function toNumber(value: number | string | null | undefined) {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? num : 0;
}

function getStoragePath(imageUrl: string) {
  if (!imageUrl) return '';

  try {
    const url = new URL(imageUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch {
    const parts = imageUrl.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  }
}

async function listAllAuthUsers(): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);

    const pageUsers = (data as any)?.users || [];
    users.push(...pageUsers);

    if (pageUsers.length < perPage) break;
    page += 1;
  }

  return users;
}

async function getItemsMap(ids: string[]) {
  if (ids.length === 0) return new Map<string, ItemRow>();

  const { data, error } = await supabase
    .from('items')
    .select('id, title, price, image_url, status')
    .in('id', ids);

  if (error) throw new Error(error.message);

  return new Map<string, ItemRow>((data || []).map((item: ItemRow) => [item.id, item]));
}

async function decorateOrders(rows: OrderRow[]): Promise<EnrichedOrder[]> {
  const users = await listAllAuthUsers();
  const itemsMap = await getItemsMap([...new Set(rows.map((row) => row.item_id).filter((id): id is string => !!id))]);
  const usersMap = new Map<string, AuthUser>(users.map((user) => [user.id, user]));

  return rows.map((row) => {
    const user = row.user_id ? usersMap.get(row.user_id) : null;
    const item = row.item_id ? itemsMap.get(row.item_id) : null;
    const firstItemName = Array.isArray(row.items) ? row.items.find((entry) => !!entry?.name)?.name : undefined;
    const itemCount = Array.isArray(row.items) ? row.items.length : 0;
    const fallbackTitle = firstItemName || (itemCount > 1 ? `${itemCount} items` : itemCount === 1 ? '1 item' : 'Unknown item');

    return {
      ...row,
      amount: toNumber(row.amount),
      user_email: user?.email || 'Unknown user',
      item_title: item?.title || fallbackTitle,
      item_image_url: item?.image_url || '',
      order_code: `REG-${row.id.slice(0, 8).toUpperCase()}`,
      source: 'registered',
    };
  });
}

function decorateGuestOrders(rows: GuestOrderRow[]): EnrichedOrder[] {
  return rows.map((row) => {
    const firstItemName = Array.isArray(row.items) ? row.items.find((entry) => !!entry?.name)?.name : undefined;
    const itemCount = Array.isArray(row.items) ? row.items.length : 0;
    const fallbackTitle = firstItemName || (itemCount > 1 ? `${itemCount} items` : itemCount === 1 ? '1 item' : 'Unknown item');

    return {
      id: row.id,
      user_id: null,
      item_id: null,
      amount: toNumber(row.total_amount),
      status: row.status,
      created_at: row.created_at,
      user_email: row.customer_email,
      item_title: fallbackTitle,
      item_image_url: '',
      order_code: row.order_code,
      source: 'guest',
      customer_name: row.customer_name || '',
    };
  });
}

router.get('/users', async (_req, res) => {
  try {
    const users = await listAllAuthUsers();
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('id, voucher_balance')
      .in('id', users.map((user) => user.id));

    if (error) return res.status(500).json({ error: error.message });

    const profileMap = new Map<string, ProfileRow>((profiles || []).map((profile: ProfileRow) => [profile.id, profile]));

    return res.json(users.map((user) => ({
      id: user.id,
      email: user.email || '',
      created_at: user.created_at || '',
      last_sign_in_at: user.last_sign_in_at || null,
      voucher_balance: toNumber(profileMap.get(user.id)?.voucher_balance),
    })));
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: authUser, error: userError } = await supabase.auth.admin.getUserById(id);
    if (userError || !authUser?.user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [profileRes, vouchersRes, ordersRes] = await Promise.all([
      supabase.from('profiles').select('id, voucher_balance, created_at').eq('id', id).maybeSingle(),
      supabase.from('vouchers').select('id, code, amount, used, user_id, created_at').eq('user_id', id).order('created_at', { ascending: false }),
      supabase.from('orders').select('id, user_id, item_id, amount, status, items, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    ]);

    if (profileRes.error) return res.status(500).json({ error: profileRes.error.message });
    if (vouchersRes.error) return res.status(500).json({ error: vouchersRes.error.message });
    if (ordersRes.error) return res.status(500).json({ error: ordersRes.error.message });

    const orders = await decorateOrders((ordersRes.data || []) as OrderRow[]);

    return res.json({
      id: authUser.user.id,
      email: authUser.user.email || '',
      created_at: authUser.user.created_at || '',
      last_sign_in_at: authUser.user.last_sign_in_at || null,
      voucher_balance: toNumber(profileRes.data?.voucher_balance),
      profile: profileRes.data || null,
      vouchers: (vouchersRes.data || []).map((voucher: VoucherRow) => ({ ...voucher, amount: toNumber(voucher.amount) })),
      orders,
    });
  } catch (err: any) {
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

    const { data, error } = await supabase
      .from('profiles')
      .upsert({ id, voucher_balance: balance }, { onConflict: 'id' })
      .select('id, voucher_balance, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.json({
      id: data.id,
      voucher_balance: toNumber(data.voucher_balance),
      created_at: data.created_at,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [ordersUpdate, vouchersDelete, profileDelete, authDelete] = await Promise.all([
      supabase.from('orders').update({ user_id: null }).eq('user_id', id),
      supabase.from('vouchers').delete().eq('user_id', id),
      supabase.from('profiles').delete().eq('id', id),
      supabase.auth.admin.deleteUser(id),
    ]);

    if (ordersUpdate.error) return res.status(500).json({ error: ordersUpdate.error.message });
    if (vouchersDelete.error) return res.status(500).json({ error: vouchersDelete.error.message });
    if (profileDelete.error) return res.status(500).json({ error: profileDelete.error.message });
    if (authDelete.error) return res.status(500).json({ error: authDelete.error.message });

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.get('/orders', async (_req, res) => {
  try {
    const [ordersRes, guestOrdersRes] = await Promise.all([
      supabase
        .from('orders')
        .select('id, user_id, item_id, amount, status, items, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('guest_orders')
        .select('id, order_code, customer_email, customer_name, items, total_amount, status, created_at')
        .order('created_at', { ascending: false }),
    ]);

    if (ordersRes.error) return res.status(500).json({ error: ordersRes.error.message });
    if (guestOrdersRes.error && !isGuestOrdersMissingTableError(guestOrdersRes.error)) {
      return res.status(500).json({ error: guestOrdersRes.error.message });
    }

    const registered = await decorateOrders((ordersRes.data || []) as OrderRow[]);
    const guest = guestOrdersRes.error ? [] : decorateGuestOrders((guestOrdersRes.data || []) as GuestOrderRow[]);

    const merged = [...registered, ...guest].sort((a, b) => {
      const dateA = new Date(a.created_at || '').getTime() || 0;
      const dateB = new Date(b.created_at || '').getTime() || 0;
      return dateB - dateA;
    });

    return res.json(merged);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.patch('/orders/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, source } = req.body || {};

    if (typeof status !== 'string' || !ORDER_STATUSES.includes(status as typeof ORDER_STATUSES[number])) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (source === 'guest') {
      const { data, error } = await supabase
        .from('guest_orders')
        .update({ status })
        .eq('id', id)
        .select('id, order_code, customer_email, customer_name, items, total_amount, status, created_at')
        .single();

      if (error) return res.status(500).json({ error: error.message });

      const [order] = decorateGuestOrders([data as GuestOrderRow]);
      return res.json(order);
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', id)
      .select('id, user_id, item_id, amount, status, items, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    const [order] = await decorateOrders([data as OrderRow]);
    return res.json(order);
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.get('/vouchers', async (_req, res) => {
  try {
    const [vouchersRes, users] = await Promise.all([
      supabase.from('vouchers').select('id, code, amount, used, user_id, created_at').order('created_at', { ascending: false }),
      listAllAuthUsers(),
    ]);

    if (vouchersRes.error) return res.status(500).json({ error: vouchersRes.error.message });

    const userMap = new Map(users.map((user) => [user.id, user]));
    return res.json((vouchersRes.data || []).map((voucher: VoucherRow) => ({
      ...voucher,
      amount: toNumber(voucher.amount),
      user_email: voucher.user_id ? (userMap.get(voucher.user_id)?.email || 'Unknown user') : '',
    })));
  } catch (err: any) {
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

    const exists = async (code: string) => {
      const { data, error } = await supabase.from('vouchers').select('id').eq('code', code).maybeSingle();
      if (error && error.code !== 'PGRST116') throw new Error(error.message);
      return !!data;
    };

    let code = '';
    for (let i = 0; i < 10; i += 1) {
      const candidate = crypto.randomBytes(4).toString('hex').toUpperCase();
      if (!(await exists(candidate))) {
        code = candidate;
        break;
      }
    }

    if (!code) {
      return res.status(500).json({ error: 'Failed to generate unique code' });
    }

    const payload: Record<string, unknown> = {
      code,
      amount: parsedAmount,
      used: false,
    };

    if (typeof userId === 'string' && userId) {
      payload.user_id = userId;
    }

    const { data, error } = await supabase
      .from('vouchers')
      .insert([payload])
      .select('id, code, amount, used, user_id, created_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    if (typeof userId === 'string' && userId) {
      const { data: profile } = await supabase.from('profiles').select('voucher_balance').eq('id', userId).maybeSingle();
      const currentBalance = toNumber(profile?.voucher_balance);
      const { error: profileError } = await supabase.from('profiles').upsert({ id: userId, voucher_balance: currentBalance + parsedAmount }, { onConflict: 'id' });
      if (profileError) {
        await supabase.from('vouchers').delete().eq('id', data.id);
        return res.status(500).json({ error: profileError.message });
      }
    }

    return res.status(201).json({ code: data.code, amount: toNumber(data.amount) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.delete('/vouchers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.from('vouchers').delete().eq('id', id);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.get('/stats', async (_req, res) => {
  try {
    const [itemsRes, vouchersRes, ordersRes, guestOrdersRes, users, recentOrdersRes, recentGuestOrdersRes] = await Promise.all([
      supabase.from('items').select('id, status'),
      supabase.from('vouchers').select('id, amount, used').eq('used', false),
      supabase.from('orders').select('id, user_id, item_id, amount, status, items, created_at'),
      supabase.from('guest_orders').select('id, order_code, customer_email, customer_name, items, total_amount, status, created_at'),
      listAllAuthUsers(),
      supabase.from('orders').select('id, user_id, item_id, amount, status, items, created_at').order('created_at', { ascending: false }).limit(5),
      supabase.from('guest_orders').select('id, order_code, customer_email, customer_name, items, total_amount, status, created_at').order('created_at', { ascending: false }).limit(5),
    ]);

    if (itemsRes.error) return res.status(500).json({ error: itemsRes.error.message });
    if (vouchersRes.error) return res.status(500).json({ error: vouchersRes.error.message });
    if (ordersRes.error) return res.status(500).json({ error: ordersRes.error.message });
    if (guestOrdersRes.error && !isGuestOrdersMissingTableError(guestOrdersRes.error)) {
      return res.status(500).json({ error: guestOrdersRes.error.message });
    }
    if (recentOrdersRes.error) return res.status(500).json({ error: recentOrdersRes.error.message });
    if (recentGuestOrdersRes.error && !isGuestOrdersMissingTableError(recentGuestOrdersRes.error)) {
      return res.status(500).json({ error: recentGuestOrdersRes.error.message });
    }

    const items = itemsRes.data || [];
    const vouchers = vouchersRes.data || [];
    const orders = (ordersRes.data || []) as OrderRow[];
    const guestOrders = guestOrdersRes.error ? [] : ((guestOrdersRes.data || []) as GuestOrderRow[]);

    const recentRegisteredOrders = await decorateOrders((recentOrdersRes.data || []) as OrderRow[]);
    const recentGuestOrders = recentGuestOrdersRes.error
      ? []
      : decorateGuestOrders((recentGuestOrdersRes.data || []) as GuestOrderRow[]);
    const recentOrders = [...recentRegisteredOrders, ...recentGuestOrders]
      .sort((a, b) => {
        const dateA = new Date(a.created_at || '').getTime() || 0;
        const dateB = new Date(b.created_at || '').getTime() || 0;
        return dateB - dateA;
      })
      .slice(0, 5);

    return res.json({
      totalItems: items.length,
      availableItems: items.filter((item: { status?: string }) => item.status === 'available').length,
      soldItems: items.filter((item: { status?: string }) => item.status === 'sold').length,
      totalUsers: users.length,
      totalVouchers: vouchers.length,
      totalVoucherValue: vouchers.reduce((sum: number, voucher: VoucherRow) => sum + toNumber(voucher.amount), 0),
      recentOrders,
      pendingOrders:
        orders.filter((order: OrderRow) => order.status === 'pending').length +
        guestOrders.filter((order: GuestOrderRow) => order.status === 'pending').length,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

router.delete('/items/sold', async (_req, res) => {
  try {
    const { data: soldItems, error } = await supabase.from('items').select('id, image_url').eq('status', 'sold');
    if (error) return res.status(500).json({ error: error.message });

    for (const item of soldItems || []) {
      const filename = getStoragePath(item.image_url || '');
      if (filename) {
        const { error: removeError } = await supabase.storage.from('items').remove([filename]);
        if (removeError) return res.status(500).json({ error: removeError.message });
      }
    }

    const { error: deleteError } = await supabase.from('items').delete().eq('status', 'sold');
    if (deleteError) return res.status(500).json({ error: deleteError.message });

    return res.json({ success: true, deleted: soldItems?.length || 0 });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

export default router;