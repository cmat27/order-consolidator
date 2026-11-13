import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyWebhook } from '@/lib/verify-webhook';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const shopDomainHeader = req.headers.get('x-shopify-shop-domain');
  const rawBody = await req.text();

  if (!verifyShopifyWebhook(rawBody, hmac, process.env.SHOPIFY_API_SECRET!)) {
    return NextResponse.json({ error: 'Unauthorized HMAC' }, { status: 401 });
  }

  let shopDomain = shopDomainHeader;
  if (!shopDomain && rawBody) {
    try {
      const payload = JSON.parse(rawBody);
      shopDomain = payload?.myshopify_domain || payload?.domain || null;
    } catch {
      // Ignore parse error
    }
  }

  if (shopDomain) {
    await supabaseAdmin
      .from('shops')
      .update({
        is_active: false,
        subscription_status: 'CANCELLED',
        updated_at: new Date().toISOString(),
      })
      .eq('shop_domain', shopDomain);
  }

  return NextResponse.json(
    { received: true, topic: 'app/uninstalled' },
    { status: 200 }
  );
}
