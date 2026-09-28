import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/data/config";
import { devStore } from "@/lib/data/dev-store";
import { backgroundImageUrl } from "@/lib/data/backgrounds";
import { getSession } from "@/lib/session";
import { BIO_MAX_LENGTH } from "@/types";

const SHIP_SELECT = "*, user_a:users!ships_user_a_id_fkey(*), user_b:users!ships_user_b_id_fkey(*)";

type Session = NonNullable<ReturnType<typeof getSession>>;

type PatchBody = {
  status?: string;
  customText?: string;
  backgroundId?: string;
  // Explicit accept/decline of a proposal that's already pending — used by
  // the Requests page. Proposing a change is just PATCHing customText /
  // backgroundId (see ShipCustomText.tsx / ShipBackgroundPicker.tsx).
  field?: "bio" | "background";
  action?: "accept" | "decline";
};

const FIELD_COLUMNS = {
  bio: { value: "custom_text", pending: "custom_text_pending", proposedBy: "custom_text_proposed_by" },
  background: { value: "background_id", pending: "background_pending", proposedBy: "background_proposed_by" },
} as const;

const FIELD_LABEL = { bio: "bio", background: "background" } as const;
const HISTORY_ACTION = { bio: "text_updated", background: "background_updated" } as const;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (isSupabaseConfigured()) {
    const supabase = createClient();
    const { data: ship, error } = await supabase.from("ships").select(SHIP_SELECT).eq("id", params.id).single();
    if (!error && ship) {
      const { data: history } = await supabase
        .from("ship_history")
        .select("*, actor:users(*)")
        .eq("ship_id", params.id)
        .order("created_at", { ascending: false });
      return NextResponse.json({ ship, history: history ?? [] });
    }
  }

  const store = devStore.get();
  const ship = store.ships.find((s) => s.id === params.id);
  if (!ship) return NextResponse.json({ error: "Ship not found." }, { status: 404 });
  return NextResponse.json({ ship, history: store.history[ship.id] ?? [] });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = getSession();
  if (!session) {
    return NextResponse.json({ error: "Log in with Discord first." }, { status: 401 });
  }

  const body: PatchBody = await req.json();

  // Validate what's being proposed before touching anything.
  if (typeof body.customText === "string" && body.customText.length > BIO_MAX_LENGTH) {
    return NextResponse.json({ error: `Bios can be up to ${BIO_MAX_LENGTH} characters.` }, { status: 400 });
  }

  if (isSupabaseConfigured()) {
    return patchViaSupabase(params.id, body, session);
  }
  return patchViaDevStore(params.id, body, session);
}

