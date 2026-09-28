"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "./Avatar";
import { resizeToSquareDataUrl } from "@/lib/image-resize";

/**
 * A person's avatar on a card. Only the owner of *this* avatar ever gets
 * `canEdit` — hovering it (or tapping it, on touch screens) reveals a small
 * pencil that opens the device's photo picker. Their partner's avatar never
 * gets one. A PFP is a personal change, so it applies immediately: no
 * request, no approval.
 */
export function EditableAvatar({
  src,
  alt,
  size,
  canEdit,
  ringClass,
}: {
  src: string | null;
  alt: string;
  size: number;
  canEdit: boolean;
  ringClass?: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) {
    return <Avatar src={src} alt={alt} size={size} ringClass={ringClass} />;
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const avatarData = await resizeToSquareDataUrl(file);
      const res = await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarData }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Couldn't save that picture.");
      }
      setRevealed(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that picture.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="group pointer-events-auto relative"
      onClick={(e) => {
        // Stops the tap from also following the card's link; on touch
        // screens this is what reveals the pencil.
        e.preventDefault();
        e.stopPropagation();
        setRevealed((r) => !r);
      }}
    >
      <div className={busy ? "opacity-60" : ""}>
        <Avatar src={src} alt={alt} size={size} ringClass={ringClass} />
      </div>
      <button
        type="button"
        aria-label="Change your picture"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          inputRef.current?.click();
        }}
        className={`absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-white text-ink shadow-soft transition-opacity focus-visible:opacity-100 group-hover:opacity-100 ${
          revealed || busy ? "opacity-100" : "opacity-0"
        }`}
      >
        {busy ? (
          <span className="text-[10px]">…</span>
        ) : (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onPick} />
      {error && (
        <p className="absolute left-1/2 top-full z-30 mt-1 w-40 -translate-x-1/2 rounded bg-white px-2 py-1 text-center text-[11px] text-blossom-600 shadow-soft">
          {error}
        </p>
      )}
    </div>
  );
}
