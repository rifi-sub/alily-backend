"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const paypal_server_sdk_1 = require("@paypal/paypal-server-sdk");
const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE } = process.env;
if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
    throw new Error('PAYPAL_CLIENT_ID and PAYPAL_SECRET must be set');
}
const client = new paypal_server_sdk_1.Client({
    clientCredentialsAuthCredentials: {
        oAuthClientId: PAYPAL_CLIENT_ID,
        oAuthClientSecret: PAYPAL_SECRET,
    },
    environment: PAYPAL_MODE === 'live' ? paypal_server_sdk_1.Environment.Production : paypal_server_sdk_1.Environment.Sandbox,
    timeout: 0,
});
exports.default = client;
//# sourceMappingURL=paypal-new.js.map