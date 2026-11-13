import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyWebhook } from '@/lib/verify-webhook';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const shopDomain = req.headers.get('x-shopify-shop-domain');
  const rawBody = await req.text();

  if (!verifyShopifyWebhook(rawBody, hmac, process.env.SHOPIFY_API_SECRET!)) {
    return NextResponse.json({ error: 'Unauthorized HMAC' }, { status: 401 });
  }

  if (rawBody && shopDomain) {
    try {
      const payload = JSON.parse(rawBody);
      const subscription = payload?.app_subscription;
      if (subscription) {
        const subscriptionId =
          subscription.admin_graphql_api_id || String(subscription.id || '');
        const status = String(subscription.status || 'UNKNOWN').toUpperCase();

        await supabaseAdmin
          .from('shops')
          .update({
            subscription_id: subscriptionId || null,
            subscription_status: status,
            updated_at: new Date().toISOString(),
          })
          .eq('shop_domain', shopDomain);
      }
    } catch {
      // Ignore malformed payload
    }
  }

  return NextResponse.json(
    { received: true, topic: 'app_subscriptions/update' },
    { status: 200 }
  );
}
