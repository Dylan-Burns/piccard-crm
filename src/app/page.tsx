import { redirect } from "next/navigation";
import { getSessionState, homeFor } from "@/lib/auth";

export default async function RootPage() {
  const state = await getSessionState();
  if (state.status === "anonymous") redirect("/login");
  if (state.status === "inactive") redirect("/auth/signout?reason=deactivated");
  redirect(homeFor(state.profile.role));
}
