import { Body, Button, Container, Head, Heading, Html, Preview, Section, Text } from "@react-email/components";

const body = { backgroundColor: "#f1f5f9", fontFamily: "Inter, Arial, sans-serif", color: "#0f172a" };
const card = { backgroundColor: "#ffffff", border: "1px solid #e2e8f0", borderRadius: "6px", padding: "24px", margin: "24px auto", maxWidth: "480px" };
const button = { backgroundColor: "#2563eb", color: "#ffffff", borderRadius: "6px", padding: "10px 16px", fontSize: "14px", textDecoration: "none" };
const muted = { color: "#64748b", fontSize: "14px", margin: "4px 0" };

function Layout({ preview, title, children }: { preview: string; title: string; children: React.ReactNode }) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={body}>
        <Container style={card}>
          <Heading as="h1" style={{ fontSize: "18px", margin: "0 0 12px" }}>
            {title}
          </Heading>
          {children}
        </Container>
      </Body>
    </Html>
  );
}

export type NewLeadProps = { name: string; phone: string; workType: string; address: string; source: string; message: string; url: string };

export function NewLeadEmail(p: NewLeadProps) {
  return (
    <Layout preview={`New lead: ${p.name}`} title={`New lead: ${p.name}`}>
      {p.phone ? <Text style={{ fontSize: "16px", margin: "0 0 8px" }}>{p.phone}</Text> : null}
      <Text style={muted}>{[p.workType, p.address].filter(Boolean).join(" · ") || "No details yet"}</Text>
      <Text style={muted}>Source: {p.source || "Unknown"}</Text>
      {p.message ? <Text style={{ fontSize: "14px", margin: "12px 0" }}>“{p.message}”</Text> : null}
      <Section style={{ marginTop: "16px" }}>
        <Button href={p.url} style={button}>
          Open lead
        </Button>
      </Section>
    </Layout>
  );
}

export type DuplicateInquiryProps = { name: string; dealTitle: string; message: string; url: string };

export function DuplicateInquiryEmail(p: DuplicateInquiryProps) {
  return (
    <Layout preview={`${p.name} contacted us again`} title={`${p.name} contacted us again`}>
      <Text style={muted}>They already have an open deal: {p.dealTitle}</Text>
      {p.message ? <Text style={{ fontSize: "14px", margin: "12px 0" }}>“{p.message}”</Text> : null}
      <Section style={{ marginTop: "16px" }}>
        <Button href={p.url} style={button}>
          Open deal
        </Button>
      </Section>
    </Layout>
  );
}

export type InspectionConfirmationProps = { customerName: string; when: string; address: string; companyName: string; companyPhone: string; rescheduled: boolean };

/** Sent to the customer. Plain and short; no CRM links. */
export function InspectionConfirmationEmail(p: InspectionConfirmationProps) {
  const title = p.rescheduled ? "Your roof inspection has been rescheduled" : "Your roof inspection is scheduled";
  return (
    <Layout preview={`${title}: ${p.when}`} title={title}>
      <Text style={{ fontSize: "14px", margin: "0 0 8px" }}>Hi {p.customerName},</Text>
      <Text style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 4px" }}>{p.when}</Text>
      {p.address ? <Text style={muted}>{p.address}</Text> : null}
      <Text style={{ fontSize: "14px", margin: "16px 0 0" }}>
        If you need to change this time, {p.companyPhone ? `call us at ${p.companyPhone}` : "reply to this email"}.
      </Text>
      <Text style={muted}>{p.companyName}</Text>
    </Layout>
  );
}

export type TaskDigestProps = { name: string; overdue: { title: string; context: string }[]; today: { title: string; context: string }[]; url: string };

export function TaskDigestEmail(p: TaskDigestProps) {
  const section = (heading: string, items: TaskDigestProps["overdue"], color: string) =>
    items.length ? (
      <Section style={{ margin: "12px 0" }}>
        <Text style={{ fontSize: "14px", fontWeight: 600, color, margin: "0 0 4px" }}>
          {heading} ({items.length})
        </Text>
        {items.map((item, i) => (
          <Text key={i} style={{ fontSize: "14px", margin: "2px 0" }}>
            • {item.title}
            {item.context ? <span style={{ color: "#64748b" }}> · {item.context}</span> : null}
          </Text>
        ))}
      </Section>
    ) : null;
  return (
    <Layout preview={`${p.overdue.length} overdue, ${p.today.length} due today`} title={`Your tasks for today, ${p.name}`}>
      {section("Overdue", p.overdue, "#dc2626")}
      {section("Due today", p.today, "#0f172a")}
      <Section style={{ marginTop: "16px" }}>
        <Button href={p.url} style={button}>
          Open tasks
        </Button>
      </Section>
    </Layout>
  );
}

/** Template registry: retries re-render an email from the props stored in email_log. */
export const EMAIL_TEMPLATES = {
  new_lead: NewLeadEmail,
  duplicate_inquiry: DuplicateInquiryEmail,
  inspection_confirmation: InspectionConfirmationEmail,
  task_digest: TaskDigestEmail,
} as const;

export type EmailTemplate = keyof typeof EMAIL_TEMPLATES;
