'use client';

import React, { useState, useCallback, useEffect } from 'react';
import enTranslations from '@shopify/polaris/locales/en.json';
import {
  AppProvider,
  Page,
  Layout,
  Card,
  Select,
  Checkbox,
  Button,
  DataTable,
  Badge,
  Banner,
  Toast,
  Frame,
  BlockStack,
  InlineStack,
  Text,
  Box,
} from '@shopify/polaris';

interface ConsolidationRecord {
  id: string;
  date: string;
  primaryOrder: string;
  mergedOrder: string;
  itemsAdded: number;
  dollarsSaved: number;
  status: 'SUCCESS' | 'FAILED';
}

const INITIAL_AUDIT_FEED: ConsolidationRecord[] = [
  {
    id: '1',
    date: '2026-11-07 06:42',
    primaryOrder: '#1042',
    mergedOrder: '#1045',
    itemsAdded: 2,
    dollarsSaved: 8.99,
    status: 'SUCCESS',
  },
  {
    id: '2',
    date: '2026-11-06 19:15',
    primaryOrder: '#1038',
    mergedOrder: '#1039',
    itemsAdded: 1,
    dollarsSaved: 12.5,
    status: 'SUCCESS',
  },
  {
    id: '3',
    date: '2026-11-06 14:05',
    primaryOrder: '#1029',
    mergedOrder: '#1031',
    itemsAdded: 3,
    dollarsSaved: 9.95,
    status: 'SUCCESS',
  },
];

const MERGE_WINDOW_OPTIONS = [
  { label: '1 Hour', value: '60' },
  { label: '2 Hours', value: '120' },
  { label: '6 Hours (Recommended)', value: '360' },
  { label: '12 Hours', value: '720' },
  { label: '24 Hours', value: '1440' },
];

export default function OrderConsolidatorDashboard() {
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [mergeWindow, setMergeWindow] = useState<string>('360');
  const [autoRefundShipping, setAutoRefundShipping] = useState<boolean>(true);
  const [notifyCustomer, setNotifyCustomer] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [toastActive, setToastActive] = useState<boolean>(false);
  const [auditLogs, setAuditLogs] =
    useState<ConsolidationRecord[]>(INITIAL_AUDIT_FEED);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shop = params.get('shop');
    if (shop) {
      setShopDomain(shop);
    }

    const query = shop ? `?shop=${encodeURIComponent(shop)}` : '';
    fetch(`/api/settings${query}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        if (data.shopDomain) {
          setShopDomain(data.shopDomain);
        }
        if (data.settings) {
          setMergeWindow(String(data.settings.mergeWindowMinutes ?? 360));
          setAutoRefundShipping(Boolean(data.settings.autoRefundShipping));
          setNotifyCustomer(Boolean(data.settings.notifyCustomer));
        }
        if (Array.isArray(data.auditLogs) && data.auditLogs.length > 0) {
          setAuditLogs(data.auditLogs);
        }
      })
      .catch(() => {
        // Fallback to local default state if offline
      });
  }, []);

  const handleSaveSettings = useCallback(async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shopDomain,
          mergeWindowMinutes: Number(mergeWindow),
          autoRefundShipping,
          notifyCustomer,
        }),
      });
      if (!response.ok) {
        throw new Error('Failed to save settings');
      }
      setToastActive(true);
    } finally {
      setSaving(false);
    }
  }, [shopDomain, mergeWindow, autoRefundShipping, notifyCustomer]);

  const toggleToast = useCallback(
    () => setToastActive((active) => !active),
    []
  );

  const totalOrdersConsolidated = auditLogs.filter(
    (log) => log.status === 'SUCCESS'
  ).length;

  const totalShippingSaved = auditLogs
    .filter((log) => log.status === 'SUCCESS')
    .reduce((sum, log) => sum + log.dollarsSaved, 0);

  const tableRows = auditLogs.slice(0, 20).map((log) => [
    log.date,
    log.primaryOrder,
    log.mergedOrder,
    String(log.itemsAdded),
    `$${log.dollarsSaved.toFixed(2)}`,
    <Badge
      key={log.id}
      tone={log.status === 'SUCCESS' ? 'success' : 'critical'}
    >
      {log.status}
    </Badge>,
  ]);

  return (
    <AppProvider i18n={enTranslations}>
      <Frame>
        <Page
          title="Order Consolidator"
          titleMetadata={<Badge tone="success">Active</Badge>}
          subtitle="Automatically merge duplicate unfulfilled customer orders and refund excess shipping"
          secondaryActions={[
            {
              content: 'Documentation',
              url: 'https://shopify.dev/docs/api/admin-graphql',
              external: true,
            },
          ]}
        >
          <Layout>
            <Layout.Section>
              <Banner
                title="Consolidation Performance Summary"
                tone="info"
              >
                <InlineStack gap="800">
                  <Box>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      Total Orders Consolidated: {totalOrdersConsolidated}
                    </Text>
                  </Box>
                  <Box>
                    <Text as="p" variant="bodyMd" fontWeight="semibold">
                      Total Shipping Capital Saved: $
                      {totalShippingSaved.toFixed(2)}
                    </Text>
                  </Box>
                </InlineStack>
              </Banner>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Consolidation Rules & Debounce Window
                  </Text>

                  <Select
                    label="Merge Window"
                    options={MERGE_WINDOW_OPTIONS}
                    onChange={setMergeWindow}
                    value={mergeWindow}
                    helpText="Orders placed by the same customer to the same normalized shipping address within this time window will be merged before fulfillment."
                  />

                  <Checkbox
                    label="Auto-refund excess shipping fees"
                    checked={autoRefundShipping}
                    onChange={setAutoRefundShipping}
                    helpText="Automatically refund the duplicate shipping fee when a secondary order is merged."
                  />

                  <Checkbox
                    label="Send native Shopify cancellation notification to customer"
                    checked={notifyCustomer}
                    onChange={setNotifyCustomer}
                    helpText="Notify the customer via Shopify when their redundant order is consolidated into the primary order."
                  />

                  <InlineStack align="end">
                    <Button
                      variant="primary"
                      loading={saving}
                      onClick={handleSaveSettings}
                    >
                      Save Settings
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Recent Order Consolidations (Last 20)
                  </Text>
                  <DataTable
                    columnContentTypes={[
                      'text',
                      'text',
                      'text',
                      'numeric',
                      'numeric',
                      'text',
                    ]}
                    headings={[
                      'Date',
                      'Primary Order #',
                      'Merged Order #',
                      'Items Added',
                      'Dollars Saved',
                      'Status',
                    ]}
                    rows={tableRows}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          </Layout>

          {toastActive && (
            <Toast
              content="Consolidation settings saved successfully."
              onDismiss={toggleToast}
            />
          )}
        </Page>
      </Frame>
    </AppProvider>
  );
}
