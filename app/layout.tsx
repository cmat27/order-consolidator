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
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
