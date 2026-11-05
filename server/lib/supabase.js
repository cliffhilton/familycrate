import { createClient } from "@supabase/supabase-js";

const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// Privileged client: data access only. Never call signIn/refresh on this one.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, opts);

// Throwaway-session client for login, refresh and password reset.
export const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, opts);

export default supabase;
