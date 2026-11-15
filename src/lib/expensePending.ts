/**
 * Misch-Logik für hängende (offline erfasste/gelöschte) Ausgaben-Zeilen.
 * Phase 5b, Muster wie pendingItems in useListData (Phase 4): die States
 * `expenses`/`expenseSplits` bleiben frei von Temp-IDs und Tombstones — ein
 * elternseitiger Refetch (der offline aus dem Read-Cache kommt) darf Temp-Zeilen
 * bzw. gelöschte Zeilen nicht zurückbringen. Der Merge passiert erst am
 * Rückgabe-Objekt.
 */

/**
 * Hängende Zeilen VORNE anfügen — eine frisch erfasste Ausgabe steht oben.
 * Bei gleicher `id` gewinnt die echte Zeile (Server-Wahrheit): nötig am
 * Übergang, wenn der Flush die Serverzeile geliefert hat, der pending-State
 * noch die Temp-Zeile hält. Reine Funktion — kein Mutation.
 */
export function mergePending<T extends { id: string }>(real: T[], pending: T[]): T[] {
  if (pending.length === 0) return real
  const realIds = new Set(real.map((r) => r.id))
  const fresh = pending.filter((p) => !realIds.has(p.id))
  return fresh.length === 0 ? real : [...fresh, ...real]
}

/**
 * Offline gelöschte echte Zeilen (id-Tombstones) herausfiltern: ein
 * offline-Refetch fällt auf den Read-Cache zurück, der die gelöschte Zeile
 * noch enthält — solange der Delete-Op in der Queue steht, darf sie
 * nicht wieder auftauchen.
 */
export function dropRemoved<T extends { id: string }>(rows: T[], removedIds: ReadonlySet<string>): T[] {
  if (removedIds.size === 0) return rows
  return rows.filter((r) => !removedIds.has(r.id))
}

/**
 * Splits einer offline gelöschten Ausgabe anhand `expense_id` herausfiltern —
 * sonst blieben verwaiste Anteile in den Salden hängen, obwohl die Ausgabe
 * (Temp- oder Tombstone) schon weg ist.
 */
export function dropSplitsOfRemoved<T extends { expense_id: string }>(
  splits: T[],
  removedIds: ReadonlySet<string>,
): T[] {
  if (removedIds.size === 0) return splits
  return splits.filter((s) => !removedIds.has(s.expense_id))
}
