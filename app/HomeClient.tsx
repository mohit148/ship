"use client";

import { useMemo, useState } from "react";
import type { Ship, ShipStatus } from "@/types";
import { SearchBar } from "@/components/SearchBar";
import { StatusFilters } from "@/components/StatusFilters";
import { ShipTable } from "@/components/ShipTable";
import { Pagination } from "@/components/Pagination";
import { Button } from "@/components/Button";

const PAGE_SIZE = 10;

export function HomeClient({ initialShips }: { initialShips: Ship[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<ShipStatus | "all">("confirmed");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialShips.filter((ship) => {
      if (status !== "all" && ship.status !== status) return false;
      if (!q) return true;
      return (
        ship.userA.username.toLowerCase().includes(q) ||
        ship.userB.username.toLowerCase().includes(q) ||
        (ship.userA.displayName ?? "").toLowerCase().includes(q) ||
        (ship.userB.displayName ?? "").toLowerCase().includes(q) ||
        String(ship.number).includes(q)
      );
    });
  }, [initialShips, query, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageShips = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <SearchBar value={query} onChange={(v) => { setQuery(v); setPage(1); }} />
        <Button href="/create">+ Create Ship</Button>
      </div>

      <StatusFilters
        value={status}
        onChange={(v) => {
          setStatus(v);
          setPage(1);
        }}
      />

      <ShipTable ships={pageShips} />

      <Pagination page={page} totalPages={totalPages} onChange={setPage} />
    </div>
  );
}
