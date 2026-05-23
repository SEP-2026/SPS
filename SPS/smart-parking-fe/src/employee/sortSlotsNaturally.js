/**
 * Natural sort for employee slot grids.
 * Uses the same label shown on slot cards: code → slot_number → slot_code.
 */

/** @param {Record<string, unknown> | null | undefined} slot */
export function getEmployeeSlotDisplayLabel(slot) {
  const label = String(slot?.code ?? slot?.slot_number ?? slot?.slot_code ?? "").trim();
  if (label) return label;
  if (slot?.id != null) return `S-${slot.id}`;
  return "";
}

/**
 * @param {string} label
 * @returns {{ prefix: string, number: number, raw: string }}
 */
function parseSlotLabel(label) {
  const raw = String(label || "").trim();
  const upper = raw.toUpperCase();

  const alphaNum = upper.match(/^([A-Z]+)[\s\-_.]*?(\d+)$/);
  if (alphaNum) {
    return {
      prefix: alphaNum[1],
      number: Number.parseInt(alphaNum[2], 10) || 0,
      raw: upper,
    };
  }

  const numPrefix = upper.match(/^(\d+)[\s\-_.]*?([A-Z]+)$/);
  if (numPrefix) {
    return {
      prefix: numPrefix[2],
      number: Number.parseInt(numPrefix[1], 10) || 0,
      raw: upper,
    };
  }

  const digitsOnly = upper.match(/^(\d+)$/);
  if (digitsOnly) {
    return {
      prefix: "",
      number: Number.parseInt(digitsOnly[1], 10) || 0,
      raw: upper,
    };
  }

  return {
    prefix: upper,
    number: Number.MAX_SAFE_INTEGER,
    raw: upper,
  };
}

/** @param {Record<string, unknown> | null | undefined} slot */
function getSortParts(slot) {
  return parseSlotLabel(getEmployeeSlotDisplayLabel(slot));
}

/** @param {Record<string, unknown> | null | undefined} a @param {Record<string, unknown> | null | undefined} b */
export function compareEmployeeSlotsNaturally(a, b) {
  const partsA = getSortParts(a);
  const partsB = getSortParts(b);

  const prefixCmp = partsA.prefix.localeCompare(partsB.prefix, "vi", {
    numeric: true,
    sensitivity: "base",
  });
  if (prefixCmp !== 0) return prefixCmp;

  if (partsA.number !== partsB.number) {
    return partsA.number - partsB.number;
  }

  const labelCmp = partsA.raw.localeCompare(partsB.raw, "vi", {
    numeric: true,
    sensitivity: "base",
  });
  if (labelCmp !== 0) return labelCmp;

  return Number(a?.id || 0) - Number(b?.id || 0);
}

/** Returns a new array; does not mutate the input. */
export function sortSlotsNaturally(slots) {
  if (!Array.isArray(slots) || slots.length === 0) return [];
  if (slots.length === 1) return [...slots];
  return [...slots].sort(compareEmployeeSlotsNaturally);
}
