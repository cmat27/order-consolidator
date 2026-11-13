import type { Metadata } from 'next';
import '@shopify/polaris/build/esm/styles.css';

export const metadata: Metadata = {
  title: 'Shopify Order Consolidator | Embedded Admin',
  description:
    'Automated duplicate order detection, line item consolidation, and excess shipping refund engine.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const apiKey = process.env.SHOPIFY_API_KEY || '';

  return (
    <html lang="en">
      <head>
        <meta name="shopify-api-key" content={apiKey} />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js" />
      </head>
      <body>{children}</body>
    </html>
  );
}
