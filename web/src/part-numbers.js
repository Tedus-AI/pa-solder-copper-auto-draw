// Part numbers of the two drawn parts (copper coin, solder preform).
//
// A part number has 12 characters: a 10-character base and the 2-digit drawing
// revision (REV), e.g. 348001J400 + 01 = 348001J40001, as on drawing 348001J40001.
// The title block shows the base under PART NO. and the two digits under REV.
// Revisions start at 00. A part number can be locked so it is not edited by
// accident; the lock is saved with the project.

export const PART_NO_BASE_LENGTH = 10;
export const PART_NO_LENGTH = 12;
export const DRAWN_PARTS = ['copper', 'preform'];
export const PART_LABELS = { copper: '銅塊', preform: '錫片' };
// Shown in the title block until a part number is entered.
export const PART_NO_PLACEHOLDER = { copper: '348XXXXXXX', preform: 'XXXXXXXXXX' };
export const REVISIONS = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));

export const emptyPartNumber = () => ({ part_no: '', rev: '00', locked: false });
export const emptyPartNumbers = () => ({ copper: emptyPartNumber(), preform: emptyPartNumber() });

/** Upper-case letters and digits only, at most 10 (what the input field keeps while typing). */
export const cleanPartNo = text =>
  String(text ?? '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .slice(0, PART_NO_BASE_LENGTH);

/** Validated copy of a design's part_numbers; throws Error with a message for the user. */
export function normalizePartNumbers(input) {
  const out = emptyPartNumbers();
  if (input === undefined || input === null) return out;
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('料號資料須為設定物件。');
  for (const key of Object.keys(input)) if (!DRAWN_PARTS.includes(key)) throw new Error(`未知料號零件：${key}`);
  for (const part of DRAWN_PARTS) {
    const value = input[part] ?? {};
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${PART_LABELS[part]}料號須為設定物件。`);
    for (const key of Object.keys(value))
      if (!Object.hasOwn(out[part], key)) throw new Error(`未知料號欄位：${part}.${key}`);
    const entry = { ...out[part], ...value };
    if (typeof entry.part_no !== 'string' || !/^[0-9A-Za-z]{0,10}$/.test(entry.part_no.trim()))
      throw new Error(`${PART_LABELS[part]}料號前 10 碼只能使用英文字母與數字。`);
    entry.part_no = entry.part_no.trim().toUpperCase();
    if (typeof entry.rev !== 'string' || !REVISIONS.includes(entry.rev))
      throw new Error(`${PART_LABELS[part]}料號 REV 須為 00～99 兩位數字。`);
    if (typeof entry.locked !== 'boolean') throw new Error(`${PART_LABELS[part]}料號鎖定狀態無效。`);
    if (entry.locked && entry.part_no.length !== PART_NO_BASE_LENGTH)
      throw new Error(`${PART_LABELS[part]}料號須填滿 10 碼才能鎖定。`);
    out[part] = entry;
  }
  return out;
}

/** The full 12-character part number, or '' while the base is incomplete. */
export function fullPartNumber(entry) {
  return entry?.part_no?.length === PART_NO_BASE_LENGTH ? entry.part_no + entry.rev : '';
}

/**
 * Title block values for a part: PART NO. (10-character base, or the placeholder
 * when empty) and REV. An incomplete base cannot be drawn.
 */
export function titleBlockPartNumber(design, part) {
  const entry = design?.part_numbers?.[part] ?? emptyPartNumber();
  if (entry.part_no && entry.part_no.length !== PART_NO_BASE_LENGTH)
    throw new Error(
      `${PART_LABELS[part]}料號前 10 碼尚未填完（目前 ${entry.part_no.length} 碼）；料號共 12 碼＝前 10 碼＋REV 2 碼。`,
    );
  return { partNo: entry.part_no || PART_NO_PLACEHOLDER[part], rev: entry.rev, full: fullPartNumber(entry) };
}
