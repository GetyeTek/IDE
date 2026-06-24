import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = 'https://ryaxynjczfwqyqvpmorl.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5YXh5bmpjemZ3cXlxdnBtb3JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE1NDkwMTEsImV4cCI6MjA5NzEyNTAxMX0.739vHhzkh4as9K4afPylbaMBsupGR_rFTgpATDYiWOY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);