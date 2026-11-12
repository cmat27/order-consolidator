import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ||
        'https://example-project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:
        process.env.SUPABASE_SERVICE_ROLE_KEY ||
        'test_supabase_service_role_key',
      SHOPIFY_API_KEY: process.env.SHOPIFY_API_KEY || 'test_shopify_api_key',
      SHOPIFY_API_SECRET:
        process.env.SHOPIFY_API_SECRET || 'test_shopify_api_secret',
      SHOPIFY_APP_URL: process.env.SHOPIFY_APP_URL || 'http://localhost:3000',
      SCOPES:
        process.env.SCOPES ||
        'read_orders,write_orders,read_customers,write_customers,read_fulfillments,write_fulfillments',
      QSTASH_TOKEN: process.env.QSTASH_TOKEN || 'test_qstash_token',
      QSTASH_CURRENT_SIGNING_KEY:
        process.env.QSTASH_CURRENT_SIGNING_KEY ||
        'sig_test_current_key_1234567890',
      QSTASH_NEXT_SIGNING_KEY:
        process.env.QSTASH_NEXT_SIGNING_KEY || 'sig_test_next_key_1234567890',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
