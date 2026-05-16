"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const supabase_1 = require("../lib/supabase");
const paypal_1 = __importDefault(require("../lib/paypal"));
const paypal_server_sdk_1 = require("@paypal/paypal-server-sdk");
const paypal_server_sdk_2 = require("@paypal/paypal-server-sdk");
const router = express_1.default.Router();
function buildGuestOrderCode() {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `ORD-${timestamp}-${random}`;
}
/**
 * POST /api/payments/create-order
 * Creates a PayPal order for purchasing credits or items
 */
router.post('/create-order', async (req, res) => {
    try {
        const { credits, amount, orderCode, customerEmail, items } = req.body;
        if (!credits || !amount) {
            return res.status(400).json({ error: 'Missing credits or amount' });
        }
        const description = items && items.length > 0
            ? `Purchase ${items.length} item(s)`
            : `Purchase ${credits} credits`;
        const customId = orderCode || `order-${Date.now()}`;
        const createOrderRequest = {
            intent: paypal_server_sdk_1.CheckoutPaymentIntent.Capture,
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
                        },
                    },
                    description,
                    customId,
                },
            ],
        };
        const ordersController = new paypal_server_sdk_2.OrdersController(paypal_1.default);
        const response = await ordersController.createOrder({
            body: createOrderRequest,
        });
        if (!response.result.id) {
            return res.status(500).json({ error: 'Failed to create PayPal order' });
        }
        res.json({ orderId: response.result.id });
    }
    catch (error) {
        console.error('Create order error:', error);
        res.status(500).json({ error: error.message || 'Failed to create order' });
    }
});
/**
 * POST /api/payments/capture-order
 * Captures a PayPal order and adds credits to user or creates guest order
 */
