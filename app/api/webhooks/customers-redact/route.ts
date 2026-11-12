import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyWebhook } from '@/lib/verify-webhook';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const rawBody = await req.text();

  if (hmac && !verifyShopifyWebhook(rawBody, hmac, process.env.SHOPIFY_API_SECRET!)) {
    return NextResponse.json({ error: 'Unauthorized HMAC' }, { status: 401 });
  }

  if (rawBody) {
    try {
      const payload = JSON.parse(rawBody);
      const email = payload?.customer?.email;
      if (email) {
        await supabaseAdmin
          .from('merged_orders_log')
          .delete()
          .eq('customer_email', email);
      }
    } catch {
      // Ignore malformed or empty test payload
    }
  }

  return NextResponse.json(
    { received: true, topic: 'customers/redact' },
    { status: 200 }
  );
}
