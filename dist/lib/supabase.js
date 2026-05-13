"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
console.log('Supabase init - URL:', SUPABASE_URL ? 'set' : 'NOT SET');
console.log('Supabase init - Key:', SUPABASE_SERVICE_KEY ? 'set' : 'NOT SET');
let supabaseClient = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
    console.log('Creating real Supabase client');
    supabaseClient = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}
else {
    console.warn('Supabase env vars missing, using stub');
    // Create a proper stub with all required method chains
    const createQueryBuilder = () => ({
        select: () => ({
            eq: () => ({ single: async () => ({ data: null, error: { message: 'Supabase not configured' } }), order: () => ({ data: null, error: { message: 'Supabase not configured' } }), async: async () => ({ data: null, error: { message: 'Supabase not configured' } }) }),
            order: () => ({ async: async () => ({ data: null, error: { message: 'Supabase not configured' } }) }),
            single: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
            async: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
        }),
    });
    const stub = {
        from: () => createQueryBuilder(),
        auth: {
            getUser: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
            getSession: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
            admin: {
                listUsers: async () => ({ data: { users: [] }, error: { message: 'Supabase not configured' } }),
                getUserById: async () => ({ data: { user: null }, error: { message: 'Supabase not configured' } }),
                deleteUser: async () => ({ data: null, error: { message: 'Supabase not configured' } }),
            },
            signOut: async () => ({ error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => { } } } }),
        },
        storage: {
            from: () => ({
                upload: async () => ({ error: { message: 'Supabase not configured' } }),
                getPublicUrl: () => ({ data: { publicUrl: '' } }),
                remove: async () => ({ error: { message: 'Supabase not configured' } }),
            }),
        },
    };
    supabaseClient = stub;
}
exports.supabase = supabaseClient;
exports.default = exports.supabase;
