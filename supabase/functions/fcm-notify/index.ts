import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { JWT } from 'https://esm.sh/google-auth-library@9'

serve(async (req) => {
  const now = new Date().toISOString();
  try {
    const payload = await req.json()
    const { record, type } = payload

    console.log(`[${now}] 🚀 Webhook Triggered. Event: ${type}, Command ID: ${record?.id}`);

    if (type !== 'INSERT' || record.status !== 'PENDING') {
      console.log(`[${now}] ⏩ Skipping. Status is ${record?.status}, Type is ${type}`);
      return new Response("Ignore: Not a new pending command", { status: 200 })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    console.log(`[${now}] 🔍 Looking for token for Device: ${record.device_id}`);
    const { data: stats, error: dbError } = await supabase
      .from('device_stats')
      .select('fcm_token')
      .eq('device_id', record.device_id)
      .not('fcm_token', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)

    if (dbError || !stats || stats.length === 0) {
      console.error(`[${now}] ❌ No token found for ${record.device_id}. Data:`, stats, "Error:", dbError);
      return new Response("Device has no registered FCM token", { status: 404 })
    }

    const token = stats[0].fcm_token
    console.log(`[${now}] ✅ Token found. Preparing FCM blast...`);

    const rawServiceAccount = Deno.env.get('FIREBASE_SERVICE_ACCOUNT')
    const serviceAccount = JSON.parse(rawServiceAccount ?? '{}')

    const jwt = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    const { token: gToken } = await jwt.getAccessToken()

    console.log(`[${now}] 📡 Sending FCM request to Google...`);
    const fcmResponse = await fetch(
      `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
      {
        method: 'POST',    
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${gToken}`,
        },
        body: JSON.stringify({
          message: {
            token: token,
            data: { trigger: "new_command", cmd_id: String(record.id) },
            android: { priority: "high" }
          },
        }),
      }
    )

    const result = await fcmResponse.json()
    if (fcmResponse.ok) {
       console.log(`[${now}] 🎯 SUCCESS: Push delivered to Google. Message ID: ${result.name}`);
    } else {
       console.error(`[${now}] 🧨 FCM ERROR:`, result);
    }

    return new Response(JSON.stringify(result), { status: fcmResponse.status })

  } catch (err) {
    console.error(`[${now}] 💀 FATAL CRASH:`, err.message);
    return new Response(err.message, { status: 500 })
  }
})