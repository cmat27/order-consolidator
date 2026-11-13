import crypto from 'crypto';
import { supabaseAdmin } from './supabase';

export const SHOPIFY_API_VERSION = '2024-10';

export interface GraphQLResponse<T = Record<string, unknown>> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * Verifies a Shopify App Bridge JWT session token (HS256 signed with SHOPIFY_API_SECRET)
 * and returns the authenticated shop domain (`*.myshopify.com`).
 */
export function verifyShopifySessionToken(
  authHeader: string | null,
  secret: string | undefined
): string | null {
  if (!authHeader || !secret || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  const sigBuf = Buffer.from(signatureB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (
    sigBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(sigBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8')
    ) as {
      exp?: number;
      nbf?: number;
      dest?: string;
      aud?: string;
    };

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSec - 5) return null;
    if (payload.nbf && payload.nbf > nowSec + 5) return null;

    if (payload.dest) {
      const url = new URL(payload.dest);
      return url.hostname;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Retrieves the offline access token for a given shop domain from Supabase.
 */
export async function getShopSession(shopDomain: string): Promise<{
  id: string;
  shopDomain: string;
  accessToken: string;
  subscriptionStatus: string;
  subscriptionId: string | null;
  mergeWindowMinutes: number;
  autoRefundShipping: boolean;
  notifyCustomer: boolean;
} | null> {
  const { data: shop, error } = await supabaseAdmin
    .from('shops')
    .select(
      '*, app_settings(merge_window_minutes, auto_refund_shipping, notify_customer)'
    )
    .eq('shop_domain', shopDomain)
    .eq('is_active', true)
    .single();

  if (error || !shop) {
    return null;
  }

  const settings = Array.isArray(shop.app_settings)
    ? shop.app_settings[0]
    : shop.app_settings;

  return {
    id: shop.id,
    shopDomain: shop.shop_domain,
    accessToken: shop.access_token,
    subscriptionStatus: shop.subscription_status || 'UNSUBSCRIBED',
    subscriptionId: shop.subscription_id || null,
    mergeWindowMinutes: settings?.merge_window_minutes ?? 360,
    autoRefundShipping: settings?.auto_refund_shipping ?? true,
    notifyCustomer: settings?.notify_customer ?? true,
  };
}

/**
 * Executes an authenticated GraphQL request against the Shopify Admin API.
 */
export async function shopifyGraphQL<T = Record<string, unknown>>(
  shopDomain: string,
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<GraphQLResponse<T>> {
  const endpoint = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.status === 401 || response.status === 403) {
    // Attempt automatic token refresh via Client Credentials Grant if configured
    const apiKey = process.env.SHOPIFY_API_KEY;
    const apiSecret = process.env.SHOPIFY_API_SECRET;
    if (apiKey && apiSecret && !apiKey.startsWith('test_')) {
      const refreshRes = await fetch(
        `https://${shopDomain}/admin/oauth/access_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: apiKey,
            client_secret: apiSecret,
          }),
        }
      ).catch(() => null);

      if (refreshRes && refreshRes.ok) {
        const { access_token: newToken } = (await refreshRes.json()) as {
          access_token?: string;
        };
        if (newToken && newToken !== accessToken) {
          await supabaseAdmin
            .from('shops')
            .update({
              access_token: newToken,
              updated_at: new Date().toISOString(),
            })
            .eq('shop_domain', shopDomain);

          const retryRes = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Shopify-Access-Token': newToken,
            },
            body: JSON.stringify({ query, variables }),
          });
          if (retryRes.ok) {
            return (await retryRes.json()) as GraphQLResponse<T>;
          }
        }
      }
    }
  }

  if (!response.ok) {
    throw new Error(
      `Shopify GraphQL request failed with status ${response.status}: ${await response.text()}`
    );
  }

  return (await response.json()) as GraphQLResponse<T>;
}
