import { normalizeAddress, ShippingAddress } from './normalize-address';
import { shopifyGraphQL } from './shopify';

export interface CandidateLineItem {
  id: string;
  variantId: string;
  title?: string;
  quantity: number;
  priceAmount?: string;
  currencyCode?: string;
  isGiftCard?: boolean;
}

export interface CandidateOrder {
  id: string;
  name: string;
  createdAt: string;
  email: string;
  displayFulfillmentStatus: string;
  cancelledAt: string | null;
  currencyCode?: string;
  hasExternal3PL?: boolean;
  shippingAddress: ShippingAddress;
  totalShippingAmount: number;
  lineItems: CandidateLineItem[];
}

export interface ConsolidationMatchResult {
  matched: boolean;
  primaryOrder?: CandidateOrder;
  duplicateOrder?: CandidateOrder;
  itemsToConsolidateCount: number;
  shippingDollarsSaved: number;
  reason?: string;
}

export const UNFULFILLED_ORDERS_QUERY = `
  query FindUnfulfilledCustomerOrders($query: String!) {
    orders(first: 20, query: $query, sortKey: CREATED_AT, reverse: false) {
      nodes {
        id
        name
        createdAt
        email
        currencyCode
        displayFulfillmentStatus
        cancelledAt
        shippingAddress {
          address1
          address2
          city
          provinceCode
          zip
          countryCodeV2
        }
        totalShippingPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        fulfillmentOrders(first: 10) {
          nodes {
            assignedLocation {
              location {
                fulfillmentService {
                  serviceName
                  type
                }
              }
            }
          }
        }
        lineItems(first: 50) {
          nodes {
            id
            title
            quantity
            isGiftCard
            originalUnitPriceSet {
              shopMoney {
                amount
                currencyCode
              }
            }
            variant {
              id
            }
          }
        }
      }
    }
  }
`;

