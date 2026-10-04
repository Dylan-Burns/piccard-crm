import { renderToBuffer } from "@react-pdf/renderer";
import { NextResponse } from "next/server";
import { loadEstimateDocumentData } from "@/features/estimates/pdf/data";
import { loadLogo } from "@/features/estimates/pdf/logo";
import { EstimateDocument } from "@/features/estimates/pdf/EstimateDocument";
import { currentProfileWithRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Renders the estimate PDF on demand for preview and download. Staff only; field users never see prices. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await currentProfileWithRole("admin", "sales"))) return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: settings } = await supabase.from("company_settings").select("logo_path").maybeSingle();
  const data = await loadEstimateDocumentData(supabase, id, await loadLogo(settings?.logo_path ?? null));
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pdf = await renderToBuffer(<EstimateDocument data={data} />);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Estimate-${data.estimate.label}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
