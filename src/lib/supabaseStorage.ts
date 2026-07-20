import { createAdminClient } from '@supabase/server/core';

// createAdminClient() reads SUPABASE_URL/SUPABASE_SECRET_KEY straight from
// process.env (see @supabase/server's resolveEnv, which accepts the same
// singular SUPABASE_SECRET_KEY name src/config/index.ts already exports) —
// no request context needed, unlike @supabase/server's withSupabase/
// createSupabaseContext, which are built for wrapping an incoming HTTP
// request and don't fit a background job with no request in scope.
const supabase = createAdminClient();

const INVOICE_BUCKET = 'invoices';

// Requires a public "invoices" Storage bucket to exist in the Supabase
// project (one-time dashboard setup, not managed by this codebase).
export const uploadInvoicePdf = async (fileName: string, pdfBuffer: Buffer): Promise<string> => {
  const { error } = await supabase.storage.from(INVOICE_BUCKET).upload(fileName, pdfBuffer, {
    contentType: 'application/pdf',
    upsert: true,
  });

  if (error) {
    throw new Error(`Failed to upload invoice PDF "${fileName}": ${error.message}`);
  }

  const { data } = supabase.storage.from(INVOICE_BUCKET).getPublicUrl(fileName);
  return data.publicUrl;
};
