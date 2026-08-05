// Reading a filled-in spreadsheet, in the browser, with nothing installed.
//
// Fifty locations are sent one template, they fill it in and send it back, and
// whoever receives it uploads the file rather than typing forty accounts one at a
// time. Half of those files will come back as .csv because that is what was sent
// out, and half as .xlsx because Excel offers to save that way — so both are read
// here. Nothing is uploaded to make that happen: an xlsx is a zip of XML, and the
// platform can already unzip (DecompressionStream) and parse XML.
//
// Everything returns rows of plain strings. Meaning — which column is a username,
// which role names are real — belongs to the page that asked, not here.

const decoder = new TextDecoder();

// A cell can carry a comma, a quote or a line break, so values are quoted and
// inner quotes doubled — the same rules Excel writes and reads.
export function toCsv(rows) {
  return rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
}

export function downloadFile(name, text, type = 'text/csv;charset=utf-8') {
  const link = document.createElement('a');
  // The BOM is what makes Excel open a UTF-8 CSV as UTF-8 rather than as the
  // system code page, which is the difference between "Mississauga" and mojibake.
  link.href = URL.createObjectURL(new Blob([type.startsWith('text/csv') ? '﻿' : '', text], { type }));
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Excel in some regions writes semicolons rather than commas, and a tab-separated
// file is what you get from pasting out of a sheet. Take the separator from the
// header line rather than assuming one and reading every row as a single cell.
function detectDelimiter(line) {
  const best = [',', ';', '\t']
    .map(char => ({ char, fields: line.split(char).length }))
    .sort((a, b) => b.fields - a.fields)[0];
  return best.fields > 1 ? best.char : ',';
}

export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '');
  const delimiter = detectDelimiter(clean.split(/\r?\n/)[0] || '');
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index];
    if (quoted) {
      if (char !== '"') { value += char; continue; }
      if (clean[index + 1] === '"') { value += '"'; index += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === delimiter) { row.push(value); value = ''; continue; }
    if (char === '\r') continue;
    if (char === '\n') { row.push(value); rows.push(row); row = []; value = ''; continue; }
    value += char;
  }
  row.push(value);
  rows.push(row);
  return rows;
}

// --- xlsx ------------------------------------------------------------------
// A zip's directory is at the end of the file, so the entries are found by
// reading backwards from the end-of-central-directory record rather than by
// walking forwards through data of unknown length.
function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 22; index >= 0 && index > bytes.length - 66000; index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error('That file is not a spreadsheet MaxDock can read.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    entries.push({ name, method, compressedSize, localAt });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return { view, entries };
}

async function readEntry(bytes, view, entry) {
  // The local header repeats the name and carries its own extra field, which is
  // usually a different length from the central one — so the data offset has to
  // be read from here, not calculated from the directory.
  const nameLength = view.getUint16(entry.localAt + 26, true);
  const extraLength = view.getUint16(entry.localAt + 28, true);
  const start = entry.localAt + 30 + nameLength + extraLength;
  const raw = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return decoder.decode(raw);
  if (entry.method !== 8) throw new Error('That spreadsheet uses a compression MaxDock cannot read. Save it as CSV and upload that.');
  if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open .xlsx files. Save the sheet as CSV and upload that.');
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

const unescapeXml = value => value
  .replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replaceAll('&amp;', '&');

const textOf = xml => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(match => unescapeXml(match[1])).join('');

// "AB12" is column 28. Cells with nothing in them are simply absent from the XML,
// so the column has to come from the reference or every short row shifts left.
function columnIndex(reference) {
  let index = 0;
  for (const char of String(reference).replace(/\d+/g, '')) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

async function parseXlsx(bytes) {
  const { view, entries } = zipEntries(bytes);
  const sheets = entries.filter(entry => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.name))
    .sort((a, b) => Number(a.name.match(/\d+/)[0]) - Number(b.name.match(/\d+/)[0]));
  if (!sheets.length) throw new Error('That workbook has no sheet MaxDock could read.');
  const sharedEntry = entries.find(entry => entry.name === 'xl/sharedStrings.xml');
  const shared = sharedEntry
    ? [...(await readEntry(bytes, view, sharedEntry)).matchAll(/<si>([\s\S]*?)<\/si>/g)].map(match => textOf(match[1]))
    : [];
  const xml = await readEntry(bytes, view, sheets[0]);
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cell of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cell[1];
      const reference = attributes.match(/r="([A-Z]+\d+)"/)?.[1];
      const type = attributes.match(/t="([^"]+)"/)?.[1] || 'n';
      const body = cell[2];
      let value = '';
      if (type === 's') value = shared[Number(body.match(/<v>(\d+)<\/v>/)?.[1] ?? -1)] ?? '';
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str') value = unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
      else value = unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '');
      row[reference ? columnIndex(reference) : row.length] = value;
    }
    rows.push([...row].map(value => value ?? ''));
  }
  return rows;
}

// The one entry point: hand it whatever the location sent back.
export async function readSheet(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const rows = isZip ? await parseXlsx(bytes) : parseCsv(decoder.decode(bytes));
  return rows
    .map(row => row.map(value => String(value ?? '').trim()))
    .filter(row => row.some(value => value !== ''));
}
