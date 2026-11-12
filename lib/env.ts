import { z } from 'zod';

export const envSchema = z.object({
  SHOPIFY_API_KEY: z.string().min(1, 'SHOPIFY_API_KEY is required'),
  SHOPIFY_API_SECRET: z.string().min(1, 'SHOPIFY_API_SECRET is required'),
  SHOPIFY_APP_URL: z.string().url('SHOPIFY_APP_URL must be a valid URL'),
  SCOPES: z.string().min(1, 'SCOPES is required'),
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required'),
  QSTASH_URL: z.string().url().optional(),
  QSTASH_TOKEN: z.string().min(1, 'QSTASH_TOKEN is required'),
  QSTASH_CURRENT_SIGNING_KEY: z
    .string()
    .min(1, 'QSTASH_CURRENT_SIGNING_KEY is required'),
  QSTASH_NEXT_SIGNING_KEY: z
    .string()
    .min(1, 'QSTASH_NEXT_SIGNING_KEY is required'),
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.string().default('3000'),
});

export type Env = z.infer<typeof envSchema>;

export function getEnv(): Env {
  return envSchema.parse(process.env);
}
