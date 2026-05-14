"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
// Load env vars FIRST before importing any modules that use them
dotenv_1.default.config();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const auth_1 = __importDefault(require("./routes/auth"));
const items_1 = __importDefault(require("./routes/items"));
const account_1 = __importDefault(require("./routes/account"));
const admin_1 = __importDefault(require("./routes/admin"));
const payments_1 = __importDefault(require("./routes/payments"));
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? 'configured' : 'NOT CONFIGURED');
console.log('SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? 'configured' : 'NOT CONFIGURED');
const corsOptions = {
    origin: process.env.FRONTEND_URL || 'http://localhost:5174',
    credentials: true,
};
app.use((0, cors_1.default)(corsOptions));
app.use(express_1.default.json());
app.get('/health', (_, res) => res.json({ status: 'ok' }));
app.use('/api/auth', auth_1.default);
app.use('/api/items', items_1.default);
app.use('/api/account', account_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/payments', payments_1.default);
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
//# sourceMappingURL=index.js.map