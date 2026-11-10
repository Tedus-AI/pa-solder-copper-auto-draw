// Output file names: <專案名稱>_<part>_<YYYYMMDD>.<ext>
//   copper coin     → 專案名稱_Copper_Coin_日期
//   solder preform  → 專案名稱_Solder_Preform_日期
//   Layout 綠漆/E-PAD → 專案名稱_Coin_Solder_Masker_日期
// The project name keeps its Chinese text; only characters that Windows and macOS
// do not allow in file names are replaced by "_".

export const PART_FILE_NAMES = {
  copper: 'Copper_Coin',
  preform: 'Solder_Preform',
  layout: 'Coin_Solder_Masker',
  bundle: 'PA_Copper_CAD',
};

/** Local date as YYYYMMDD. */
export function fileDate(date = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}`;
}

/** Project name usable in a file name (never empty). */
export function safeFileStem(name) {
  const stem = String(name ?? '')
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return stem || '未命名專案';
}

/** File name of an output: part is copper, preform, layout or bundle; suffix optional. */
export function outputFileName(projectName, part, extension, { date = new Date(), suffix = '' } = {}) {
  const label = PART_FILE_NAMES[part];
  if (!label) throw new Error(`未知輸出零件：${part}`);
  return `${safeFileStem(projectName)}_${label}_${fileDate(date)}${suffix ? `_${suffix}` : ''}.${extension}`;
}
