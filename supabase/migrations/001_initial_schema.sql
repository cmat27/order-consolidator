-- 1. Shops / Installations Table
CREATE TABLE IF NOT EXISTS public.shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_domain TEXT UNIQUE NOT NULL,
    access_token TEXT NOT NULL,
    is_active BOOLEAN DEFAULT true,
    installed_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast domain lookups
CREATE INDEX IF NOT EXISTS idx_shops_domain ON public.shops(shop_domain);

-- 2. App Settings Table
CREATE TABLE IF NOT EXISTS public.app_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID REFERENCES public.shops(id) ON DELETE CASCADE UNIQUE NOT NULL,
    merge_window_minutes INTEGER DEFAULT 360, -- Default: 6 hours
    auto_refund_shipping BOOLEAN DEFAULT true,
    notify_customer BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Consolidated Orders Log Table (Audit Feed)
CREATE TABLE IF NOT EXISTS public.merged_orders_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID REFERENCES public.shops(id) ON DELETE CASCADE NOT NULL,
    primary_order_id TEXT NOT NULL,
    merged_order_id TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    items_consolidated_count INTEGER NOT NULL,
    shipping_dollars_saved NUMERIC(10, 2) DEFAULT 0.00,
    status TEXT NOT NULL, -- 'SUCCESS' or 'FAILED'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_merged_shop ON public.merged_orders_log(shop_id);
CREATE INDEX IF NOT EXISTS idx_merged_created ON public.merged_orders_log(created_at DESC);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merged_orders_log ENABLE ROW LEVEL SECURITY;
