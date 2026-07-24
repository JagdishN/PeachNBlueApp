import { Document, Page, View, Text, StyleSheet, Image, renderToBuffer } from '@react-pdf/renderer';
import QRCode from 'qrcode';

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
  colQty: { flex: 1, textAlign: 'right' },
  colPrice: { flex: 1, textAlign: 'right' },
  colTotal: { flex: 1, textAlign: 'right' },
  totalsBlock: { marginTop: 12, alignItems: 'flex-end' },
  totalsRow: { flexDirection: 'row', width: 200, justifyContent: 'space-between', marginBottom: 3 },
  grandTotalRow: { flexDirection: 'row', width: 200, justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: NAVY },
  grandTotalText: { fontWeight: 700, fontSize: 13 },
  qrBlock: { marginTop: 20, alignItems: 'center' },
  qrImage: { width: 110, height: 110 },
  footer: { position: 'absolute', bottom: 24, left: 32, right: 32, textAlign: 'center', fontSize: 7, color: '#999999' },
});

export interface InvoicePdfItem {
  itemName: string;
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

const formatInr = (value: number): string => `₹${value.toFixed(2)}`;

export const renderInvoicePdf = async (data: InvoicePdfData): Promise<Buffer> => {
  const qrDataUrl = data.paymentLinkUrl ? await QRCode.toDataURL(data.paymentLinkUrl) : null;

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
            <Text style={styles.colQty}>Qty</Text>
            <Text style={styles.colPrice}>Price</Text>
            <Text style={styles.colTotal}>Total</Text>
          </View>
          {data.items.map((item, i) => (
            <View style={styles.tableRow} key={i}>
              <Text style={styles.colItem}>{item.itemName}</Text>
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

        {qrDataUrl && (
          <View style={styles.qrBlock}>
            <Image src={qrDataUrl} style={styles.qrImage} />
            <Text style={{ marginTop: 6, fontSize: 8 }}>Scan to pay via Card or Net Banking</Text>
          </View>
        )}

        <Text style={styles.footer}>Powered by NIVENXA</Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
};
