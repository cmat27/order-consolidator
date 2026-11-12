import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

async function resolveShop(shopDomain?: string | null) {
  if (shopDomain) {
    const { data } = await supabaseAdmin
      .from('shops')
      .select('id, shop_domain')
      .eq('shop_domain', shopDomain)
      .eq('is_active', true)
      .maybeSingle();
    if (data) return data;
  }

  const { data: fallbackShop } = await supabaseAdmin
    .from('shops')
    .select('id, shop_domain')
    .eq('is_active', true)
    .order('installed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return fallbackShop || null;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const shopParam =
      searchParams.get('shop') || req.headers.get('x-shopify-shop-domain');

    const shop = await resolveShop(shopParam);
    if (!shop) {
      return NextResponse.json(
        {
          shopDomain: null,
          settings: {
            mergeWindowMinutes: 360,
            autoRefundShipping: true,
            notifyCustomer: true,
          },
          auditLogs: [],
        },
        { status: 200 }
      );
    }

    const [{ data: settingsRow }, { data: logs }] = await Promise.all([
      supabaseAdmin
        .from('app_settings')
        .select('merge_window_minutes, auto_refund_shipping, notify_customer')
        .eq('shop_id', shop.id)
        .maybeSingle(),
      supabaseAdmin
        .from('merged_orders_log')
        .select(
          'id, primary_order_id, merged_order_id, items_consolidated_count, shipping_dollars_saved, status, created_at'
        )
        .eq('shop_id', shop.id)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    return NextResponse.json(
      {
        shopDomain: shop.shop_domain,
        settings: {
          mergeWindowMinutes: settingsRow?.merge_window_minutes ?? 360,
          autoRefundShipping: settingsRow?.auto_refund_shipping ?? true,
          notifyCustomer: settingsRow?.notify_customer ?? true,
        },
        auditLogs: (logs || []).map((log) => ({
          id: log.id,
          date: new Date(log.created_at)
            .toISOString()
            .replace('T', ' ')
            .slice(0, 16),
          primaryOrder: String(log.primary_order_id).replace(
            'gid://shopify/Order/',
            '#'
          ),
          mergedOrder: String(log.merged_order_id).replace(
            'gid://shopify/Order/',
            '#'
          ),
          itemsAdded: log.items_consolidated_count,
          dollarsSaved: Number(log.shipping_dollars_saved || 0),
          status: log.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
        })),
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to load settings',
      },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const shopParam =
      body.shopDomain || req.headers.get('x-shopify-shop-domain');
    const mergeWindowMinutes = Number(body.mergeWindowMinutes) || 360;
    const autoRefundShipping = Boolean(body.autoRefundShipping);
    const notifyCustomer = Boolean(body.notifyCustomer);

    const shop = await resolveShop(shopParam);
    if (!shop) {
      return NextResponse.json(
        {
          saved: true,
          persisted: false,
          reason: 'No active shop record found in Supabase yet',
        },
        { status: 200 }
      );
    }

    const { error } = await supabaseAdmin.from('app_settings').upsert(
      {
        shop_id: shop.id,
        merge_window_minutes: mergeWindowMinutes,
        auto_refund_shipping: autoRefundShipping,
        notify_customer: notifyCustomer,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shop_id' }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(
      {
        saved: true,
        persisted: true,
        shopDomain: shop.shop_domain,
      },
      { status: 200 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : 'Failed to save settings',
      },
      { status: 500 }
    );
  }
}
