import { normalizeAddress, ShippingAddress } from './normalize-address';
import { shopifyGraphQL } from './shopify';

export interface CandidateLineItem {
  id: string;
  variantId: string;
  title?: string;
  quantity: number;
  priceAmount?: string;
  currencyCode?: string;
}

export interface CandidateOrder {
  id: string;
  name: string;
  createdAt: string;
  email: string;
  displayFulfillmentStatus: string;
  cancelledAt: string | null;
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
        lineItems(first: 50) {
          nodes {
            id
            title
            quantity
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

/**
 * Evaluates candidate orders for the same customer within the configured merge window
 * and determines whether the target duplicate order can be consolidated into an earlier primary order.
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

  const targetAddressKey = normalizeAddress(duplicateOrder.shippingAddress);
  const targetCreatedMs = new Date(duplicateOrder.createdAt).getTime();
  const windowMs = mergeWindowMinutes * 60 * 1000;

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

    return normalizeAddress(candidate.shippingAddress) === targetAddressKey;
  });

  if (!primaryOrder) {
    return {
      matched: false,
      itemsToConsolidateCount: 0,
      shippingDollarsSaved: 0,
      reason: 'No matching primary unfulfilled order within merge window',
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
 * 2. orderEditAddVariant for each line item in duplicateOrder
 * 3. orderEditCommit on primaryOrder
 * 4. orderCancel on duplicateOrder (with reason CUSTOMER, refund & restock)
 * 5. Optional excess shipping refund via refundCreate if configured
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

  // 2. Add each line item from the duplicate order
  let itemsConsolidatedCount = 0;
  for (const item of duplicateOrder.lineItems) {
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
          currencyCode: item.currencyCode || 'USD',
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
      itemsConsolidatedCount += item.quantity;
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

  // 4. Cancel duplicate order with reason CUSTOMER
  const cancelRes = await shopifyGraphQL<{
    orderCancel: {
      job: { id: string } | null;
      userErrors: Array<{ field: string[]; message: string }>;
    };
  }>(shopDomain, accessToken, ORDER_CANCEL_MUTATION, {
    orderId: duplicateOrder.id,
    reason: 'CUSTOMER',
    refund: autoRefundShipping,
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

  // 5. Execute shipping refund adjustment if autoRefundShipping is enabled and duplicate had shipping fee
  const shippingDollarsSaved = autoRefundShipping
    ? Number(duplicateOrder.totalShippingAmount.toFixed(2))
    : 0;

  if (autoRefundShipping && shippingDollarsSaved > 0) {
    await shopifyGraphQL(shopDomain, accessToken, REFUND_CREATE_MUTATION, {
      input: {
        orderId: duplicateOrder.id,
        note: 'Auto-refunded excess shipping fee from order consolidation',
        notify: notifyCustomer,
        shipping: {
          fullRefund: true,
        },
      },
    });
  }

  return {
    success: true,
    itemsConsolidatedCount,
    shippingDollarsSaved,
  };
}
