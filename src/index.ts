import dotenv from 'dotenv';

// Load env vars FIRST before importing any modules that use them
dotenv.config();

import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth';
import itemsRoutes from './routes/items';
import accountRoutes from './routes/account';
import adminRoutes from './routes/admin';
import paymentsRoutes from './routes/payments';

const app = express();
const PORT = process.env.PORT || 3001;

console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'configured' : 'NOT CONFIGURED');
console.log('SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'configured' : 'NOT CONFIGURED');

const corsOptions = {
  origin: process.env.FRONTEND_URL || 'http://localhost:5174',
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentsRoutes);

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
