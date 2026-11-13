import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { shopifyGraphQL } from '@/lib/shopify';

const WEBHOOK_SUBSCRIPTION_CREATE = `
  mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id }
      userErrors { field message }
    }
  }
`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get('shop');
  const code = searchParams.get('code');
  const hmac = searchParams.get('hmac');
  const state = searchParams.get('state');

  if (!code || !hmac) {
    const targetShop = shop || 'cartsync-dev-store.myshopify.com';
    const appUrl = (
      process.env.SHOPIFY_APP_URL || new URL(req.url).origin
    ).replace(/\/$/, '');
    return NextResponse.redirect(
      `${appUrl}/api/auth?shop=${encodeURIComponent(targetShop)}`
    );
  }

  if (!shop) {
    return NextResponse.json(
      { error: 'Missing required shop query parameter' },
      { status: 400 }
    );
  }

  // Verify OAuth state cookie if present
  const stateCookie = req.cookies.get('shopify_oauth_state')?.value;
  if (stateCookie && state !== stateCookie) {
    return NextResponse.json(
      { error: 'Invalid OAuth state parameter' },
      { status: 403 }
    );
  }

  // Verify OAuth query parameter HMAC signature
  const params: Record<string, string> = {};
  searchParams.forEach((value, key) => {
    if (key !== 'hmac' && key !== 'signature') {
      params[key] = value;
    }
  });

  const message = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');

  const generatedHmac = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET!)
    .update(message)
    .digest('hex');

  if (
    generatedHmac.length !== hmac.length ||
    !crypto.timingSafeEqual(Buffer.from(generatedHmac), Buffer.from(hmac))
  ) {
    return NextResponse.json({ error: 'Invalid OAuth HMAC' }, { status: 401 });
  }

  // Exchange authorization code for permanent offline access token
  const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    }),
  });

  if (!tokenResponse.ok) {
    return NextResponse.json(
      { error: 'Failed to exchange Shopify OAuth token' },
      { status: 502 }
    );
  }

  const { access_token } = (await tokenResponse.json()) as {
    access_token: string;
  };

  // Upsert shop installation record
  const { data: upsertedShop, error: shopError } = await supabaseAdmin
    .from('shops')
    .upsert(
      {
        shop_domain: shop,
        access_token,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_domain' }
    )
    .select('id')
    .single();

  if (shopError || !upsertedShop) {
    return NextResponse.json(
      { error: 'Failed to persist shop session' },
      { status: 500 }
    );
  }

  // Ensure default app_settings exist for the shop
  await supabaseAdmin.from('app_settings').upsert(
    {
      shop_id: upsertedShop.id,
      merge_window_minutes: 360,
      auto_refund_shipping: true,
      notify_customer: true,
    },
    { onConflict: 'shop_id' }
  );

  // Automatic registration of required webhooks (ORDERS_CREATE, APP_UNINSTALLED, APP_SUBSCRIPTIONS_UPDATE)
  const appUrl = (
    process.env.SHOPIFY_APP_URL || new URL(req.url).origin
  ).replace(/\/$/, '');

  const webhooksToRegister = [
    { topic: 'ORDERS_CREATE', path: '/api/webhooks/orders-create' },
    { topic: 'APP_UNINSTALLED', path: '/api/webhooks/app-uninstalled' },
    {
      topic: 'APP_SUBSCRIPTIONS_UPDATE',
      path: '/api/webhooks/app-subscriptions-update',
    },
  ];

  await Promise.allSettled(
    webhooksToRegister.map((wh) =>
      shopifyGraphQL(shop, access_token, WEBHOOK_SUBSCRIPTION_CREATE, {
        topic: wh.topic,
        webhookSubscription: {
          callbackUrl: `${appUrl}${wh.path}`,
          format: 'JSON',
        },
      })
    )
  );

  const redirectUrl = `${appUrl}/?shop=${encodeURIComponent(shop)}`;
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.delete('shopify_oauth_state');
  return response;
}
