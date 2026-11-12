import { NextRequest, NextResponse } from 'next/server';
import { getShopSession, shopifyGraphQL } from '@/lib/shopify';

const APP_SUBSCRIPTION_CREATE = `
  mutation AppSubscriptionCreate($name: String!, $returnUrl: URL!, $trialDays: Int!, $price: Decimal!) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      lineItems: [{
        plan: {
          appRecurringPricingDetails: {
            price: { amount: $price, currencyCode: USD }
            interval: EVERY_30_DAYS
          }
        }
      }]
    ) {
      appSubscription { id }
      confirmationUrl
      userErrors { field message }
    }
  }
`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const shopDomain = body.shopDomain || req.headers.get('x-shopify-shop-domain');

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

    const returnUrl = `${process.env.SHOPIFY_APP_URL}?shop=${encodeURIComponent(
      shopDomain
    )}`;

    const response = await shopifyGraphQL<{
      appSubscriptionCreate: {
        appSubscription: { id: string } | null;
        confirmationUrl: string | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(session.shopDomain, session.accessToken, APP_SUBSCRIPTION_CREATE, {
      name: 'Order Consolidator Pro ($19/month)',
      returnUrl,
      trialDays: 14,
      price: 19.0,
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

    return NextResponse.json(
      {
        subscriptionId: payload.appSubscription?.id,
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
