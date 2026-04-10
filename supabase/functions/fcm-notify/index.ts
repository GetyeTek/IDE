import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { JWT } from 'https://esm.sh/google-auth-library@9'

serve(async (req) => {
  try {
    const payload = await req.json()
    const { record } = payload // The new command from 'file_commands'
    
    // 1. Initialize Supabase
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // 2. Find the FCM Token for this device
    // We look at the latest device_stats entry for this device_id
    const { data: stats } = await supabase
      .from('device_stats')
      .select('fcm_token')
      .eq('device_id', record.device_id)
      .not('fcm_token', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)

    if (!stats || stats.length === 0) return new Response("No token found")
    const token = stats[0].fcm_token

    // 3. Load your Google Service Account Key (Stored in Supabase Secrets)
    const serviceAccount = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') ?? '{}')

    // 4. Get Google OAuth2 Access Token
    const jwt = new JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
    const { token: gToken } = await jwt.getAccessToken()

    // 5. Blast the FCM Push
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
            data: {
              trigger: "new_command" // This wakes up onMessageReceived
            }
          },
        }),
      }
    )

    return new Response(await fcmResponse.text())
  } catch (err) {
    return new Response(err.message, { status: 500 })
  }
})