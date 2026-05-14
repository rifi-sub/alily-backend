import { Client, Environment } from '@paypal/paypal-server-sdk';

const { PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE } = process.env;

if (!PAYPAL_CLIENT_ID || !PAYPAL_SECRET) {
  throw new Error('PAYPAL_CLIENT_ID and PAYPAL_SECRET must be set');
}

const client = new Client({
  clientCredentialsAuthCredentials: {
    oAuthClientId: PAYPAL_CLIENT_ID,
    oAuthClientSecret: PAYPAL_SECRET,
  },
  environment: PAYPAL_MODE === 'live' ? Environment.Production : Environment.Sandbox,
  timeout: 0,
});

export default client;
