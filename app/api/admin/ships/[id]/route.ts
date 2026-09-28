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

  const { status } = await req.json();
  const validStatuses = ["confirmed", "pending", "ended", "archived"];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: "Invalid status." }, { status: 400 });
  }

  if (isSupabaseConfigured()) {
    const supabase = createServiceRoleClient();
    const patch: Record<string, unknown> = { status, updated_by: session.discordId };
    if (status === "ended") patch.ended_at = new Date().toISOString();

    const { error } = await supabase.from("ships").update(patch).eq("id", params.id);
    if (error) {
      console.error("Failed to update ship status", error);
      return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
    }

    await supabase.from("ship_history").insert({
      ship_id: params.id,
      action: status === "archived" ? "archived" : "status_changed",
      actor_id: session.discordId,
      note: `Set to ${status} by admin ${session.username}`,
    });
    await supabase.from("audit_logs").insert({
      actor_id: session.discordId,
      action: `set ship status to ${status}`,
      target_type: "ship",
      target_id: params.id,
    });

    return NextResponse.json({ ok: true });
  }

  // Local dev store fallback
  const store = devStore.get();
  const ship = store.ships.find((s) => s.id === params.id);
  if (!ship) {
    return NextResponse.json({ error: "Ship not found." }, { status: 404 });
  }

  const now = new Date().toISOString();
  const adminUser = { id: session.discordId, username: session.username, displayName: null, avatarUrl: session.avatarUrl };

  devStore.update((s) => {
    const target = s.ships.find((x) => x.id === params.id)!;
    target.status = status;
    target.updatedAt = now;
    if (status === "ended") target.endedAt = now;
    (s.history[params.id] ??= []).push({
      id: crypto.randomUUID(),
      shipId: params.id,
      action: status === "archived" ? "archived" : "status_changed",
      actor: adminUser,
      note: `Set to ${status} by admin ${session.username}`,
      createdAt: now,
    });
    s.auditLog.push({
      id: crypto.randomUUID(),
      actor: adminUser,
      action: `set ship status to ${status}`,
      targetType: "ship",
      targetId: params.id,
      detail: null,
      createdAt: now,
    });
  });

  return NextResponse.json({ ok: true });
}