router.post('/capture-order', async (req, res) => {
    try {
        const { orderId, userId, credits, customerEmail, customerName, items, orderCode } = req.body;
        if (!orderId) {
            return res.status(400).json({ error: 'Missing orderId' });
        }
        const ordersController = new paypal_server_sdk_2.OrdersController(paypal_1.default);
        let response;
        try {
            response = await ordersController.captureOrder({
                id: orderId,
            });
        }
        catch (paypalError) {
            console.error('PayPal capture error:', paypalError);
            const errorMessage = paypalError.message || 'PayPal error';
            const statusCode = paypalError.statusCode || 500;
            // Extract validation errors if available
            const details = paypalError.result?.details || [];
            return res.status(statusCode).json({
                error: errorMessage,
                paypal_error: paypalError.result?.name || 'UNKNOWN_ERROR',
                details: details.length > 0 ? details : undefined,
                hint: details.some((d) => d.issue === 'ORDER_NOT_APPROVED')
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
            const resolvedOrderCode = orderCode || buildGuestOrderCode();
            // Create guest order
            const { data: guestOrderData, error: guestOrderError } = await supabase_1.supabase
                .from('guest_orders')
                .insert({
                order_code: resolvedOrderCode,
                customer_email: customerEmail,
                customer_name: customerName,
                items: items || [],
                total_amount: credits || 0,
                paypal_order_id: orderId,
                status: 'pending',
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
            // Mark all purchased items as 'sold'
            if (items && items.length > 0) {
                const itemIds = items.map((item) => item.productId);
                const { error: updateError } = await supabase_1.supabase
                    .from('items')
                    .update({ status: 'sold' })
                    .in('id', itemIds);
                if (updateError) {
                    console.error('Failed to mark items as sold:', updateError);
                    // Don't fail the order, just log the error
                }
            }
            return res.json({ success: true, orderId: guestOrderData.id, orderCode: guestOrderData.order_code });
        }
        // Otherwise, this is a registered user purchase (credits)
        if (userId && credits) {
            // Add credits to user via Supabase function
            const { error: rpcError } = await supabase_1.supabase.rpc('add_credits', {
                user_id: userId,
                amount: credits,
            });
            if (rpcError) {
                console.error('RPC error:', rpcError);
                return res.status(500).json({ error: 'Failed to add credits' });
            }
            // Insert transaction record
            const { error: transactionError } = await supabase_1.supabase
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
            // Mark all purchased items as 'sold'
            if (items && items.length > 0) {
                const itemIds = items.map((item) => item.productId);
                const { error: updateError } = await supabase_1.supabase
                    .from('items')
                    .update({ status: 'sold' })
                    .in('id', itemIds);
                if (updateError) {
                    console.error('Failed to mark items as sold:', updateError);
                    // Don't fail the order, just log the error
                }
            }
            return res.json({ success: true, credits });
        }
        return res.status(400).json({ error: 'Missing required fields for order completion' });
    }
    catch (error) {
        console.error('Capture order error:', error);
        res.status(500).json({ error: error.message || 'Failed to capture order' });
    }
});
/**
 * POST /api/payments/checkout
 * Checkout: deduct credits and create order
 */
router.post('/checkout', async (req, res) => {
    try {
        const { userId, items, totalCredits } = req.body;
        if (!userId || !items || totalCredits === undefined) {
            return res.status(400).json({ error: 'Missing userId, items, or totalCredits' });
        }
        // Check user has enough balance
        const { data: voucherData, error: voucherError } = await supabase_1.supabase
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
        const { error: updateError } = await supabase_1.supabase
            .from('vouchers')
            .update({ balance: voucherData.balance - totalCredits })
            .eq('user_id', userId);
        if (updateError) {
            console.error('Update error:', updateError);
            return res.status(500).json({ error: 'Failed to deduct credits' });
        }
        // Create order in orders table
        const { data: orderData, error: orderError } = await supabase_1.supabase
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
        const { error: transactionError } = await supabase_1.supabase
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
        // Mark all purchased items as 'sold'
        if (items && items.length > 0) {
            const itemIds = items.map((item) => item.productId);
            const { error: updateError } = await supabase_1.supabase
                .from('items')
                .update({ status: 'sold' })
                .in('id', itemIds);
            if (updateError) {
                console.error('Failed to mark items as sold:', updateError);
                // Don't fail the order, just log the error
            }
        }
        res.json({ success: true, orderId: orderData.id });
    }
    catch (error) {
        console.error('Checkout error:', error);
        res.status(500).json({ error: error.message || 'Checkout failed' });
    }
});
/**
 * GET /api/payments/balance/:userId
 * Get current credit balance
 */
router.get('/balance/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { data, error } = await supabase_1.supabase
            .from('vouchers')
            .select('balance')
            .eq('user_id', userId)
            .single();
        if (error || !data) {
            return res.status(404).json({ error: 'User voucher record not found' });
        }
        res.json({ balance: data.balance || 0 });
    }
    catch (error) {
        console.error('Get balance error:', error);
        res.status(500).json({ error: error.message || 'Failed to get balance' });
    }
});
/**
 * GET /api/payments/order-status/:orderCode
 * Public order status lookup for guest orders
 */
router.get('/order-status/:orderCode', async (req, res) => {
    try {
        const { orderCode } = req.params;
        if (!orderCode) {
            return res.status(400).json({ error: 'Missing order code' });
        }
        const { data, error } = await supabase_1.supabase
            .from('guest_orders')
            .select('order_code, status, customer_email, customer_name, total_amount, created_at, updated_at')
            .eq('order_code', orderCode)
            .maybeSingle();
        if (error) {
            return res.status(500).json({ error: error.message || 'Failed to fetch order status' });
        }
        if (!data) {
            return res.status(404).json({ error: 'Order not found' });
        }
        return res.json({
            orderCode: data.order_code,
            status: data.status,
            customerEmail: data.customer_email,
            customerName: data.customer_name,
            totalAmount: Number(data.total_amount || 0),
            createdAt: data.created_at,
            updatedAt: data.updated_at,
        });
    }
    catch (error) {
        console.error('Order status lookup error:', error);
        return res.status(500).json({ error: error.message || 'Failed to fetch order status' });
    }
});
exports.default = router;
//# sourceMappingURL=payments.js.map