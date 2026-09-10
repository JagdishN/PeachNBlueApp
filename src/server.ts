import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import orderRoutes from './routes/orders';
import customerRoutes from './routes/customers';
import garmentRoutes from './routes/garments';
import branchRoutes from './routes/branches';
import ledgerRoutes from './routes/ledger';
import reportRoutes from './routes/reports';
import deviceRoutes from './routes/devices';
import webhookRoutes from './routes/webhooks';
import { errorHandler } from './middleware/errorHandler';
import { staffFieldFilter } from './middleware/staffFieldFilter';
import { registerJobs } from './jobs';
import { PORT } from './config';

const app = express();

app.use(helmet());
app.use(cors());
// Mounted BEFORE express.json(): the Razorpay webhook needs the raw request
// body for HMAC signature verification (routes/webhooks.ts uses express.raw()
// for this route specifically) — once the global express.json() below
// consumes the stream, the raw bytes are gone for good.
app.use('/api/v1/webhooks', webhookRoutes);
app.use(express.json());
// Secondary safety net for staff-hidden fields (see CLAUDE.md "Architecture
// decision, resolved") — must stay above every route, and above any future
// request/response logger, so it's the outermost res.json wrapper.
app.use(staffFieldFilter);

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/customers', customerRoutes);
app.use('/api/v1/garments', garmentRoutes);
app.use('/api/v1/branches', branchRoutes);
app.use('/api/v1/ledger', ledgerRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/devices', deviceRoutes);

app.use(errorHandler);

registerJobs();

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
