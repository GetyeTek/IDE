import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = 'https://ryaxynjczfwqyqvpmorl.supabase.co';
// WARNING: Replace this string with your actual SUPABASE_ANON_KEY from the dashboard!
const supabaseAnonKey = 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);