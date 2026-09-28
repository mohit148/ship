import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = getSession();

  if (!session) {
    redirect("/api/auth/discord?redirect=/admin");
  }
  if (!session.isAdmin) {
    redirect("/");
  }

  return <>{children}</>;
}
