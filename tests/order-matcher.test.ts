import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CandidateOrder,
  matchDuplicateOrders,
  executeOrderConsolidation,
} from '@/lib/order-matcher';
import * as shopifyModule from '@/lib/shopify';

describe('matchDuplicateOrders', () => {
  const baseOrder: CandidateOrder = {
    id: 'gid://shopify/Order/1001',
    name: '#1001',
    createdAt: '2026-11-07T10:00:00Z',
    email: 'customer@example.com',
    displayFulfillmentStatus: 'UNFULFILLED',
    cancelledAt: null,
    shippingAddress: {
      address1: '742 Evergreen Terrace',
      address2: 'Apartment 2',
      city: 'Springfield',
      province_code: 'IL',
      zip: '62701',
      country_code: 'US',
    },
    totalShippingAmount: 9.99,
    lineItems: [
      {
        id: 'gid://shopify/LineItem/1',
        variantId: 'gid://shopify/ProductVariant/101',
        quantity: 1,
      },
    ],
  };

  it('matches a duplicate unfulfilled order within the merge window and same normalized address', () => {
    const duplicateOrder: CandidateOrder = {
      ...baseOrder,
      id: 'gid://shopify/Order/1002',
      name: '#1002',
      createdAt: '2026-11-07T12:30:00Z', // 2.5 hours later (within 360 min window)
      shippingAddress: {
        address1: '742 evergreen terrace.',
        address2: 'apt 2',
        city: 'springfield',
        province_code: 'il',
        zip: '62701-0000',
        country_code: 'us',
      },
      totalShippingAmount: 8.5,
      lineItems: [
        {
          id: 'gid://shopify/LineItem/2',
          variantId: 'gid://shopify/ProductVariant/202',
          quantity: 2,
        },
      ],
    };

    const result = matchDuplicateOrders(
      [baseOrder, duplicateOrder],
      'gid://shopify/Order/1002',
      360
    );

    expect(result.matched).toBe(true);
    expect(result.primaryOrder?.id).toBe('gid://shopify/Order/1001');
    expect(result.duplicateOrder?.id).toBe('gid://shopify/Order/1002');
    expect(result.itemsToConsolidateCount).toBe(2);
    expect(result.shippingDollarsSaved).toBe(8.5);
  });

  it('does not match orders outside the configured merge window', () => {
    const lateOrder: CandidateOrder = {
      ...baseOrder,
      id: 'gid://shopify/Order/1003',
      name: '#1003',
      createdAt: '2026-11-07T18:00:00Z', // 8 hours later (> 360 min window)
    };

    const result = matchDuplicateOrders(
      [baseOrder, lateOrder],
      'gid://shopify/Order/1003',
      360
    );

    expect(result.matched).toBe(false);
  });

  it('does not match when shipping addresses differ', () => {
    const differentAddressOrder: CandidateOrder = {
      ...baseOrder,
      id: 'gid://shopify/Order/1004',
      name: '#1004',
      createdAt: '2026-11-07T11:00:00Z',
      shippingAddress: {
        ...baseOrder.shippingAddress,
        address1: '999 Different Blvd',
      },
    };

    const result = matchDuplicateOrders(
      [baseOrder, differentAddressOrder],
      'gid://shopify/Order/1004',
      360
    );

    expect(result.matched).toBe(false);
  });
});

describe('executeOrderConsolidation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('executes orderEditBegin, orderEditAddVariant, orderEditCommit, orderCancel, and refundCreate', async () => {
    const spy = vi.spyOn(shopifyModule, 'shopifyGraphQL').mockImplementation(
      async (_shop, _token, query) => {
        if (query.includes('orderEditBegin')) {
          return {
            data: {
              orderEditBegin: {
                calculatedOrder: { id: 'gid://shopify/CalculatedOrder/555' },
                userErrors: [],
              },
            },
          };
        }
        if (query.includes('orderEditAddVariant')) {
          return {
            data: {
              orderEditAddVariant: {
                calculatedLineItem: { id: 'gid://shopify/CalculatedLineItem/1' },
                userErrors: [],
              },
            },
          };
        }
        if (query.includes('orderEditCommit')) {
          return {
            data: {
              orderEditCommit: {
                order: { id: 'gid://shopify/Order/1001' },
                userErrors: [],
              },
            },
          };
        }
        if (query.includes('orderCancel')) {
          return {
            data: {
              orderCancel: {
                job: { id: 'gid://shopify/Job/999' },
                userErrors: [],
              },
            },
          };
        }
        if (query.includes('refundCreate')) {
          return {
            data: {
              refundCreate: {
                refund: { id: 'gid://shopify/Refund/777' },
                userErrors: [],
              },
            },
          };
        }
        return { data: {} };
      }
    );

    const primaryOrder: CandidateOrder = {
      id: 'gid://shopify/Order/1001',
      name: '#1001',
      createdAt: '2026-11-07T10:00:00Z',
      email: 'customer@example.com',
      displayFulfillmentStatus: 'UNFULFILLED',
      cancelledAt: null,
      shippingAddress: { address1: '123 Main St', zip: '10001' },
      totalShippingAmount: 10.0,
      lineItems: [],
    };

    const duplicateOrder: CandidateOrder = {
      ...primaryOrder,
      id: 'gid://shopify/Order/1002',
      name: '#1002',
      totalShippingAmount: 7.95,
      lineItems: [
        {
          id: 'gid://shopify/LineItem/2',
          variantId: 'gid://shopify/ProductVariant/303',
          quantity: 3,
        },
      ],
    };

    const res = await executeOrderConsolidation({
      shopDomain: 'test-shop.myshopify.com',
      accessToken: 'shpat_test_token',
      primaryOrder,
      duplicateOrder,
      notifyCustomer: true,
      autoRefundShipping: true,
    });

    expect(res.success).toBe(true);
    expect(res.itemsConsolidatedCount).toBe(3);
    expect(res.shippingDollarsSaved).toBe(7.95);
    expect(spy).toHaveBeenCalledTimes(5);
  });
});
