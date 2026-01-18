export type Pagination = {
  page: number;
  limit: number;
  skip: number;
};

function parsePositiveInt(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n <= 0) return null;
  return n;
}

export function getPagination(
  query: Record<string, unknown>,
  opts?: {
    defaultPage?: number;
    defaultLimit?: number;
    maxLimit?: number;
  }
): Pagination {
  const defaultPage = opts?.defaultPage ?? 1;
  const defaultLimit = opts?.defaultLimit ?? 200;
  const maxLimit = opts?.maxLimit ?? 200;

  const page = parsePositiveInt(query.page) ?? defaultPage;
  const requestedLimit = parsePositiveInt(query.limit) ?? defaultLimit;
  const limit = Math.max(1, Math.min(maxLimit, requestedLimit));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
}
