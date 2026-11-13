-- Add subscription tracking columns to shops if upgrading from 001
ALTER TABLE public.shops
    ADD COLUMN IF NOT EXISTS subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'UNSUBSCRIBED',
    ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Explicit tenant isolation RLS policies (service_role bypasses RLS automatically;
-- these policies allow authenticated JWT claims scoped by shop_domain)
DROP POLICY IF EXISTS shops_tenant_isolation ON public.shops;
CREATE POLICY shops_tenant_isolation ON public.shops
    FOR ALL
    USING (shop_domain = current_setting('request.jwt.claims', true)::json->>'shop_domain');

DROP POLICY IF EXISTS app_settings_tenant_isolation ON public.app_settings;
CREATE POLICY app_settings_tenant_isolation ON public.app_settings
    FOR ALL
    USING (
        shop_id IN (
            SELECT id FROM public.shops
            WHERE shop_domain = current_setting('request.jwt.claims', true)::json->>'shop_domain'
        )
    );

DROP POLICY IF EXISTS merged_orders_log_tenant_isolation ON public.merged_orders_log;
CREATE POLICY merged_orders_log_tenant_isolation ON public.merged_orders_log
    FOR ALL
    USING (
        shop_id IN (
            SELECT id FROM public.shops
            WHERE shop_domain = current_setting('request.jwt.claims', true)::json->>'shop_domain'
        )
    );
