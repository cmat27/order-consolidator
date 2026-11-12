import crypto from 'crypto';

export function verifyShopifyWebhook(
  rawBody: string,
  hmacHeader: string | null,
  secret: string
): boolean {
  if (!hmacHeader || !secret) return false;
  const hash = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  const hashBuf = Buffer.from(hash);
  const hmacBuf = Buffer.from(hmacHeader);
  if (hashBuf.length !== hmacBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(hashBuf, hmacBuf);
}
