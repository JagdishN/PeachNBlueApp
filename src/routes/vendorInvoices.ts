import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import {
  listVendorInvoicesHandler,
  exportVendorInvoicesCsvHandler,
  getVendorInvoiceHandler,
  getVendorInvoiceAuditHandler,
  createVendorInvoiceHandler,
  updateVendorInvoiceHandler,
  voidVendorInvoiceHandler,
} from '../controllers/vendorInvoiceController';

// Third-party vendor invoice management — fully separate from the
// customer invoice/payment routers. Admin-only throughout: spec section 7
// frames the whole feature as an Admin-declared internal record, and
// section 13 explicitly requires Admin authorization on create/update; the
// list/detail/export reads have no staff use case either (there's no
// staff-facing Vendor Invoices entry point anywhere in the spec's nav —
// section 8 places this under Settings/Setup, which staff doesn't reach).
const router = Router();

router.use(authenticate);
router.use(requireRole(['admin']));

router.get('/', listVendorInvoicesHandler);
router.get('/export.csv', exportVendorInvoicesCsvHandler);
router.get('/:id', getVendorInvoiceHandler);
router.get('/:id/audit', getVendorInvoiceAuditHandler);
router.post('/', createVendorInvoiceHandler);
router.patch('/:id', updateVendorInvoiceHandler);
router.post('/:id/void', voidVendorInvoiceHandler);

export default router;
