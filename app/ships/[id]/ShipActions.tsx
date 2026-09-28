"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type { ShipStatus } from "@/types";

export function ShipActions({ shipId, currentStatus }: { shipId: string; currentStatus: ShipStatus }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  if (currentStatus === "ended" || currentStatus === "archived") return null;

  async function handleEnd() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/ships/${shipId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ended" }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed (${res.status}). Check the server console for details.`);
        return;
      }

      setConfirmOpen(false);
      router.refresh();
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col items-center gap-1.5">
      <Button variant="danger" onClick={() => setConfirmOpen(true)}>
        End this ship
      </Button>
      {error && <p className="text-xs text-blossom-600">{error}</p>}
      <ConfirmDialog
        open={confirmOpen}
        title="End this ship?"
        description="This moves the ship to Ended. Its history stays visible in the archive — nothing gets deleted."
        confirmLabel={submitting ? "Ending…" : "End ship"}
        variant="danger"
        onConfirm={handleEnd}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
