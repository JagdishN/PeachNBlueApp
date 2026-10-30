import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import { getSummaryHandler } from '../controllers/reportController';
import { getInvoiceAgingReportHandler, exportInvoiceAgingCsvHandler } from '../controllers/reportingController';

const router = Router();

router.get('/summary', authenticate, requireRole(['admin']), getSummaryHandler);
// Outstanding-dues rework, section 11 — admin-only invoice-level aging/
// audit report, with filters (branch, customer, date, status, aging
// bucket, outstanding range) and a CSV export variant.
router.get('/aging', authenticate, requireRole(['admin']), getInvoiceAgingReportHandler);
router.get('/aging.csv', authenticate, requireRole(['admin']), exportInvoiceAgingCsvHandler);

export default router;
