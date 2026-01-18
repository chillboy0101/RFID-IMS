export type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

type StringOpts = {
  field?: string;
  required?: boolean;
  trim?: boolean;
  minLen?: number;
  maxLen?: number;
  lower?: boolean;
};

export function asString(raw: unknown, opts: StringOpts & { required: true }): ValidationResult<string>;
export function asString(raw: unknown, opts?: StringOpts): ValidationResult<string | undefined>;
export function asString(raw: unknown, opts?: StringOpts): ValidationResult<string | undefined> {
  const field = opts?.field ?? "value";
  const required = opts?.required ?? false;
  if (raw === undefined || raw === null) {
    if (required) return fail(`${field} is required`);
    return { ok: true, value: undefined };
  }

  if (typeof raw !== "string") {
    return fail(`${field} must be a string`);
  }

  let s = raw;
  if (opts?.trim) s = s.trim();
  if (opts?.lower) s = s.toLowerCase();

  if (required && !s) return fail(`${field} is required`);
  if (opts?.minLen !== undefined && s.length < opts.minLen) return fail(`${field} is too short`);
  if (opts?.maxLen !== undefined && s.length > opts.maxLen) return fail(`${field} is too long`);

  return { ok: true, value: s };
}

type NumberOpts = {
  field?: string;
  required?: boolean;
  integer?: boolean;
  min?: number;
  max?: number;
};

export function asNumber(raw: unknown, opts: NumberOpts & { required: true }): ValidationResult<number>;
export function asNumber(raw: unknown, opts?: NumberOpts): ValidationResult<number | undefined>;
export function asNumber(raw: unknown, opts?: NumberOpts): ValidationResult<number | undefined> {
  const field = opts?.field ?? "value";
  const required = opts?.required ?? false;

  if (raw === undefined || raw === null) {
    if (required) return fail(`${field} is required`);
    return { ok: true, value: undefined };
  }

  if (typeof raw !== "number" || !Number.isFinite(raw)) {
    return fail(`${field} must be a number`);
  }

  if (opts?.integer && !Number.isInteger(raw)) return fail(`${field} must be an integer`);
  if (opts?.min !== undefined && raw < opts.min) return fail(`${field} must be >= ${opts.min}`);
  if (opts?.max !== undefined && raw > opts.max) return fail(`${field} must be <= ${opts.max}`);

  return { ok: true, value: raw };
}

export function asBoolean(
  raw: unknown,
  opts?: {
    field?: string;
    required?: boolean;
  }
): ValidationResult<boolean | undefined> {
  const field = opts?.field ?? "value";
  const required = opts?.required ?? false;

  if (raw === undefined || raw === null) {
    if (required) return fail(`${field} is required`);
    return { ok: true, value: undefined };
  }

  if (typeof raw !== "boolean") return fail(`${field} must be a boolean`);
  return { ok: true, value: raw };
}

export function asEnum<T extends readonly string[]>(
  raw: unknown,
  allowed: T,
  opts?: {
    field?: string;
    required?: boolean;
  }
): ValidationResult<T[number] | undefined> {
  const field = opts?.field ?? "value";
  const required = opts?.required ?? false;

  if (raw === undefined || raw === null) {
    if (required) return fail(`${field} is required`);
    return { ok: true, value: undefined };
  }

  if (typeof raw !== "string") return fail(`${field} must be a string`);
  if (!allowed.includes(raw)) return fail(`${field} is invalid`);
  return { ok: true, value: raw as T[number] };
}

export function asEnumRequired<T extends readonly string[]>(
  raw: unknown,
  allowed: T,
  opts: { field?: string; required: true }
): ValidationResult<T[number]> {
  return asEnum(raw, allowed, opts) as ValidationResult<T[number]>;
}

type ObjectIdOpts = { field?: string; required?: boolean };

export function asObjectId(raw: unknown, opts: ObjectIdOpts & { required: true }): ValidationResult<string>;
export function asObjectId(raw: unknown, opts?: ObjectIdOpts): ValidationResult<string | undefined>;
export function asObjectId(raw: unknown, opts?: ObjectIdOpts): ValidationResult<string | undefined> {
  const field = opts?.field ?? "value";
  const required = opts?.required ?? false;

  if (raw === undefined || raw === null) {
    if (required) return fail(`${field} is required`);
    return { ok: true, value: undefined };
  }

  if (typeof raw !== "string") return fail(`${field} must be a string`);
  const v = raw.trim();
  if (!v) {
    if (required) return fail(`${field} is required`);
    return { ok: true, value: undefined };
  }

  if (!/^[a-fA-F0-9]{24}$/.test(v)) return fail(`${field} is invalid`);
  return { ok: true, value: v };
}

type DateOpts = { field?: string; required?: boolean };

export function asDateFromString(raw: unknown, opts: DateOpts & { required: true }): ValidationResult<Date>;
export function asDateFromString(raw: unknown, opts?: DateOpts): ValidationResult<Date | undefined>;
export function asDateFromString(raw: unknown, opts?: DateOpts): ValidationResult<Date | undefined> {
  const field = opts?.field ?? "value";
  const required = opts?.required ?? false;

  if (raw === undefined || raw === null) {
    if (required) return fail(`${field} is required`);
    return { ok: true, value: undefined };
  }

  if (typeof raw !== "string") return fail(`${field} must be a string`);
  const v = raw.trim();
  if (!v) {
    if (required) return fail(`${field} is required`);
    return { ok: true, value: undefined };
  }

  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return fail(`${field} is invalid`);
  return { ok: true, value: d };
}
