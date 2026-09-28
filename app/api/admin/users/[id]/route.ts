import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/data/config";
import { devStore } from "@/lib/data/dev-store";
import { getSession } from "@/lib/session";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session?.isAdmin) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }

  const { isAdmin } = await req.json();

  if (isSupabaseConfigured()) {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("users").update({ is_admin: !!isAdmin }).eq("discord_id", params.id);
    if (error) {
      console.error("Failed to update user admin flag", error);
      return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
    }
    await supabase.from("audit_logs").insert({
      actor_id: session.discordId,
      action: isAdmin ? "granted admin" : "revoked admin",
      target_type: "user",
      target_id: params.id,
    });
    return NextResponse.json({ ok: true });
  }

  // Local dev store fallback
  const store = devStore.get();
  const user = store.users.find((u) => u.id === params.id);
  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  const adminUser = { id: session.discordId, username: session.username, displayName: null, avatarUrl: session.avatarUrl };
  devStore.update((s) => {
    const target = s.users.find((u) => u.id === params.id)!;
    target.isAdmin = !!isAdmin;
    s.auditLog.push({
      id: crypto.randomUUID(),
      actor: adminUser,
      action: isAdmin ? "granted admin" : "revoked admin",
      targetType: "user",
      targetId: params.id,
      detail: null,
      createdAt: new Date().toISOString(),
    });
  });

  return NextResponse.json({ ok: true });
}
