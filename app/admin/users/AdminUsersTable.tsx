"use client";

import { useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { SearchBar } from "@/components/SearchBar";
import type { DiscordUser } from "@/types";
import { displayNameOf } from "@/lib/user-display";

export function AdminUsersTable({ users }: { users: DiscordUser[] }) {
  const [query, setQuery] = useState("");
  const [admins, setAdmins] = useState<Set<string>>(
    () => new Set(users.filter((u) => u.isAdmin).map((u) => u.id))
  );
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => users.filter((u) => u.username.toLowerCase().includes(query.trim().toLowerCase())),
    [users, query]
  );

  async function toggleAdmin(user: DiscordUser) {
    setPending(user.id);
    setError(null);
    const makeAdmin = !admins.has(user.id);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isAdmin: makeAdmin }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `Failed (${res.status}) for ${user.username}. Check the server console.`);
        return;
      }

      setAdmins((prev) => {
        const next = new Set(prev);
        if (makeAdmin) next.add(user.id);
        else next.delete(user.id);
        return next;
      });
    } catch {
      setError("Network error — is the server running?");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <SearchBar value={query} onChange={setQuery} placeholder="Search users..." />
      {error && <p className="text-xs text-blossom-600">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-ink-faint">
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">Discord ID</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((user) => {
              const isAdmin = admins.has(user.id);
              return (
                <tr key={user.id} className="table-row-hover border-b border-border last:border-0">
                  <td className="flex items-center gap-2.5 px-4 py-3">
                    <Avatar src={user.avatarUrl} alt={displayNameOf(user)} size={26} />
                    {displayNameOf(user)}
                    {user.displayName && <span className="text-xs font-normal text-ink-faint">@{user.username}</span>}
                  </td>
                  <td className="px-4 py-3 text-ink-faint">{user.id}</td>
                  <td className="px-4 py-3 text-ink-soft">{isAdmin ? "Admin" : "Member"}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleAdmin(user)}
                      disabled={pending === user.id}
                      className="text-xs font-medium text-lavender-600 hover:underline disabled:opacity-50"
                    >
                      {isAdmin ? "Remove admin" : "Make admin"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
