import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  listVendorInvoices,
  getVendorInvoiceSummary,
  getVendorInvoice,
  createVendorInvoice,
  updateVendorInvoice,
  voidVendorInvoice,
  listVendorInvoiceAudit,
  toVendorInvoiceCsv,
  VendorInvoiceFilters,
} from '../services/vendorInvoiceService';
import { serializeBigInts } from '../utils/serialize';

// Branch-scoping precedent: a branch-scoped admin's own branchId always
// wins over any query param; an unscoped admin may pass ?branchId= to
// narrow the view or omit it to see every branch — same shape as
// customerController.ts::listCustomersHandler / orderController.ts's
// effectiveBranchIdFor.
const effectiveBranchId = (req: AuthRequest, branchIdParam: unknown): string | undefined =>
  req.auth!.branchId ?? (typeof branchIdParam === 'string' ? branchIdParam : undefined);

const parseFilters = (req: AuthRequest): VendorInvoiceFilters => {
  const { search, paymentStatus, serviceType, dateFrom, dateTo, branchId, limit, offset } = req.query;
  return {
    branchId: effectiveBranchId(req, branchId),
    search: typeof search === 'string' && search.trim() ? search.trim() : undefined,
    paymentStatus:
      paymentStatus === 'paid' || paymentStatus === 'unpaid' || paymentStatus === 'all' ? paymentStatus : undefined,
    serviceType: typeof serviceType === 'string' ? (serviceType as VendorInvoiceFilters['serviceType']) : undefined,
    dateFrom: typeof dateFrom === 'string' ? new Date(dateFrom) : undefined,
    dateTo: typeof dateTo === 'string' ? new Date(dateTo) : undefined,
    limit: typeof limit === 'string' ? Number(limit) : undefined,
    offset: typeof offset === 'string' ? Number(offset) : undefined,
  };
};

export const listVendorInvoicesHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const filters = parseFilters(req);
  const [{ rows, total, limit, offset }, summary] = await Promise.all([
    listVendorInvoices(filters),
    getVendorInvoiceSummary(filters),
  ]);
  res.status(200).json(serializeBigInts({ rows, total, limit, offset, summary }));
};

export const exportVendorInvoicesCsvHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const filters = parseFilters(req);
  const { rows } = await listVendorInvoices({ ...filters, limit: 10_000, offset: 0 });
  const csv = toVendorInvoiceCsv(rows);
  res.status(200).set('Content-Type', 'text/csv').set('Content-Disposition', 'attachment; filename="vendor-invoices.csv"').send(csv);
};

export const getVendorInvoiceHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const invoice = await getVendorInvoice(req.params.id);
  if (!invoice) {
    res.status(404).json({ error: 'Vendor invoice not found.' });
    return;
  }
  res.status(200).json(serializeBigInts({ invoice }));
};

export const getVendorInvoiceAuditHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const audit = await listVendorInvoiceAudit(req.params.id);
  res.status(200).json(serializeBigInts({ audit }));
};

// Admin-only to create/update/void — enforced at the route layer
// (routes/vendorInvoices.ts), per spec section 13: "Enforce Admin
// authorization on create and update."
export const createVendorInvoiceHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { vendorName, description, serviceType, amount, paymentDone, branchId } = req.body;

  const resolvedBranchId = req.auth!.branchId ?? (typeof branchId === 'string' ? branchId : null);

  const invoice = await createVendorInvoice({
    vendorName,
    description,
    serviceType,
    amount,
    paymentDone,
    branchId: resolvedBranchId,
    createdById: req.auth!.userId,
  });

  res.status(201).json(serializeBigInts({ invoice }));
};

export const updateVendorInvoiceHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { vendorName, description, serviceType, amount, paymentDone, branchId } = req.body;

  const invoice = await updateVendorInvoice(req.params.id, {
    vendorName,
    description,
    serviceType,
    amount,
    paymentDone,
    branchId,
    updatedById: req.auth!.userId,
  });

  res.status(200).json(serializeBigInts({ invoice }));
};

export const voidVendorInvoiceHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const { reason } = req.body;
  const invoice = await voidVendorInvoice(req.params.id, { reason, voidedById: req.auth!.userId });
  res.status(200).json(serializeBigInts({ invoice }));
};
