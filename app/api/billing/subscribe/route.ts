import { NextRequest, NextResponse } from 'next/server';
import {
  getShopSession,
  shopifyGraphQL,
  verifyShopifySessionToken,
} from '@/lib/shopify';
import { supabaseAdmin } from '@/lib/supabase';

const APP_SUBSCRIPTION_CREATE = `
  mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int!, $price: Decimal!, $test: Boolean!) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: $price, currencyCode: USD }
            interval: EVERY_30_DAYS
          }
        }
      }]
    ) {
      appSubscription { id status }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const verifiedShop = verifyShopifySessionToken(
      req.headers.get('authorization'),
      process.env.SHOPIFY_API_SECRET
    );
    const shopDomain =
      verifiedShop ||
      body.shopDomain ||
      req.headers.get('x-shopify-shop-domain');

    if (!shopDomain) {
      return NextResponse.json(
        { error: 'Missing shopDomain parameter' },
        { status: 400 }
      );
    }

    const session = await getShopSession(shopDomain);
    if (!session) {
      return NextResponse.json(
        { error: 'Shop session not found' },
        { status: 404 }
      );
    }

    const appUrl = (
      process.env.SHOPIFY_APP_URL || new URL(req.url).origin
    ).replace(/\/$/, '');
    const returnUrl = `${appUrl}/?shop=${encodeURIComponent(
      shopDomain
    )}&billing=confirmed`;

    const isTestCharge =
      process.env.NODE_ENV !== 'production' || Boolean(body.test);

    const response = await shopifyGraphQL<{
      appSubscriptionCreate: {
        appSubscription: { id: string; status?: string } | null;
        confirmationUrl: string | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(session.shopDomain, session.accessToken, APP_SUBSCRIPTION_CREATE, {
      name: 'Order Consolidator Pro ($19/month)',
      returnUrl,
      trialDays: 14,
      price: 19.0,
      test: isTestCharge,
    });

    const payload = response.data?.appSubscriptionCreate;
    if (!payload || (payload.userErrors && payload.userErrors.length > 0)) {
      return NextResponse.json(
        {
          error:
            payload?.userErrors.map((e) => e.message).join('; ') ||
            'Failed to create subscription',
        },
        { status: 400 }
      );
    }

    const subscriptionId = payload.appSubscription?.id || null;
    const status = (payload.appSubscription?.status || 'PENDING').toUpperCase();

    await supabaseAdmin
      .from('shops')
      .update({
        subscription_id: subscriptionId,
        subscription_status: status,
        trial_ends_at: new Date(
          Date.now() + 14 * 24 * 60 * 60 * 1000
        ).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', session.id);

    return NextResponse.json(
      {
        subscriptionId,
        subscriptionStatus: status,
        confirmationUrl: payload.confirmationUrl,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Billing error' },
      { status: 500 }
    );
  }
}
