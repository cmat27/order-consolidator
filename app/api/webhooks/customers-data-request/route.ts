import { NextRequest, NextResponse } from 'next/server';
import { verifyShopifyWebhook } from '@/lib/verify-webhook';

export async function POST(req: NextRequest) {
  const hmac = req.headers.get('x-shopify-hmac-sha256');
  const rawBody = await req.text();

  if (!verifyShopifyWebhook(rawBody, hmac, process.env.SHOPIFY_API_SECRET!)) {
    return NextResponse.json({ error: 'Unauthorized HMAC' }, { status: 401 });
  }

  return NextResponse.json(
    { received: true, topic: 'customers/data_request' },
    { status: 200 }
  );
}
