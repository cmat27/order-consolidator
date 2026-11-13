import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyShopifyWebhook } from '@/lib/verify-webhook';
import { verifyShopifySessionToken } from '@/lib/shopify';

describe('verifyShopifyWebhook', () => {
  const secret = 'shpss_test_secret_key_12345';
  const payload = JSON.stringify({ id: 987654321, email: 'buyer@example.com' });

  it('returns true for a valid HMAC-SHA256 base64 signature', () => {
    const validHmac = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('base64');

    expect(verifyShopifyWebhook(payload, validHmac, secret)).toBe(true);
  });

  it('returns false when the HMAC header is null or empty', () => {
    expect(verifyShopifyWebhook(payload, null, secret)).toBe(false);
    expect(verifyShopifyWebhook(payload, '', secret)).toBe(false);
  });

  it('returns false when the signature is tampered or has mismatched length', () => {
    expect(verifyShopifyWebhook(payload, 'invalid-hmac', secret)).toBe(false);

    const wrongSecretHmac = crypto
      .createHmac('sha256', 'wrong_secret')
      .update(payload, 'utf8')
      .digest('base64');

    expect(verifyShopifyWebhook(payload, wrongSecretHmac, secret)).toBe(false);
  });
});

describe('verifyShopifySessionToken', () => {
  const secret = 'shpss_test_secret_key_12345';

  it('verifies a valid HS256 Shopify App Bridge JWT and returns the shop hostname', () => {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' })
    ).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'https://test-store.myshopify.com/admin',
        dest: 'https://test-store.myshopify.com',
        aud: 'api_key',
        exp: Math.floor(Date.now() / 1000) + 300,
      })
    ).toString('base64url');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const token = `Bearer ${header}.${payload}.${signature}`;
    expect(verifyShopifySessionToken(token, secret)).toBe(
      'test-store.myshopify.com'
    );
  });

  it('rejects tampered or expired session tokens', () => {
    expect(verifyShopifySessionToken('Bearer invalid.token.here', secret)).toBe(
      null
    );
    expect(verifyShopifySessionToken(null, secret)).toBe(null);
  });
});
