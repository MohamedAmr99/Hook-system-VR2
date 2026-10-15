import { db } from "@/lib/firebase/config";
import {
  collection,
  doc,
  getDocs,
  query,
  runTransaction,
  where,
  writeBatch,
} from "firebase/firestore";
import type { OrderSettlementUpdate, SettlementLine, SettlementRecord } from "../types/settlement.types";
import { SettlementLineSchema } from "../schemas/settlement.schema";

const LEGACY_COLLECTION = "settlements";
const LINES_COLLECTION = "settlementLines";
const ORDERS_COLLECTION = "orders";

/** Firestore batch limit is 500 writes; keep headroom. */
export const WRITE_CHUNK_SIZE = 450;
/** Firestore `in` filter accepts at most 30 values. */
const IN_QUERY_LIMIT = 30;

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const settlementRepository = {
  /** Legacy TSV records (random ids). Kept for the English flat-file parser. */
  async createBatch(records: Omit<SettlementRecord, "id">[]): Promise<void> {
    const batch = writeBatch(db);
    records.forEach((record) => {
      const docRef = doc(collection(db, LEGACY_COLLECTION));
      batch.set(docRef, { ...record, id: docRef.id });
    });
    await batch.commit();
  },

  /**
   * Idempotent write: each line goes to its deterministic id, so re-importing the same file
   * overwrites the same documents instead of adding new ones. Chunked to stay under the batch limit.
   */
  async upsertLines(lines: readonly SettlementLine[]): Promise<number> {
    for (const part of chunk(lines, WRITE_CHUNK_SIZE)) {
      const batch = writeBatch(db);
      for (const line of part) {
        batch.set(doc(db, LINES_COLLECTION, line.id), line);
      }
      await batch.commit();
    }
    return lines.length;
  },

  /** All stored lines (from any earlier statement) for the given marketplace order ids. */
  async getLinesByOrderIds(platformOrderIds: readonly string[]): Promise<SettlementLine[]> {
    const unique = [...new Set(platformOrderIds.filter(Boolean))];
    const out: SettlementLine[] = [];
    for (const part of chunk(unique, IN_QUERY_LIMIT)) {
      const snap = await getDocs(
        query(collection(db, LINES_COLLECTION), where("platformOrderId", "in", part)),
      );
      for (const d of snap.docs) {
        const parsed = SettlementLineSchema.safeParse({ ...d.data(), id: d.id });
        if (parsed.success) out.push(parsed.data);
      }
    }
    return out;
  },

  /**
   * Writes settlement fields on orders inside transactions (chunked). Only orders that exist in
   * Firestore are updated; missing ids are returned. Touches only financialStatus, actualPayout,
   * settledAt, settlementId and audit fields — never stock or netPayoutExpected.
   */
  async applyOrderSettlements(
    updates: readonly OrderSettlementUpdate[],
    userId: string,
    now: number,
  ): Promise<{ updatedOrderIds: string[]; missingOrderIds: string[] }> {
    const updatedOrderIds: string[] = [];
    const missingOrderIds: string[] = [];
    for (const part of chunk(updates, WRITE_CHUNK_SIZE)) {
      const result = await runTransaction(db, async (tx) => {
        const refs = part.map((u) => doc(db, ORDERS_COLLECTION, u.orderId));
        const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
        const updated: string[] = [];
        const missing: string[] = [];
        part.forEach((u, i) => {
          if (!snaps[i].exists()) {
            missing.push(u.orderId);
            return;
          }
          tx.update(refs[i], {
            financialStatus: u.financialStatus,
            actualPayout: u.actualPayout,
            settledAt: u.settledAt,
            settlementId: u.settlementId,
            updatedAt: now,
            updatedBy: userId,
          });
          updated.push(u.orderId);
        });
        return { updated, missing };
      });
      updatedOrderIds.push(...result.updated);
      missingOrderIds.push(...result.missing);
    }
    return { updatedOrderIds, missingOrderIds };
  },
};
