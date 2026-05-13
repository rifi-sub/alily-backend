import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

console.log('Supabase init - URL:', SUPABASE_URL ? 'set' : 'NOT SET');
console.log('Supabase init - Key:', SUPABASE_SERVICE_KEY ? 'set' : 'NOT SET');

let supabaseClient: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  console.log('Creating real Supabase client');
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
} else {
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
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: { message: 'Supabase not configured' } }),
        getPublicUrl: () => ({ data: { publicUrl: '' } }),
        remove: async () => ({ error: { message: 'Supabase not configured' } }),
      }),
    },
  } as unknown as SupabaseClient;

  supabaseClient = stub;
}

export const supabase: any = supabaseClient as any;
export default supabase;
