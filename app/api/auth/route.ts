import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

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
  const appUrl = (
    process.env.SHOPIFY_APP_URL || new URL(req.url).origin
  ).replace(/\/$/, '');
  const scopes =
    process.env.SCOPES ||
    'read_orders,write_orders,read_customers,write_customers,read_fulfillments,write_fulfillments';

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Missing SHOPIFY_API_KEY environment variable' },
      { status: 500 }
    );
  }

  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${appUrl}/api/auth/callback`;

  const authorizeUrl = new URL(`https://${shop}/admin/oauth/authorize`);
  authorizeUrl.searchParams.set('client_id', apiKey);
  authorizeUrl.searchParams.set('scope', scopes);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);

  return NextResponse.redirect(authorizeUrl.toString());
}
