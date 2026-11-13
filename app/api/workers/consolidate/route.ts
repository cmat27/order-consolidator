import { NextRequest, NextResponse } from 'next/server';
import { Receiver } from '@upstash/qstash';
import { getShopSession, shopifyGraphQL } from '@/lib/shopify';
import { supabaseAdmin } from '@/lib/supabase';
import {
  CandidateOrder,
  executeOrderConsolidation,
  matchDuplicateOrders,
  UNFULFILLED_ORDERS_QUERY,
} from '@/lib/order-matcher';

interface GraphQLOrderNode {
  id: string;
  name: string;
  createdAt: string;
  email: string | null;
  displayFulfillmentStatus: string;
  cancelledAt: string | null;
  shippingAddress?: {
    address1?: string;
    address2?: string;
    city?: string;
    provinceCode?: string;
    zip?: string;
    countryCodeV2?: string;
  };
  totalShippingPriceSet?: {
    shopMoney?: {
      amount?: string;
    };
  };
  lineItems?: {
    nodes?: Array<{
      id: string;
      title?: string;
      quantity: number;
      originalUnitPriceSet?: {
        shopMoney?: {
          amount?: string;
          currencyCode?: string;
        };
      };
      variant?: {
        id: string;
      } | null;
    }>;
  };
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('upstash-signature');
  const rawBody = await req.text();

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing Upstash-Signature header' },
      { status: 401 }
    );
  }

  const receiver = new Receiver({
    currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY!,
    nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY!,
  });

  const isValid = await receiver
    .verify({
      signature,
      body: rawBody,
    })
    .catch(() => false);

  if (!isValid) {
    return NextResponse.json(
      { error: 'Invalid QStash signature' },
      { status: 401 }
    );
  }

  const payload = JSON.parse(rawBody);
  const { shopDomain, orderId, customerEmail } = payload;

  if (!shopDomain || !orderId || !customerEmail) {
    return NextResponse.json(
      { error: 'Missing required worker payload fields' },
      { status: 400 }
    );
  }

  const session = await getShopSession(shopDomain);
  if (!session) {
    return NextResponse.json(
      { error: 'Active shop session not found' },
      { status: 404 }
    );
  }

  // Idempotency check: ensure this order has not already been merged
  const { data: existingMerge } = await supabaseAdmin
    .from('merged_orders_log')
    .select('id')
    .eq('shop_id', session.id)
    .eq('merged_order_id', orderId)
    .eq('status', 'SUCCESS')
    .maybeSingle();

  if (existingMerge) {
    return NextResponse.json(
      { skipped: true, reason: 'Order already consolidated' },
      { status: 200 }
    );
  }

  // Query Shopify Admin GraphQL API for unfulfilled orders placed by customerEmail
  // When using the 1-minute test debounce window, allow a 60-minute order comparison window
  // so manually created test orders (>60s apart) still match cleanly.
  const effectiveMatchWindowMinutes = Math.max(session.mergeWindowMinutes, 60);
  const cutoffDate = new Date(
    Date.now() - effectiveMatchWindowMinutes * 60 * 1000 * 2
  ).toISOString();
  const searchQuery = `email:${customerEmail} fulfillment_status:unfulfilled status:open created_at:>=${cutoffDate}`;

  const ordersResponse = await shopifyGraphQL<{
    orders: { nodes: GraphQLOrderNode[] };
  }>(session.shopDomain, session.accessToken, UNFULFILLED_ORDERS_QUERY, {
    query: searchQuery,
  });

  const rawNodes = ordersResponse.data?.orders?.nodes || [];
  const candidateOrders: CandidateOrder[] = rawNodes.map((node) => ({
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    email: node.email || customerEmail,
    displayFulfillmentStatus: node.displayFulfillmentStatus,
    cancelledAt: node.cancelledAt,
    shippingAddress: {
      address1: node.shippingAddress?.address1,
      address2: node.shippingAddress?.address2,
      city: node.shippingAddress?.city,
      province_code: node.shippingAddress?.provinceCode,
      zip: node.shippingAddress?.zip,
      country_code: node.shippingAddress?.countryCodeV2,
    },
    totalShippingAmount: parseFloat(
      node.totalShippingPriceSet?.shopMoney?.amount || '0.00'
    ),
    lineItems: (node.lineItems?.nodes || []).map((li) => ({
      id: li.id,
      variantId: li.variant?.id || '',
      title: li.title || 'Consolidated Item',
      quantity: li.quantity,
      priceAmount: li.originalUnitPriceSet?.shopMoney?.amount || '0.00',
      currencyCode: li.originalUnitPriceSet?.shopMoney?.currencyCode || 'USD',
    })),
  }));

  const matchResult = matchDuplicateOrders(
    candidateOrders,
    orderId,
    effectiveMatchWindowMinutes
  );

  if (
    !matchResult.matched ||
    !matchResult.primaryOrder ||
    !matchResult.duplicateOrder
  ) {
    return NextResponse.json(
      {
        consolidated: false,
        reason: matchResult.reason || 'No duplicate order match found',
      },
      { status: 200 }
    );
  }

  // Execute merge mutations on Shopify
  const execution = await executeOrderConsolidation({
    shopDomain: session.shopDomain,
    accessToken: session.accessToken,
    primaryOrder: matchResult.primaryOrder,
    duplicateOrder: matchResult.duplicateOrder,
    notifyCustomer: session.notifyCustomer,
    autoRefundShipping: session.autoRefundShipping,
  });

  // Record audit log in Supabase (use canonical orderId for reliable idempotency)
  await supabaseAdmin.from('merged_orders_log').insert({
    shop_id: session.id,
    primary_order_id: matchResult.primaryOrder.id,
    merged_order_id: matchResult.duplicateOrder.id,
    customer_email: customerEmail,
    items_consolidated_count: execution.itemsConsolidatedCount,
    shipping_dollars_saved: execution.shippingDollarsSaved,
    status: execution.success ? 'SUCCESS' : 'FAILED',
    error_message: execution.errorMessage || null,
  });

  return NextResponse.json(
    {
      consolidated: execution.success,
      primaryOrderId: matchResult.primaryOrder.id,
      mergedOrderId: matchResult.duplicateOrder.id,
      itemsConsolidatedCount: execution.itemsConsolidatedCount,
      shippingDollarsSaved: execution.shippingDollarsSaved,
      errorMessage: execution.errorMessage,
    },
    { status: execution.success ? 200 : 500 }
  );
}