async function patchViaSupabase(shipId: string, body: PatchBody, session: Session) {
  const supabase = createServiceRoleClient();

  const { data: ship, error: fetchError } = await supabase.from("ships").select("*").eq("id", shipId).single();
  if (fetchError || !ship) {
    return NextResponse.json({ error: "Ship not found." }, { status: 404 });
  }

  const isParticipant = session.discordId === ship.user_a_id || session.discordId === ship.user_b_id;
  if (!isParticipant && !session.isAdmin) {
    return NextResponse.json({ error: "You're not part of this ship." }, { status: 403 });
  }

  // --- Accept / decline a pending proposal (Requests page) ---
  if (body.field && body.action) {
    if (!ship.is_two_auth || !isParticipant) {
      return NextResponse.json({ error: "Only the two people in this ship can respond to that." }, { status: 403 });
    }
    const cols = FIELD_COLUMNS[body.field];
    if (!cols) return NextResponse.json({ error: "Unknown change." }, { status: 400 });
    const pendingValue = ship[cols.pending];
    if (pendingValue === null || pendingValue === undefined) {
      return NextResponse.json({ error: "There's nothing pending to respond to." }, { status: 400 });
    }
    if (ship[cols.proposedBy] === session.discordId) {
      return NextResponse.json({ error: "You proposed this — wait for the other person to respond." }, { status: 403 });
    }

    const label = FIELD_LABEL[body.field];
    if (body.action === "accept") {
      await supabase
        .from("ships")
        .update({ [cols.value]: pendingValue, [cols.pending]: null, [cols.proposedBy]: null, updated_by: session.discordId })
        .eq("id", shipId);
    } else {
      await supabase.from("ships").update({ [cols.pending]: null, [cols.proposedBy]: null }).eq("id", shipId);
    }
    await supabase.from("ship_history").insert({
      ship_id: shipId,
      action: HISTORY_ACTION[body.field],
      actor_id: session.discordId,
      note: `${body.action === "accept" ? "Accepted" : "Declined"} the proposed ${label} change`,
    });
    return NextResponse.json({ ok: true, status: body.action === "accept" ? "confirmed" : "declined" });
  }

  // --- Ending a ship ---
  if (body.status === "ended") {
    if (!ship.is_two_auth && !session.isAdmin) {
      return NextResponse.json({ error: "Only an admin can end an admin-created ship." }, { status: 403 });
    }
    await supabase
      .from("ships")
      .update({ status: "ended", ended_at: new Date().toISOString(), updated_by: session.discordId })
      .eq("id", shipId);
    await supabase.from("ship_history").insert({
      ship_id: shipId,
      action: "ended",
      actor_id: session.discordId,
      note: `Ended by ${session.displayName || session.username}`,
    });
    return NextResponse.json({ ok: true });
  }

  // --- Proposing (or, for admin-created ships, directly setting) a bio / background ---
  if (typeof body.customText === "string" || typeof body.backgroundId === "string") {
    const field: "bio" | "background" = typeof body.customText === "string" ? "bio" : "background";
    const cols = FIELD_COLUMNS[field];
    const value = field === "bio" ? body.customText! : body.backgroundId!;
    const label = FIELD_LABEL[field];

    if (field === "background") {
      const { data: exists } = await supabase.from("backgrounds").select("id").eq("id", value).maybeSingle();
      if (!exists) {
        return NextResponse.json({ error: "Pick a background from the catalog." }, { status: 400 });
      }
    }

    // Admin-created ships: the people on them have no accounts to approve
    // anything, so an admin edits the card directly.
    if (!ship.is_two_auth) {
      if (!session.isAdmin) {
        return NextResponse.json({ error: "Only an admin can change this card." }, { status: 403 });
      }
      await supabase
        .from("ships")
        .update({ [cols.value]: value, [cols.pending]: null, [cols.proposedBy]: null, updated_by: session.discordId })
        .eq("id", shipId);
      await supabase.from("ship_history").insert({
        ship_id: shipId,
        action: HISTORY_ACTION[field],
        actor_id: session.discordId,
        note: `Admin updated the ${label}`,
      });
      await supabase.from("audit_logs").insert({
        actor_id: session.discordId,
        action: `updated ship ${label}`,
        target_type: "ship",
        target_id: shipId,
      });
      return NextResponse.json({ ok: true, status: "updated" });
    }

    if (!isParticipant) {
      return NextResponse.json({ error: "Only the two people in this ship can change its card." }, { status: 403 });
    }
    const pending = ship[cols.pending];
    if (pending !== null && pending !== undefined && ship[cols.proposedBy] !== session.discordId) {
      return NextResponse.json(
        { error: `The other person already proposed a ${label} change — respond to it in Requests first.` },
        { status: 409 }
      );
    }

    await supabase
      .from("ships")
      .update({ [cols.pending]: value, [cols.proposedBy]: session.discordId })
      .eq("id", shipId);
    await supabase.from("ship_history").insert({
      ship_id: shipId,
      action: HISTORY_ACTION[field],
      actor_id: session.discordId,
      note: `Proposed a new ${label}, waiting on the other person`,
    });
    return NextResponse.json({ ok: true, status: "awaiting_confirmation" });
  }

  // --- Admin status change ---
  if (body.status) {
    if (!session.isAdmin) {
      return NextResponse.json({ error: "Admins only." }, { status: 403 });
    }
    await supabase.from("ships").update({ status: body.status, updated_by: session.discordId }).eq("id", shipId);
    await supabase.from("ship_history").insert({
      ship_id: shipId,
      action: "status_changed",
      actor_id: session.discordId,
      note: `Set to ${body.status} by admin`,
    });
    await supabase.from("audit_logs").insert({
      actor_id: session.discordId,
      action: `set ship status to ${body.status}`,
      target_type: "ship",
      target_id: shipId,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
}

function patchViaDevStore(shipId: string, body: PatchBody, session: Session) {
  const store = devStore.get();
  const ship = store.ships.find((s) => s.id === shipId);
  if (!ship) {
    return NextResponse.json({ error: "Ship not found." }, { status: 404 });
  }

  const isParticipant = session.discordId === ship.userA.id || session.discordId === ship.userB.id;
  if (!isParticipant && !session.isAdmin) {
    return NextResponse.json({ error: "You're not part of this ship." }, { status: 403 });
  }

  const actor = {
    id: session.discordId,
    username: session.username,
    displayName: session.displayName ?? null,
    avatarUrl: session.avatarUrl,
  };

  const KEYS = {
    bio: { value: "customText", pending: "customTextPending", proposedBy: "customTextProposedBy" },
    background: { value: "background", pending: "backgroundPending", proposedBy: "backgroundProposedBy" },
  } as const;

  // --- Accept / decline a pending proposal ---
  if (body.field && body.action) {
    if (!ship.isTwoAuth || !isParticipant) {
      return NextResponse.json({ error: "Only the two people in this ship can respond to that." }, { status: 403 });
    }
    const keys = KEYS[body.field];
    if (!keys) return NextResponse.json({ error: "Unknown change." }, { status: 400 });
    const pendingValue = (ship as any)[keys.pending];
    if (pendingValue === null || pendingValue === undefined) {
      return NextResponse.json({ error: "There's nothing pending to respond to." }, { status: 400 });
    }
    if ((ship as any)[keys.proposedBy]?.id === session.discordId) {
      return NextResponse.json({ error: "You proposed this — wait for the other person to respond." }, { status: 403 });
    }

    const now = new Date().toISOString();
    devStore.update((s) => {
      const target: any = s.ships.find((x) => x.id === shipId)!;
      if (body.action === "accept") {
        target[keys.value] = pendingValue;
        target.updatedBy = actor;
      }
      target[keys.pending] = null;
      target[keys.proposedBy] = null;
      target.updatedAt = now;
      (s.history[shipId] ??= []).push({
        id: crypto.randomUUID(),
        shipId,
        action: HISTORY_ACTION[body.field!],
        actor,
        note: `${body.action === "accept" ? "Accepted" : "Declined"} the proposed ${FIELD_LABEL[body.field!]} change`,
        createdAt: now,
      });
    });
    return NextResponse.json({ ok: true, status: body.action === "accept" ? "confirmed" : "declined" });
  }

  // --- Ending a ship ---
  if (body.status === "ended") {
    if (!ship.isTwoAuth && !session.isAdmin) {
      return NextResponse.json({ error: "Only an admin can end an admin-created ship." }, { status: 403 });
    }
    const now = new Date().toISOString();
    devStore.update((s) => {
      const target = s.ships.find((x) => x.id === shipId)!;
      target.status = "ended";
      target.endedAt = now;
      target.updatedAt = now;
      (s.history[shipId] ??= []).push({
        id: crypto.randomUUID(),
        shipId,
        action: "ended",
        actor,
        note: `Ended by ${session.displayName || session.username}`,
        createdAt: now,
      });
    });
    return NextResponse.json({ ok: true });
  }

  // --- Proposing (or, for admin-created ships, directly setting) a bio / background ---
  if (typeof body.customText === "string" || typeof body.backgroundId === "string") {
    const field: "bio" | "background" = typeof body.customText === "string" ? "bio" : "background";
    const keys = KEYS[field];
    const label = FIELD_LABEL[field];

    let value: unknown = body.customText;
    if (field === "background") {
      const entry = store.backgrounds.find((b) => b.id === body.backgroundId);
      if (!entry) {
        return NextResponse.json({ error: "Pick a background from the catalog." }, { status: 400 });
      }
      value = { id: entry.id, name: entry.name, imageUrl: backgroundImageUrl(entry.id), createdAt: entry.createdAt };
    }

    const now = new Date().toISOString();

    if (!ship.isTwoAuth) {
      if (!session.isAdmin) {
        return NextResponse.json({ error: "Only an admin can change this card." }, { status: 403 });
      }
      devStore.update((s) => {
        const target: any = s.ships.find((x) => x.id === shipId)!;
        target[keys.value] = value;
        target[keys.pending] = null;
        target[keys.proposedBy] = null;
        target.updatedAt = now;
        target.updatedBy = actor;
        (s.history[shipId] ??= []).push({
          id: crypto.randomUUID(),
          shipId,
          action: HISTORY_ACTION[field],
          actor,
          note: `Admin updated the ${label}`,
          createdAt: now,
        });
        s.auditLog.push({
          id: crypto.randomUUID(),
          actor,
          action: `updated ship ${label}`,
          targetType: "ship",
          targetId: shipId,
          detail: null,
          createdAt: now,
        });
      });
      return NextResponse.json({ ok: true, status: "updated" });
    }

    if (!isParticipant) {
      return NextResponse.json({ error: "Only the two people in this ship can change its card." }, { status: 403 });
    }
    const existingPending = (ship as any)[keys.pending];
    if (existingPending !== null && existingPending !== undefined && (ship as any)[keys.proposedBy]?.id !== session.discordId) {
      return NextResponse.json(
        { error: `The other person already proposed a ${label} change — respond to it in Requests first.` },
        { status: 409 }
      );
    }

    devStore.update((s) => {
      const target: any = s.ships.find((x) => x.id === shipId)!;
      target[keys.pending] = value;
      target[keys.proposedBy] = actor;
      (s.history[shipId] ??= []).push({
        id: crypto.randomUUID(),
        shipId,
        action: HISTORY_ACTION[field],
        actor,
        note: `Proposed a new ${label}, waiting on the other person`,
        createdAt: now,
      });
    });
    return NextResponse.json({ ok: true, status: "awaiting_confirmation" });
  }

  // --- Admin status change ---
  if (body.status) {
    if (!session.isAdmin) {
      return NextResponse.json({ error: "Admins only." }, { status: 403 });
    }
    const now = new Date().toISOString();
    devStore.update((s) => {
      const target = s.ships.find((x) => x.id === shipId)!;
      target.status = body.status as typeof target.status;
      target.updatedAt = now;
      (s.history[shipId] ??= []).push({
        id: crypto.randomUUID(),
        shipId,
        action: "status_changed",
        actor,
        note: `Set to ${body.status} by admin`,
        createdAt: now,
      });
      s.auditLog.push({
        id: crypto.randomUUID(),
        actor,
        action: `set ship status to ${body.status}`,
        targetType: "ship",
        targetId: shipId,
        detail: null,
        createdAt: now,
      });
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
}
