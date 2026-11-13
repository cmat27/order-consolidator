import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';

const SHOP_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const shop = searchParams.get('shop');

  if (!shop || !SHOP_REGEX.test(shop)) {
    return NextResponse.json(
      {
        error:
          'Missing or invalid shop parameter (expected *.myshopify.com)',
      },
      { status: 400 }
    );
  }

  const apiKey = process.env.SHOPIFY_API_KEY;
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  const appUrl = (
    process.env.SHOPIFY_APP_URL || new URL(req.url).origin
  ).replace(/\/$/, '');
  const scopes =
    process.env.SCOPES ||
    'read_orders,write_orders,read_order_edits,write_order_edits,read_products,read_customers,write_customers,read_fulfillments,write_fulfillments';

  if (!apiKey || !apiSecret) {
    return NextResponse.json(
      { error: 'Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET environment variable' },
      { status: 500 }
    );
  }

  // 1. Try Shopify Dev Dashboard Client Credentials Grant first (works automatically once installed via Dev Dashboard -> Home -> Install app)
  try {
    const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: apiKey,
        client_secret: apiSecret,
      }),
    });

    if (tokenRes.ok) {
      const { access_token, scope: grantedScope } = (await tokenRes.json()) as {
        access_token?: string;
        scope?: string;
      };
      if (
        access_token &&
        (!grantedScope || grantedScope.includes('write_order_edits'))
      ) {
        const { data: upsertedShop } = await supabaseAdmin
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

        if (upsertedShop) {
          await supabaseAdmin.from('app_settings').upsert(
            {
              shop_id: upsertedShop.id,
              merge_window_minutes: 360,
              auto_refund_shipping: true,
              notify_customer: true,
            },
            { onConflict: 'shop_id' }
          );
        }

        return NextResponse.redirect(
          `${appUrl}/?shop=${encodeURIComponent(shop)}`
        );
      }
    }
  } catch {
    // Fall back to standard OAuth authorize redirect below
  }

  // 2. Fallback to standard OAuth authorization code redirect
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${appUrl}/api/auth/callback`;

  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', apiKey);
  authorizeUrl.searchParams.set('scope', scopes);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);

  return NextResponse.redirect(authorizeUrl.toString());
}
