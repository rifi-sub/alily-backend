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
/**
 * POST /api/payments/create-order
 * Creates a PayPal order for purchasing credits
 */
router.post('/create-order', async (req, res) => {
    try {
        const { credits, amount } = req.body;
        if (!credits || !amount) {
            return res.status(400).json({ error: 'Missing credits or amount' });
        }
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
                    description: `Purchase ${credits} credits`,
                    customId: `credits-${credits}`,
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
 * Captures a PayPal order and adds credits to user
 */
router.post('/capture-order', async (req, res) => {
    try {
        const { orderId, userId, credits } = req.body;
        if (!orderId || !userId || !credits) {
            return res.status(400).json({ error: 'Missing orderId, userId, or credits' });
        }
        const ordersController = new paypal_server_sdk_2.OrdersController(paypal_1.default);
        const response = await ordersController.captureOrder({
            id: orderId,
        });
        if (response.result.status !== 'COMPLETED') {
            return res
                .status(400)
                .json({ error: 'PayPal payment not completed', status: response.result.status });
        }
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
        res.json({ success: true, credits });
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
exports.default = router;
//# sourceMappingURL=payments.js.map