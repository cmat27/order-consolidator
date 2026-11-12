import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get('shop');
  const code = searchParams.get('code');
  const hmac = searchParams.get('hmac');

  if (!shop || !code || !hmac) {
    return NextResponse.json(
      { error: 'Missing required OAuth query parameters' },
      { status: 400 }
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

  const redirectUrl = `${process.env.SHOPIFY_APP_URL}/?shop=${encodeURIComponent(
    shop
  )}`;
  return NextResponse.redirect(redirectUrl);
}
