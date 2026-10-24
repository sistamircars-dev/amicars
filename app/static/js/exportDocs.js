function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function stampName(base, ext) {
  const day = new Date().toISOString().slice(0, 10);
  return `${base}-${day}.${ext}`;
}

export function downloadCsv(base, rows) {
  const csv = rows
    .map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  downloadBlob(stampName(base, "csv"), new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
})();

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function zipStore(files) {
  const now = new Date();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() / 2)) & 0xffff;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const locals = [];
  const centrals = [];
  let offset = 0;
  files.forEach((file) => {
    const name = new TextEncoder().encode(file.name);
    const data = file.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(8, 0, true);
    view.setUint16(10, time, true);
    view.setUint16(12, date, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, data.length, true);
    view.setUint32(22, data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, data);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length + data.length;
  });
  const centralStart = offset;
  const centralBlob = concat(centrals);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralBlob.length, true);
  endView.setUint32(16, centralStart, true);
  return concat([...locals, centralBlob, end]);
}

function columnName(index) {
  let name = "";
  let value = index + 1;
  while (value > 0) {
    const mod = (value - 1) % 26;
    name = String.fromCharCode(65 + mod) + name;
    value = Math.floor((value - mod) / 26);
  }
  return name;
}

function sheetXml(rows) {
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowIndex + 1}`;
          if (typeof cell === "number" && Number.isFinite(cell)) {
            return `<c r="${ref}"><v>${cell}</v></c>`;
          }
          return `<c r="${ref}" t="inlineStr"><is><t>${xml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

export function downloadXlsx(base, rows) {
  const encoder = new TextEncoder();
  const files = [
    {
      name: "[Content_Types].xml",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`),
    },
    {
      name: "_rels/.rels",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    },
    {
      name: "xl/workbook.xml",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="AMIRCARS" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: encoder.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`),
    },
    { name: "xl/worksheets/sheet1.xml", data: encoder.encode(sheetXml(rows)) },
  ];
  downloadBlob(
    stampName(base, "xlsx"),
    new Blob([zipStore(files)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
  );
}

const WIN_ANSI = {
  "á": 0xe1, "é": 0xe9, "í": 0xed, "ó": 0xf3, "ú": 0xfa, "ñ": 0xf1, "ü": 0xfc,
  "Á": 0xc1, "É": 0xc9, "Í": 0xcd, "Ó": 0xd3, "Ú": 0xda, "Ñ": 0xd1, "Ü": 0xdc,
  "¿": 0xbf, "¡": 0xa1, "°": 0xb0,
};

function pdfText(value) {
  const bytes = [];
  for (const char of String(value ?? "")) {
    if (WIN_ANSI[char]) {
      bytes.push(WIN_ANSI[char]);
      continue;
    }
    const code = char.charCodeAt(0);
    bytes.push(code >= 32 && code <= 126 ? code : 63);
  }
  return Array.from(bytes)
    .map((code) => (code === 40 || code === 41 || code === 92 ? `\\${String.fromCharCode(code)}` : String.fromCharCode(code)))
    .join("")
    .replace(/[^\x20-\x7e\\]/g, (char) => `\\${char.charCodeAt(0).toString(8).padStart(3, "0")}`);
}

export function downloadPdf(base, title, rows) {
  const pageWidth = 792;
  const pageHeight = 612;
  const lineHeight = 14;
  const maxLines = 34;
  const pages = [];
  const body = rows.slice(1);
  if (!body.length) {
    pages.push([rows[0]]);
  }
  for (let index = 0; index < body.length; index += maxLines) {
    pages.push([rows[0], ...body.slice(index, index + maxLines)]);
  }
  const objects = [];
  const add = (text) => {
    objects.push(text);
    return objects.length;
  };
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pageIds = [];
  pages.forEach((pageRows, pageIndex) => {
    const lines = [`BT /F1 14 Tf 36 ${pageHeight - 36} Td (${pdfText(title)}) Tj`];
    lines.push(`0 -22 Td /F1 9 Tf (${pdfText(`Página ${pageIndex + 1} de ${pages.length}`)}) Tj`);
    pageRows.forEach((row) => {
      const line = row.map((cell) => String(cell ?? "")).join("  |  ").slice(0, 140);
      lines.push(`0 -${lineHeight} Td (${pdfText(line)}) Tj`);
    });
    lines.push("ET");
    const stream = lines.join("\n");
    const contentId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent PAGES 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    pageIds.push(pageId);
  });
  const pagesId = add(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const fixed = objects.map((text) => text.replace("Parent PAGES 0 R", `Parent ${pagesId} 0 R`));
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  fixed.forEach((text, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${text}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${fixed.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${fixed.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  downloadBlob(stampName(base, "pdf"), new Blob([pdf], { type: "application/pdf" }));
}
