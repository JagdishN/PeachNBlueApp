import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { getInvoiceAgingReport, getCustomerStatement, toAgingCsv, InvoiceAgingFilters, AgingCategory } from '../services/reportingService';

const parseFilters = (req: AuthRequest): InvoiceAgingFilters => {
  const q = req.query;
  // Branch-scoped admins (CLAUDE.md's existing convention everywhere else
  // in this app) always see only their own branch, regardless of what's
  // passed in the query — an unscoped admin may filter by any branch.
  const branchId = req.auth!.branchId ?? (q.branchId as string | undefined);

  return {
    branchId,
    customerId: q.customerId as string | undefined,
    paymentStatus: q.paymentStatus as InvoiceAgingFilters['paymentStatus'],
    invoiceDateFrom: q.invoiceDateFrom ? new Date(q.invoiceDateFrom as string) : undefined,
    invoiceDateTo: q.invoiceDateTo ? new Date(q.invoiceDateTo as string) : undefined,
    outstandingMin: q.outstandingMin ? Number(q.outstandingMin) : undefined,
    outstandingMax: q.outstandingMax ? Number(q.outstandingMax) : undefined,
    agingCategory: q.agingCategory as AgingCategory | undefined,
  };
};

export const getInvoiceAgingReportHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const rows = await getInvoiceAgingReport(parseFilters(req));
  res.status(200).json({ rows });
};

export const exportInvoiceAgingCsvHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const rows = await getInvoiceAgingReport(parseFilters(req));
  const csv = toAgingCsv(rows);
  res.status(200).setHeader('Content-Type', 'text/csv').setHeader('Content-Disposition', 'attachment; filename="invoice-aging-report.csv"').send(csv);
};

export const getCustomerStatementHandler = async (req: AuthRequest, res: Response): Promise<void> => {
  const statement = await getCustomerStatement(req.params.id);
  res.status(200).json({ statement });
};
