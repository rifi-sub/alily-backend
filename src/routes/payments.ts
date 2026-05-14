import express, { Request, Response } from 'express';
import { supabase } from '../lib/supabase';
import client from '../lib/paypal';
import {
  OrderRequest,
  OrderCaptureRequest,
  CheckoutPaymentIntent,
  Money,
  AmountBreakdown,
  PurchaseUnitRequest,
} from '@paypal/paypal-server-sdk';
import { OrdersController } from '@paypal/paypal-server-sdk';

const router = express.Router();

interface CreateOrderBody {
  credits: number;
  amount: string;
  orderCode?: string;
  customerEmail?: string;
  items?: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }>;
}

interface CaptureOrderBody {
  orderId: string;
  userId?: string;
  credits?: number;
  customerEmail?: string;
  customerName?: string;
  items?: Array<{
    productId: string;
    name: string;
    price: number;
    quantity: number;
  }>;
  orderCode?: string;
}

interface CheckoutBody {
  userId: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  totalCredits: number;
}

/**
 * POST /api/payments/create-order
 * Creates a PayPal order for purchasing credits or items
 */
router.post('/create-order', async (req: Request, res: Response) => {
  try {
    const { credits, amount, orderCode, customerEmail, items }: CreateOrderBody = req.body;

    if (!credits || !amount) {
      return res.status(400).json({ error: 'Missing credits or amount' });
    }

    const description = items && items.length > 0 
      ? `Purchase ${items.length} item(s)` 
      : `Purchase ${credits} credits`;

    const customId = orderCode || `order-${Date.now()}`;

    const createOrderRequest: OrderRequest = {
      intent: CheckoutPaymentIntent.Capture,
      purchaseUnits: [
        {
          amount: {
            currencyCode: 'GBP',
            value: amount,
            breakdown: {
              itemTotal: {
                currencyCode: 'GBP',
                value: amount,
              },
            } as AmountBreakdown,
          } as Money,
          description,
          customId,
        } as PurchaseUnitRequest,
      ],
    };

    const ordersController = new OrdersController(client);
    const response = await ordersController.createOrder({
      body: createOrderRequest,
    });

    if (!response.result.id) {
      return res.status(500).json({ error: 'Failed to create PayPal order' });
    }

    res.json({ orderId: response.result.id });
  } catch (error: any) {
    console.error('Create order error:', error);
    res.status(500).json({ error: error.message || 'Failed to create order' });
  }
});

/**
 * POST /api/payments/capture-order
 * Captures a PayPal order and adds credits to user or creates guest order
 */