export const ORDER_EDIT_BEGIN_MUTATION = `
  mutation orderEditBegin($id: ID!) {
    orderEditBegin(id: $id) {
      calculatedOrder {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ORDER_EDIT_ADD_VARIANT_MUTATION = `
  mutation orderEditAddVariant($id: ID!, $variantId: ID!, $quantity: Int!) {
    orderEditAddVariant(id: $id, variantId: $variantId, quantity: $quantity) {
      calculatedLineItem {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ORDER_EDIT_ADD_CUSTOM_ITEM_MUTATION = `
  mutation orderEditAddCustomItem($id: ID!, $title: String!, $quantity: Int!, $price: MoneyInput!) {
    orderEditAddCustomItem(id: $id, title: $title, quantity: $quantity, price: $price) {
      calculatedLineItem {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ORDER_EDIT_ADD_LINE_ITEM_DISCOUNT_MUTATION = `
  mutation orderEditAddLineItemDiscount($id: ID!, $lineItemId: ID!, $discount: OrderEditAppliedDiscountInput!) {
    orderEditAddLineItemDiscount(id: $id, lineItemId: $lineItemId, discount: $discount) {
      addedDiscountStagedChange {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ORDER_EDIT_COMMIT_MUTATION = `
  mutation orderEditCommit($id: ID!, $notifyCustomer: Boolean!, $staffNote: String) {
    orderEditCommit(id: $id, notifyCustomer: $notifyCustomer, staffNote: $staffNote) {
      order {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const TAGS_ADD_MUTATION = `
  mutation tagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) {
      node {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export const ORDER_CANCEL_MUTATION = `
  mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $refund: Boolean!, $restock: Boolean!) {
    orderCancel(orderId: $orderId, reason: $reason, refund: $refund, restock: $restock) {
      job { id }
      userErrors { field message }
    }
  }
`;

export const REFUND_CREATE_MUTATION = `
  mutation refundCreate($input: RefundInput!) {
    refundCreate(input: $input) {
      refund {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

function containsGiftCard(order: CandidateOrder): boolean {
  return order.lineItems.some((item) => Boolean(item.isGiftCard));
}

function isExternal3PL(order: CandidateOrder): boolean {
  return Boolean(order.hasExternal3PL);
}

/**
 * Evaluates candidate orders for the same customer within the configured merge window
 * and determines whether the target duplicate order can be consolidated into an earlier primary order.
 * Enforces guardrails:
 * - Bypasses orders containing gift cards
 * - Bypasses orders assigned to external 3PL fulfillment services (e.g., Amazon MCF)
 * - Verifies identical currency codes before merging
 */
export function matchDuplicateOrders(
  orders: CandidateOrder[],
  targetOrderId: string,
  mergeWindowMinutes: number
): ConsolidationMatchResult {
  const eligible = orders
    .filter(
      (o) =>
        o.displayFulfillmentStatus === 'UNFULFILLED' &&
        !o.cancelledAt &&
        Boolean(o.email)
    )
    .sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

  const duplicateOrder = eligible.find((o) => o.id === targetOrderId);
  if (!duplicateOrder) {
    return {
      matched: false,
      itemsToConsolidateCount: 0,
      shippingDollarsSaved: 0,
      reason: 'Target order is not eligible or already fulfilled/cancelled',
    };
  }

  // Guardrail 1: Bypass orders containing gift cards
  if (containsGiftCard(duplicateOrder)) {
    return {
      matched: false,
      itemsToConsolidateCount: 0,
      shippingDollarsSaved: 0,
      reason: 'Bypassed: order contains a gift card',
    };
  }

  // Guardrail 2: Bypass orders fulfilled by external 3PL systems (e.g. Amazon MCF)
  if (isExternal3PL(duplicateOrder)) {
    return {
      matched: false,
      itemsToConsolidateCount: 0,
      shippingDollarsSaved: 0,
      reason: 'Bypassed: order is routed to an external 3PL fulfillment service',
    };
  }

  const targetAddressKey = normalizeAddress(duplicateOrder.shippingAddress);
  const targetCreatedMs = new Date(duplicateOrder.createdAt).getTime();
  const windowMs = mergeWindowMinutes * 60 * 1000;
  const duplicateCurrency = (duplicateOrder.currencyCode || 'USD').toUpperCase();

  let sawCurrencyMismatch = false;

  const primaryOrder = eligible.find((candidate) => {
    if (candidate.id === duplicateOrder.id) return false;
    if (candidate.email.toLowerCase() !== duplicateOrder.email.toLowerCase()) {
      return false;
    }

    const candidateCreatedMs = new Date(candidate.createdAt).getTime();
    const diffMs = Math.abs(targetCreatedMs - candidateCreatedMs);
    if (diffMs > windowMs) {
      return false;
    }

    // Primary order should be placed earlier than or at the same time as the duplicate
    if (candidateCreatedMs > targetCreatedMs) {
      return false;
    }

    if (normalizeAddress(candidate.shippingAddress) !== targetAddressKey) {
      return false;
    }

    // Guardrail 1 & 2 on primary order
    if (containsGiftCard(candidate) || isExternal3PL(candidate)) {
      return false;
    }

    // Guardrail 3: Verify identical currency codes before merging
    const candidateCurrency = (candidate.currencyCode || 'USD').toUpperCase();
    if (candidateCurrency !== duplicateCurrency) {
      sawCurrencyMismatch = true;
      return false;
    }

    return true;
  });

  if (!primaryOrder) {
    return {
      matched: false,
      itemsToConsolidateCount: 0,
      shippingDollarsSaved: 0,
      reason: sawCurrencyMismatch
        ? 'Bypassed: currency code mismatch between orders'
        : 'No matching primary unfulfilled order within merge window',
    };
  }

  const itemsToConsolidateCount = duplicateOrder.lineItems.reduce(
    (sum, item) => sum + item.quantity,
    0
  );

  return {
    matched: true,
    primaryOrder,
    duplicateOrder,
    itemsToConsolidateCount,
    shippingDollarsSaved: Number(duplicateOrder.totalShippingAmount.toFixed(2)),
  };
}

/**
 * Executes the GraphQL consolidation workflow:
 * 1. orderEditBegin on primaryOrder
 * 2. orderEditAddVariant / orderEditAddCustomItem for each line item in duplicateOrder
 * 3. orderEditAddLineItemDiscount (100% discount so primaryOrder does not accrue an unpaid balance)
 * 4. orderEditCommit on primaryOrder
 * 5. tagsAdd on primaryOrder and duplicateOrder for audit visibility
 * 6. orderCancel on duplicateOrder (with reason CUSTOMER, refund: false to retain item payment, restock: true)
 * 7. Optional excess shipping refund via refundCreate if autoRefundShipping is enabled
 */
export async function executeOrderConsolidation(params: {
  shopDomain: string;
  accessToken: string;
  primaryOrder: CandidateOrder;
  duplicateOrder: CandidateOrder;
  notifyCustomer: boolean;
  autoRefundShipping: boolean;
}): Promise<{
  success: boolean;
  itemsConsolidatedCount: number;
  shippingDollarsSaved: number;
  errorMessage?: string;
}> {
  const {
    shopDomain,
    accessToken,
    primaryOrder,
    duplicateOrder,
    notifyCustomer,
    autoRefundShipping,
  } = params;

  // 1. Begin order edit on primary order
  const editBeginRes = await shopifyGraphQL<{
    orderEditBegin: {
      calculatedOrder: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(shopDomain, accessToken, ORDER_EDIT_BEGIN_MUTATION, {
    id: primaryOrder.id,
  });

  const calculatedOrderId =
    editBeginRes.data?.orderEditBegin?.calculatedOrder?.id;
  const beginErrors = editBeginRes.data?.orderEditBegin?.userErrors || [];
  const topLevelErrors = editBeginRes.errors || [];

  if (!calculatedOrderId || beginErrors.length > 0 || topLevelErrors.length > 0) {
    return {
      success: false,
      itemsConsolidatedCount: 0,
      shippingDollarsSaved: 0,
      errorMessage:
        beginErrors.map((e) => e.message).join('; ') ||
        topLevelErrors.map((e) => e.message).join('; ') ||
        'Failed to start orderEditBegin',
    };
  }

  // 2. Add each line item from the duplicate order & apply 100% discount (since paid on duplicate order)
  let itemsConsolidatedCount = 0;
  for (const item of duplicateOrder.lineItems) {
    let calculatedLineItemId: string | undefined;

    if (item.variantId) {
      const addVariantRes = await shopifyGraphQL<{
        orderEditAddVariant: {
          calculatedLineItem: { id: string } | null;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }>(shopDomain, accessToken, ORDER_EDIT_ADD_VARIANT_MUTATION, {
        id: calculatedOrderId,
        variantId: item.variantId,
        quantity: item.quantity,
      });

      const addErrors =
        addVariantRes.data?.orderEditAddVariant?.userErrors || [];
      if (addErrors.length > 0) {
        return {
          success: false,
          itemsConsolidatedCount,
          shippingDollarsSaved: 0,
          errorMessage: addErrors.map((e) => e.message).join('; '),
        };
      }
      calculatedLineItemId =
        addVariantRes.data?.orderEditAddVariant?.calculatedLineItem?.id;
      itemsConsolidatedCount += item.quantity;
    } else if (item.title) {
      const addCustomRes = await shopifyGraphQL<{
        orderEditAddCustomItem: {
          calculatedLineItem: { id: string } | null;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }>(shopDomain, accessToken, ORDER_EDIT_ADD_CUSTOM_ITEM_MUTATION, {
        id: calculatedOrderId,
        title: item.title,
        quantity: item.quantity,
        price: {
          amount: item.priceAmount || '0.00',
          currencyCode: item.currencyCode || duplicateOrder.currencyCode || 'USD',
        },
      });

      const addErrors =
        addCustomRes.data?.orderEditAddCustomItem?.userErrors || [];
      if (addErrors.length > 0) {
        return {
          success: false,
          itemsConsolidatedCount,
          shippingDollarsSaved: 0,
          errorMessage: addErrors.map((e) => e.message).join('; '),
        };
      }
      calculatedLineItemId =
        addCustomRes.data?.orderEditAddCustomItem?.calculatedLineItem?.id;
      itemsConsolidatedCount += item.quantity;
    }

    // Apply 100% discount on the added line item so primaryOrder does not show an unpaid balance
    if (calculatedLineItemId) {
      const discountRes = await shopifyGraphQL<{
        orderEditAddLineItemDiscount: {
          addedDiscountStagedChange: { id: string } | null;
          userErrors: Array<{ field: string[]; message: string }>;
        };
      }>(shopDomain, accessToken, ORDER_EDIT_ADD_LINE_ITEM_DISCOUNT_MUTATION, {
        id: calculatedOrderId,
        lineItemId: calculatedLineItemId,
        discount: {
          description: `Prepaid on consolidated order ${duplicateOrder.name}`,
          percentValue: 100,
        },
      });

      const discountErrors =
        discountRes.data?.orderEditAddLineItemDiscount?.userErrors || [];
      if (discountErrors.length > 0) {
        return {
          success: false,
          itemsConsolidatedCount: 0,
          shippingDollarsSaved: 0,
          errorMessage: discountErrors.map((e) => e.message).join('; '),
        };
      }
    }
  }

  // 3. Commit order edit
  const commitRes = await shopifyGraphQL<{
    orderEditCommit: {
      order: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(shopDomain, accessToken, ORDER_EDIT_COMMIT_MUTATION, {
    id: calculatedOrderId,
    notifyCustomer,
    staffNote: `Consolidated ${itemsConsolidatedCount} item(s) from duplicate order ${duplicateOrder.name}`,
  });

  const commitErrors = commitRes.data?.orderEditCommit?.userErrors || [];
  if (commitErrors.length > 0) {
    return {
      success: false,
      itemsConsolidatedCount: 0,
      shippingDollarsSaved: 0,
      errorMessage: commitErrors.map((e) => e.message).join('; '),
    };
  }

  // 4. Tag primary and duplicate orders for merchant visibility
  await shopifyGraphQL(shopDomain, accessToken, TAGS_ADD_MUTATION, {
    id: primaryOrder.id,
    tags: ['consolidated-primary', `merged-from-${duplicateOrder.name.replace('#', '')}`],
  });
  await shopifyGraphQL(shopDomain, accessToken, TAGS_ADD_MUTATION, {
    id: duplicateOrder.id,
    tags: ['consolidated-duplicate', `merged-into-${primaryOrder.name.replace('#', '')}`],
  });

  // 5. Cancel duplicate order with reason CUSTOMER (refund: false so item payment is retained; shipping refunded separately in step 6)
  const cancelRes = await shopifyGraphQL<{
    orderCancel: {
      job: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(shopDomain, accessToken, ORDER_CANCEL_MUTATION, {
    orderId: duplicateOrder.id,
    reason: 'CUSTOMER',
    refund: false,
    restock: true,
  });

  const cancelErrors = cancelRes.data?.orderCancel?.userErrors || [];
  if (cancelErrors.length > 0) {
    return {
      success: false,
      itemsConsolidatedCount,
      shippingDollarsSaved: 0,
      errorMessage: cancelErrors.map((e) => e.message).join('; '),
    };
  }

  // 6. Execute shipping-only refund adjustment if autoRefundShipping is enabled and duplicate had shipping fee
  const shippingDollarsSaved = autoRefundShipping
    ? Number(duplicateOrder.totalShippingAmount.toFixed(2))
    : 0;

  if (autoRefundShipping && shippingDollarsSaved > 0) {
    const refundRes = await shopifyGraphQL<{
      refundCreate: {
        refund: { id: string } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(shopDomain, accessToken, REFUND_CREATE_MUTATION, {
      input: {
        orderId: duplicateOrder.id,
        note: 'Auto-refunded excess shipping fee from order consolidation',
        notify: notifyCustomer,
        shipping: {
          fullRefund: true,
        },
      },
    });

    const refundErrors = refundRes.data?.refundCreate?.userErrors || [];
    if (refundErrors.length > 0) {
      return {
        success: false,
        itemsConsolidatedCount,
        shippingDollarsSaved: 0,
        errorMessage: refundErrors.map((e) => e.message).join('; '),
      };
    }
  }

  return {
    success: true,
    itemsConsolidatedCount,
    shippingDollarsSaved,
  };
}
