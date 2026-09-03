import path from 'path';
import fs from 'fs';
import { Document, Page, View, Text, StyleSheet, Image, renderToBuffer } from '@react-pdf/renderer';

// Static UPI QR (2026-09-03, client decision): "Option 2" for paying an
// invoice — scan this directly on the printed/PDF invoice via any UPI app,
// alongside "Option 1" (the Razorpay payment link sent as the WhatsApp
// message's button). Unlike the Razorpay QR below (generated per-order from
// that order's payment link), this is one fixed, static image — the
// business's own UPI QR code, not order-specific and not regenerated.
// Real file now provided: src/assets/Peach_Blue_QR.jpeg (uploaded directly
// to disk by the client, not extracted from a chat image — that isn't
// something this service can do). __dirname here resolves relative to
// wherever this file actually runs from (src/ under ts-node-dev in dev,
// dist/ under the compiled build in production) — package.json's `build`
// script was updated to copy src/assets to dist/assets (via fs.cpSync) so
// this same relative path resolves correctly in both.
const UPI_QR_IMAGE_PATH = path.join(__dirname, '../assets/Peach_Blue_QR.jpeg');

// Real bug found 2026-09-03: react-pdf's <Image src="..."> treats a bare
// filesystem path as something to fetch() over the network, not read from
// disk — it silently failed ("fetch failed", logged but not thrown) and
// produced a PDF with no image where the QR should be, exactly like the
// existing Razorpay QR block already avoids by using a base64 data URI
// (QRCode.toDataURL) rather than a path. Fixed by reading the file directly
// and building the same kind of data URI at render time.
const readUpiQrDataUrl = (): string | null => {
  if (!fs.existsSync(UPI_QR_IMAGE_PATH)) {
    return null;
  }
  const base64 = fs.readFileSync(UPI_QR_IMAGE_PATH).toString('base64');
  return `data:image/jpeg;base64,${base64}`;
};

// Brand colors per CLAUDE.md — peach/coral for accents, navy for text/pricing.
// Placeholder hex values read off client artwork, not an official brand
// guide (CLAUDE.md flags these as pending an exact logo source file).
const PEACH = '#F2764A';
const NAVY = '#16305C';

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, color: NAVY, fontFamily: 'Helvetica' },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  brand: { fontSize: 20, fontWeight: 700, color: PEACH },
  tagline: { fontSize: 8, color: NAVY, marginTop: 2 },
  section: { marginBottom: 12 },
  label: { fontSize: 8, color: '#666666', marginBottom: 2 },
  value: { fontSize: 11, marginBottom: 6 },
  table: { marginTop: 8 },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#eeeeee', paddingVertical: 4 },
  tableHeaderRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: NAVY, paddingBottom: 4, marginBottom: 2 },
  colItem: { flex: 3 },
  colService: { flex: 2 },
  colQty: { flex: 1, textAlign: 'right' },
  colPrice: { flex: 1, textAlign: 'right' },
  colTotal: { flex: 1, textAlign: 'right' },
  totalsBlock: { marginTop: 12, alignItems: 'flex-end' },
  totalsRow: { flexDirection: 'row', width: 200, justifyContent: 'space-between', marginBottom: 3 },
  grandTotalRow: { flexDirection: 'row', width: 200, justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: NAVY },
  grandTotalText: { fontWeight: 700, fontSize: 13 },
  qrOptionsRow: { flexDirection: 'row', justifyContent: 'center', gap: 40 },
  qrBlock: { marginTop: 20, alignItems: 'center' },
  qrImage: { width: 250, height: 250 },
  footer: { position: 'absolute', bottom: 24, left: 32, right: 32, textAlign: 'center', fontSize: 7, color: '#999999' },
});

export interface InvoicePdfItem {
  itemName: string;
  // Real invoice-design gap found 2026-09-03: the same garment name can
  // legitimately be billed at different prices across service tiers
  // (CLAUDE.md "Major pricing model update" point 5) — printing which tier
  // a line was billed at removes that ambiguity for the customer.
  serviceTypeLabel: string;
  quantityLabel: string; // pre-formatted: "3" for piece items, "3.5 kg" for per-kg items
  unitPriceLabel: string;
  lineTotal: number;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  orderNumber: string;
  pickupDate: Date;
  customerName: string;
  locationLabel: string;
  branchName: string;
  items: InvoicePdfItem[];
  subtotal: number;
  discountPercent: number;
  // CLAUDE.md "Bag-replacement ₹350 charge": additional_charges tied to this
  // order (bag_replacement rows) — a flat fee, not discounted, itemized
  // separately from the discount line rather than silently folded into
  // `amount` with no explanation on the PDF.
  additionalChargesTotal: number;
  amount: number;
  paymentLinkUrl: string | null;
  turnaroundLabel: string; // e.g. "24–48" — matches orderService.ts's pickup_confirmation phrasing
}

