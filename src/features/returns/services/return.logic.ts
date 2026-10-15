import type { Return } from "../types/return.types";

/** Prefix of the fake ids fabricated by useReturns for legacy orders that have no doc in `returns`. */
export const PLACEHOLDER_RETURN_PREFIX = "ret-";

export function isPlaceholderReturnId(id: string): boolean {
  return id.startsWith(PLACEHOLDER_RETURN_PREFIX);
}

/**
 * Builds the payload for ReturnService.createReturn from a placeholder plus the user's updates.
 * The fake id and timestamps are dropped so Firestore generates a real id; orderId is kept.
 */
export function buildMaterializePayload(
  placeholder: Return,
  updates: Partial<Return>,
): Omit<Return, "id" | "createdAt" | "updatedAt"> {
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = { ...placeholder, ...updates };
  void _id;
  void _createdAt;
  void _updatedAt;
  return { ...rest, orderId: placeholder.orderId };
}
