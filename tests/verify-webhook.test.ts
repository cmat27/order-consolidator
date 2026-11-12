import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { verifyShopifyWebhook } from '@/lib/verify-webhook';

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