// "Rs." rather than "₹": @react-pdf/renderer's built-in Helvetica font has
// no ₹ glyph at all — it silently substitutes a fallback character (a
// superscript "¹") on every amount, a real cosmetic bug found 2026-09-03
// via an actual rendered/delivered invoice, not caught by tsc/Jest (no test
// renders real glyphs). Matches the wording the WhatsApp templates already
// use for the same underlying reason ("Amount due: Rs.{{3}}") rather than
// embedding a whole new font file just for one symbol.
const formatInr = (value: number): string => `Rs. ${value.toFixed(2)}`;

export const renderInvoicePdf = async (data: InvoicePdfData): Promise<Buffer> => {
  const upiQrDataUrl = readUpiQrDataUrl();

  const doc = (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.brand}>Peach & Blue</Text>
            <Text style={styles.tagline}>Fresh. Clean. Perfectly cared for.</Text>
          </View>
          <View>
            <Text style={styles.label}>Invoice</Text>
            <Text style={styles.value}>{data.invoiceNumber}</Text>
            <Text style={styles.label}>Order</Text>
            <Text style={styles.value}>{data.orderNumber}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Billed to</Text>
          <Text style={styles.value}>{data.customerName}</Text>
          <Text style={styles.label}>Location</Text>
          <Text style={styles.value}>{data.locationLabel} — {data.branchName}</Text>
          <Text style={styles.label}>Pickup date</Text>
          <Text style={styles.value}>{data.pickupDate.toDateString()}</Text>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={styles.colItem}>Item</Text>
            <Text style={styles.colService}>Service</Text>
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colPrice}>Price</Text>
            <Text style={styles.colTotal}>Total</Text>
          </View>
          {data.items.map((item, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={styles.colItem}>{item.itemName}</Text>
              <Text style={styles.colService}>{item.serviceTypeLabel}</Text>
              <Text style={styles.colQty}>{item.quantityLabel}</Text>
              <Text style={styles.colPrice}>{item.unitPriceLabel}</Text>
              <Text style={styles.colTotal}>{formatInr(item.lineTotal)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text>Subtotal</Text>
            <Text>{formatInr(data.subtotal)}</Text>
          </View>
          {data.discountPercent > 0 && (
            <View style={styles.totalsRow}>
              <Text>Discount ({data.discountPercent}%)</Text>
              <Text>-{formatInr((data.subtotal * data.discountPercent) / 100)}</Text>
            </View>
          )}
          {data.additionalChargesTotal > 0 && (
            <View style={styles.totalsRow}>
              <Text>Additional Charges</Text>
              <Text>{formatInr(data.additionalChargesTotal)}</Text>
            </View>
          )}
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalText}>Amount to be paid</Text>
            <Text style={styles.grandTotalText}>{formatInr(data.amount)}</Text>
          </View>
        </View>

        <Text style={{ marginTop: 16, fontSize: 8 }}>
          Turnaround time is typically {data.turnaroundLabel} hours from pickup.
        </Text>

        {/* CORRECTED (2026-09-03), per explicit client decision: dropped the
            Razorpay-generated QR entirely (it duplicated the payment link
            already sent as the WhatsApp message's button, and the client
            wants only the business's own static UPI QR shown here) — only
            renders when there's a live payment link (monthly-billing orders
            have nothing to point at either way, same as before) AND the
            static UPI QR asset is actually present on disk. */}
        {data.paymentLinkUrl && upiQrDataUrl && (
          <View style={styles.section}>
            <Text style={{ fontSize: 9, marginBottom: 8 }}>
              Scan the QR code below to pay via UPI, or use the payment link sent on WhatsApp.
            </Text>
            <View style={styles.qrOptionsRow}>
              <View style={styles.qrBlock}>
                <Image src={upiQrDataUrl} style={styles.qrImage} />
                <Text style={{ marginTop: 6, fontSize: 8 }}>Scan with any UPI app</Text>
              </View>
            </View>
          </View>
        )}

        {/* CLAUDE.md "Non-negotiables": wording updated from "NIVENXA" to
            "Nivenxa Technologies" everywhere else in the app — this file
            was missed at the time. Non-interactive here (a PDF has no tap
            target), matching the splash screen's treatment. */}
        <Text style={styles.footer}>Powered by Nivenxa Technologies</Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
};
