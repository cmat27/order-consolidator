import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyWebhook } from '@/lib/verify-webhook';
import { Client } from '@upstash/qstash';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const shopDomain = req.headers.get('x-shopify-shop-domain');
  const rawBody = await req.text();

  if (!verifyShopifyWebhook(rawBody, hmac, process.env.SHOPIFY_API_SECRET!)) {
    return NextResponse.json({ error: 'Unauthorized HMAC' }, { status: 401 });
  }

  const order = JSON.parse(rawBody);

  // Retrieve merchant configuration for debounce window
  const { data: shop } = await supabaseAdmin
    .from('shops')
    .select('id, app_settings(merge_window_minutes)')
    .eq('shop_domain', shopDomain)
    .single();

  const settings = Array.isArray(shop?.app_settings)
    ? shop?.app_settings[0]
    : shop?.app_settings;
  const delayMinutes = settings?.merge_window_minutes || 360;

  // Enqueue delayed evaluation job via QStash
  const qstash = new Client({
    token: process.env.QSTASH_TOKEN!,
    ...(process.env.QSTASH_URL ? { baseUrl: process.env.QSTASH_URL } : {}),
  });
  const configuredUrl = process.env.SHOPIFY_APP_URL;
  const hostHeader =
    req.headers.get('x-forwarded-host') || req.headers.get('host');
  const requestOrigin = hostHeader
    ? `${req.headers.get('x-forwarded-proto') || 'https'}://${hostHeader}`
    : new URL(req.url).origin;
  const appUrl = (
    configuredUrl && !configuredUrl.includes('example.com')
      ? configuredUrl
      : requestOrigin
  ).replace(/\/$/, '');
  const workerUrl = `${appUrl}/api/workers/consolidate`;

  const payload = {
    shopDomain,
    orderId: order.admin_graphql_api_id || `gid://shopify/Order/${order.id}`,
    customerId: order.customer?.id,
    customerEmail: order.email || order.customer?.email,
    shippingAddress: order.shipping_address,
    currency: order.currency,
    totalShipping:
      order.total_shipping_price_set?.shop_money?.amount || '0.00',
  };

  try {
    const res = await qstash.publishJSON({
      url: workerUrl,
      body: payload,
      delay: delayMinutes * 60, // Delay in seconds
      deduplicationId: `consolidate-${shopDomain}-${order.id}`,
    });

    return NextResponse.json(
      { received: true, queued: true, messageId: res.messageId },
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // In local dev without a public tunnel, QStash rejects localhost destination URLs
    if (
      workerUrl.includes('localhost') ||
      workerUrl.includes('127.0.0.1')
    ) {
      return NextResponse.json(
        {
          received: true,
          queued: false,
          delayMinutes,
          reason:
            'QStash cannot deliver to localhost; set SHOPIFY_APP_URL to a public tunnel (e.g. ngrok) for live queue delivery.',
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to enqueue QStash job', details: message },
      { status: 502 }
    );
  }
}
