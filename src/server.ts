import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import orderRoutes from './routes/orders';
import garmentRoutes from './routes/garments';
import branchRoutes from './routes/branches';
import ledgerRoutes from './routes/ledger';
import reportRoutes from './routes/reports';
import deviceRoutes from './routes/devices';
import { errorHandler } from './middleware/errorHandler';
import { PORT } from './config';

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/garments', garmentRoutes);
app.use('/api/v1/branches', branchRoutes);
app.use('/api/v1/ledger', ledgerRoutes);
app.use('/api/v1/reports', reportRoutes);
app.use('/api/v1/devices', deviceRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
