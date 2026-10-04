import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { EstimateDocumentData } from "@/features/estimates/pdf/data";
import { formatCents } from "@/lib/money";
import { formatPhone } from "@/lib/phone";

const money = (cents: number) => formatCents(cents, { alwaysCents: true });
const quantity = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(2));
const percent = (rate: number) => `${Math.round(rate * 100_000) / 1000}%`;

const SLATE = "#0f172a";
const MUTED = "#64748b";
const RULE = "#e2e8f0";

const styles = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 56, paddingHorizontal: 44, fontSize: 9.5, fontFamily: "Helvetica", color: SLATE, lineHeight: 1.35 },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  logo: { maxHeight: 44, maxWidth: 150, objectFit: "contain", marginBottom: 6 },
  companyName: { fontSize: 14, fontFamily: "Helvetica-Bold" },
  muted: { color: MUTED },
  docTitle: { fontSize: 18, fontFamily: "Helvetica-Bold", textAlign: "right" },
  right: { textAlign: "right" },
  parties: { flexDirection: "row", gap: 24, marginBottom: 16 },
  party: { flex: 1 },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  section: { marginBottom: 14 },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: SLATE, paddingBottom: 4, fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6 },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: RULE, paddingVertical: 5 },
  cItem: { flex: 1, paddingRight: 8 },
  cQty: { width: 44, textAlign: "right" },
  cUnit: { width: 34, paddingLeft: 6 },
  cPrice: { width: 70, textAlign: "right" },
  cTotal: { width: 76, textAlign: "right" },
  totals: { marginTop: 10, marginLeft: "auto", width: 230 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: SLATE, marginTop: 4, paddingTop: 5, fontSize: 12, fontFamily: "Helvetica-Bold" },
  signatures: { flexDirection: "row", gap: 24, marginTop: 28 },
  signature: { flex: 1, borderTopWidth: 0.75, borderTopColor: SLATE, paddingTop: 3, fontSize: 8, color: MUTED },
  footer: { position: "absolute", bottom: 26, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: MUTED },
});

/** The estimate as a letter-size PDF (spec §7.3). Every number comes from the stored row. */
export function EstimateDocument({ data }: { data: EstimateDocumentData }) {
  const { company, customer, estimate, lines } = data;
  return (
    <Document title={`Estimate ${estimate.label}`} author={company.name}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop */}
            {company.logo ? <Image src={company.logo} style={styles.logo} /> : null}
            <Text style={styles.companyName}>{company.name}</Text>
            {company.addressLines.map((line) => (
              <Text key={line} style={styles.muted}>
                {line}
              </Text>
            ))}
            <Text style={styles.muted}>{[company.phone ? formatPhone(company.phone) : null, company.email].filter(Boolean).join("  ·  ")}</Text>
            {company.licenseNumber ? <Text style={styles.muted}>License {company.licenseNumber}</Text> : null}
          </View>
          <View>
            <Text style={styles.docTitle}>Estimate</Text>
            <Text style={[styles.right, styles.bold]}>{estimate.label}</Text>
            <Text style={[styles.right, styles.muted]}>Date: {estimate.date}</Text>
            {estimate.validUntil ? <Text style={[styles.right, styles.muted]}>Valid until: {estimate.validUntil}</Text> : null}
          </View>
        </View>

        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.label}>Prepared for</Text>
            <Text style={styles.bold}>{customer.name}</Text>
            {customer.phone ? <Text>{formatPhone(customer.phone)}</Text> : null}
            {customer.email ? <Text>{customer.email}</Text> : null}
          </View>
          <View style={styles.party}>
            <Text style={styles.label}>Property</Text>
            {data.propertyLines.length > 0 ? data.propertyLines.map((line) => <Text key={line}>{line}</Text>) : <Text style={styles.muted}>Not specified</Text>}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.bold, { fontSize: 11 }]}>{estimate.title}</Text>
          {estimate.scopeNotes ? <Text style={{ marginTop: 3 }}>{estimate.scopeNotes}</Text> : null}
        </View>

        <View style={styles.tableHead} fixed>
          <Text style={styles.cItem}>Item</Text>
          <Text style={styles.cQty}>Qty</Text>
          <Text style={styles.cUnit}>Unit</Text>
          <Text style={styles.cPrice}>Unit price</Text>
          <Text style={styles.cTotal}>Total</Text>
        </View>
        {lines.map((line, index) => (
          <View key={index} style={styles.row} wrap={false}>
            <View style={styles.cItem}>
              <Text>{line.name}</Text>
              {line.description ? <Text style={styles.muted}>{line.description}</Text> : null}
            </View>
            <Text style={styles.cQty}>{quantity(line.quantity)}</Text>
            <Text style={styles.cUnit}>{line.unit}</Text>
            <Text style={styles.cPrice}>{money(line.unitPriceCents)}</Text>
            <Text style={styles.cTotal}>{money(line.totalCents)}</Text>
          </View>
        ))}

        <View style={styles.totals} wrap={false}>
          <View style={styles.totalRow}>
            <Text>Subtotal</Text>
            <Text>{money(estimate.subtotalCents)}</Text>
          </View>
          {estimate.discountCents > 0 ? (
            <View style={styles.totalRow}>
              <Text>Discount</Text>
              <Text>-{money(estimate.discountCents)}</Text>
            </View>
          ) : null}
          {estimate.taxCents > 0 || estimate.taxRate > 0 ? (
            <View style={styles.totalRow}>
              <Text>Tax ({percent(estimate.taxRate)})</Text>
              <Text>{money(estimate.taxCents)}</Text>
            </View>
          ) : null}
          <View style={styles.grand}>
            <Text>Total</Text>
            <Text>{money(estimate.totalCents)}</Text>
          </View>
          {estimate.depositCents > 0 ? (
            <View style={styles.totalRow}>
              <Text>Deposit due on acceptance ({estimate.depositPercent}%)</Text>
              <Text>{money(estimate.depositCents)}</Text>
            </View>
          ) : null}
        </View>

        {estimate.terms ? (
          <View style={[styles.section, { marginTop: 18 }]}>
            <Text style={styles.label}>Terms</Text>
            <Text>{estimate.terms}</Text>
          </View>
        ) : null}

        <View wrap={false}>
          <Text style={[styles.label, { marginTop: 18 }]}>Acceptance</Text>
          <Text>I approve this estimate and authorize the work described above.</Text>
          <View style={styles.signatures}>
            <Text style={[styles.signature, { flex: 2 }]}>Customer signature</Text>
            <Text style={styles.signature}>Printed name</Text>
            <Text style={styles.signature}>Date</Text>
          </View>
        </View>

        <View style={styles.footer} fixed>
          <Text>
            {company.name} · Estimate {estimate.label}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