router.post('/capture-order', async (req: Request, res: Response) => {
  try {
    const { orderId, userId, credits, customerEmail, customerName, items, orderCode }: CaptureOrderBody = req.body;

    if (!orderId) {
      return res.status(400).json({ error: 'Missing orderId' });
    }

    const ordersController = new OrdersController(client);
    let response;
    try {
      response = await ordersController.captureOrder({
        id: orderId,
      });
    } catch (paypalError: any) {
      console.error('PayPal capture error:', paypalError);
      const errorMessage = paypalError.message || 'PayPal error';
      const statusCode = paypalError.statusCode || 500;
      
      // Extract validation errors if available
      const details = paypalError.result?.details || [];
      
      return res.status(statusCode).json({ 
        error: errorMessage,
        paypal_error: paypalError.result?.name || 'UNKNOWN_ERROR',
        details: details.length > 0 ? details : undefined,
        hint: details.some((d: any) => d.issue === 'ORDER_NOT_APPROVED') 
          ? 'Customer must approve the order on PayPal before capturing'
          : undefined
      });
    }

    if (response.result.status !== 'COMPLETED') {
      console.error('PayPal capture status:', response.result.status);
      return res
        .status(422)
        .json({ 
          error: 'PayPal payment not completed', 
          status: response.result.status,
          orderId,
          hint: response.result.status === 'APPROVED' ? 'Order was approved but not captured. Please try again.' : 'Order status is ' + response.result.status
        });
    }

    // If this is a guest order (no userId, but has customerEmail)
    if (!userId && customerEmail) {
      // Create guest order
      const { data: guestOrderData, error: guestOrderError } = await supabase
        .from('guest_orders')
        .insert({
          order_code: orderCode || `ORD-${Date.now()}`,
          customer_email: customerEmail,
          customer_name: customerName,
          items: items || [],
          total_amount: credits || 0,
          paypal_order_id: orderId,
          status: 'completed',
        })
        .select()
        .single();

      if (guestOrderError) {
        console.error('Guest order insert error:', guestOrderError);
        return res.status(500).json({ 
          error: 'Failed to create order', 
          details: guestOrderError.message,
          hint: 'Make sure guest_orders table exists in Supabase'
        });
      }

      return res.json({ success: true, orderId: guestOrderData.id, orderCode: guestOrderData.order_code });
    }

    // Otherwise, this is a registered user purchase (credits)
    if (userId && credits) {
      // Add credits to user via Supabase function
      const { error: rpcError } = await supabase.rpc('add_credits', {
        user_id: userId,
        amount: credits,
      });

      if (rpcError) {
        console.error('RPC error:', rpcError);
        return res.status(500).json({ error: 'Failed to add credits' });
      }

      // Insert transaction record
      const { error: transactionError } = await supabase
        .from('credit_transactions')
        .insert({
          user_id: userId,
          amount: credits,
          type: 'purchase',
          reference: orderId,
        });

      if (transactionError) {
        console.error('Transaction insert error:', transactionError);
      }

      return res.json({ success: true, credits });
    }

    return res.status(400).json({ error: 'Missing required fields for order completion' });
  } catch (error: any) {
    console.error('Capture order error:', error);
    res.status(500).json({ error: error.message || 'Failed to capture order' });
  }
});

/**
 * POST /api/payments/checkout
 * Checkout: deduct credits and create order
 */
router.post('/checkout', async (req: Request, res: Response) => {
  try {
    const { userId, items, totalCredits }: CheckoutBody = req.body;

    if (!userId || !items || totalCredits === undefined) {
      return res.status(400).json({ error: 'Missing userId, items, or totalCredits' });
    }

    // Check user has enough balance
    const { data: voucherData, error: voucherError } = await supabase
      .from('vouchers')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (voucherError || !voucherData) {
      return res.status(404).json({ error: 'User voucher record not found' });
    }

    if (voucherData.balance < totalCredits) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    // Deduct credits
    const { error: updateError } = await supabase
      .from('vouchers')
      .update({ balance: voucherData.balance - totalCredits })
      .eq('user_id', userId);

    if (updateError) {
      console.error('Update error:', updateError);
      return res.status(500).json({ error: 'Failed to deduct credits' });
    }

    // Create order in orders table
    const { data: orderData, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        amount: totalCredits,
        status: 'pending',
        items,
      })
      .select()
      .single();

    if (orderError || !orderData) {
      console.error('Order insert error:', orderError);
      return res.status(500).json({ error: 'Failed to create order' });
    }

    // Insert transaction record
    const { error: transactionError } = await supabase
      .from('credit_transactions')
      .insert({
        user_id: userId,
        amount: -totalCredits,
        type: 'spent',
        reference: orderData.id,
      });

    if (transactionError) {
      console.error('Transaction insert error:', transactionError);
    }

    res.json({ success: true, orderId: orderData.id });
  } catch (error: any) {
    console.error('Checkout error:', error);
    res.status(500).json({ error: error.message || 'Checkout failed' });
  }
});

/**
 * GET /api/payments/balance/:userId
 * Get current credit balance
 */
router.get('/balance/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    const { data, error } = await supabase
      .from('vouchers')
      .select('balance')
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'User voucher record not found' });
    }

    res.json({ balance: data.balance || 0 });
  } catch (error: any) {
    console.error('Get balance error:', error);
    res.status(500).json({ error: error.message || 'Failed to get balance' });
  }
});

export default router;
