import Link from "next/link";
import type { Ship } from "@/types";
import { Avatar } from "./Avatar";
import { StatusBadge } from "./StatusBadge";
import { formatShortDate } from "@/lib/dates";
import { displayNameOf } from "@/lib/user-display";

export function ShipTable({ ships }: { ships: Ship[] }) {
  if (ships.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-white">
      {/* Desktop table */}
      <table className="hidden w-full text-sm md:table">
        <thead>
          <tr className="border-b border-border text-left text-xs text-ink-faint">
            <th className="w-16 px-4 py-3 font-medium">#</th>
            <th className="px-4 py-3 font-medium">Ship</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Shipped Date</th>
          </tr>
        </thead>
        <tbody>
          {ships.map((ship) => (
            <tr key={ship.id} className="table-row-hover border-b border-border last:border-0">
              <td className="px-4 py-3 text-ink-faint">{ship.number}</td>
              <td className="px-4 py-3">
                <Link href={`/ships/${ship.id}`} className="flex items-center gap-2 hover:opacity-80">
                  <Avatar src={ship.userA.avatarUrl} alt={displayNameOf(ship.userA)} size={24} />
                  <span className="text-ink-faint">×</span>
                  <Avatar src={ship.userB.avatarUrl} alt={displayNameOf(ship.userB)} size={24} />
                  <span className="ml-1 font-medium text-ink">
                    {displayNameOf(ship.userA)} × {displayNameOf(ship.userB)}
                  </span>
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={ship.status} />
              </td>
              <td className="px-4 py-3 text-ink-soft">{formatShortDate(ship.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile cards */}
      <ul className="divide-y divide-border md:hidden">
        {ships.map((ship) => (
          <li key={ship.id}>
            <Link href={`/ships/${ship.id}`} className="flex flex-col gap-2 px-4 py-3 active:bg-cream-100">
              <div className="flex items-center justify-between">
                <span className="text-xs text-ink-faint">#{ship.number}</span>
                <StatusBadge status={ship.status} />
              </div>
              <div className="flex items-center gap-2">
                <Avatar src={ship.userA.avatarUrl} alt={displayNameOf(ship.userA)} size={28} />
                <Avatar src={ship.userB.avatarUrl} alt={displayNameOf(ship.userB)} size={28} />
                <span className="font-medium text-ink">
                  {displayNameOf(ship.userA)} × {displayNameOf(ship.userB)}
                </span>
              </div>
              <div className="text-xs text-ink-faint">Shipped {formatShortDate(ship.createdAt)}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-white px-6 py-16 text-center">
      <p className="text-sm font-medium text-ink">No ships here yet</p>
      <p className="text-sm text-ink-faint">Try a different filter, or create the first one.</p>
    </div>
  );
}
