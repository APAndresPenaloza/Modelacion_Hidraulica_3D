/**
 * excel.js — Escribe libros de Excel (.xlsx) sin librerías externas.
 * -----------------------------------------------------------------------
 * Un archivo .xlsx es un ZIP con documentos XML (formato Office Open XML,
 * norma ECMA-376). Este módulo arma solo las partes necesarias: el libro, las
 * hojas, los estilos y las propiedades del documento, y las empaqueta en un ZIP.
 * No usa el DOM, así que también funciona en Node (pruebas automáticas).
 *
 * Uso:
 *   const bytes = crearXlsx([
 *     { nombre: 'Datos', columnas: [18, 12], congelar: { filas: 1 },
 *       filas: [[{ v: 'Tiempo', estilo: 'encabezado' }, { v: 'Nivel (m)', estilo: 'encabezado' }],
 *               ['06:00', { v: 3.2, dec: 2 }]] },
 *   ], { titulo: 'Simulación' });
 *
 * Cada celda puede ser: null (vacía), un número, un texto, o un objeto
 * { v, dec, estilo, moneda, f } donde dec son los decimales con que se muestra
 * el número (el valor se guarda completo), estilo es uno de ESTILOS y f es una
 * fórmula de Excel en inglés y sin el signo = (p. ej. 'B4*(B6-B5)'); en ese caso
 * v es el resultado ya calculado, que se muestra hasta que Excel recalcula.
 */

const XMLNS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const XMLNS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XMLNS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CABECERA = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

// ── Estilos ───────────────────────────────────────────────────────────────
// Índices de cellXfs en styles.xml (ver estilosXml más abajo)
export const ESTILOS = {
  normal: 0,
  titulo: 1,
  encabezado: 2,
  seccion: 3,
  nota: 4,
  // números con 0 a 6 decimales y separador de miles: 5 a 11
  moneda: 12,
  etiqueta: 13,
  // datos de entrada (letra azul) con 0 a 6 decimales: 14 a 20
  parrafo: 21,
  seccionArriba: 22,
  ajuste: 23,
};
const ESTILO_DECIMALES = (d) => 5 + Math.max(0, Math.min(6, Math.round(d)));
const ESTILO_ENTRADA = (d) => 14 + Math.max(0, Math.min(6, Math.round(d ?? 2)));

const FORMATOS = [
  [164, '#,##0'], [165, '#,##0.0'], [166, '#,##0.00'], [167, '#,##0.000'],
  [168, '#,##0.0000'], [169, '#,##0.00000'], [170, '#,##0.000000'], [171, '"$" #,##0'],
];

function estilosXml() {
  const numFmts = FORMATOS.map(([id, f]) => `<numFmt numFmtId="${id}" formatCode="${escapar(f)}"/>`).join('');
  const numero = (id) => `<xf numFmtId="${id}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`;
  const cellXfs = [
    /* 0 normal     */ '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    /* 1 título     */ '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    /* 2 encabezado */ '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>',
    /* 3 sección    */ '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/>',
    /* 4 nota       */ '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    /* 5–11 números con 0 a 6 decimales */ ...[0, 1, 2, 3, 4, 5, 6].map((d) => numero(164 + d)),
    /* 12 moneda    */ numero(171),
    /* 13 etiqueta  */ '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>',
    /* 14–20 datos de entrada (azul) con 0 a 6 decimales */
    ...[0, 1, 2, 3, 4, 5, 6].map((d) => `<xf numFmtId="${164 + d}" fontId="5" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>`),
    /* 21 párrafo: texto largo que se ajusta en varias líneas */
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>',
    /* 22 sección alineada arriba (junto a un párrafo) */
    '<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>',
    /* 23 ajuste: texto que se parte en líneas sin salirse de su columna */
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1"/></xf>',
  ];
  return CABECERA + `<styleSheet xmlns="${XMLNS}">`
    + `<numFmts count="${FORMATOS.length}">${numFmts}</numFmts>`
    + '<fonts count="6">'
    + '<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
    + '<font><b/><sz val="11"/><color rgb="FF12303B"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
    + '<font><b/><sz val="14"/><color rgb="FF12303B"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
    + '<font><i/><sz val="10"/><color rgb="FF4B6670"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
    + '<font><sz val="11"/><color rgb="FF4B6670"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
    + '<font><sz val="11"/><color rgb="FF1C6FA0"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'
    + '</fonts>'
    + '<fills count="4">'
    + '<fill><patternFill patternType="none"/></fill>'
    + '<fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFDCEBF2"/><bgColor indexed="64"/></patternFill></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF3EBDD"/><bgColor indexed="64"/></patternFill></fill>'
    + '</fills>'
    + '<borders count="2">'
    + '<border><left/><right/><top/><bottom/><diagonal/></border>'
    + '<border><left/><right/><top/><bottom style="thin"><color rgb="FF1C86B8"/></bottom><diagonal/></border>'
    + '</borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>`
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>'
    + '</styleSheet>';
}

// ── Utilidades de XML ─────────────────────────────────────────────────────
/** Escapa un texto para XML y quita los caracteres de control que XML no admite. */
export function escapar(texto) {
  return String(texto)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Letra(s) de la columna: 0 → A, 25 → Z, 26 → AA. */
export function nombreColumna(i) {
  let n = i + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const ref = (fila, col) => `${nombreColumna(col)}${fila + 1}`;

/** Nombre de hoja válido: máximo 31 caracteres, sin : \ / ? * [ ]. */
export function nombreHoja(nombre, usados = new Set()) {
  let base = String(nombre).replace(/[:\\/?*[\]]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Hoja';
  let n = base;
  for (let k = 2; usados.has(n.toLowerCase()); k++) n = `${base.slice(0, 31 - String(k).length - 1)} ${k}`;
  usados.add(n.toLowerCase());
  return n;
}

function celdaXml(celda, fila, col) {
  if (celda === null || celda === undefined || celda === '') return '';
  const c = typeof celda === 'object' ? celda : { v: celda };
  const r = ref(fila, col);
  let s = c.estilo !== undefined ? ESTILOS[c.estilo] ?? 0 : 0;
  if (c.f) {
    if (c.moneda) s = ESTILOS.moneda;
    else if (c.dec !== undefined && c.estilo === undefined) s = ESTILO_DECIMALES(c.dec);
    const cache = typeof c.v === 'number' && Number.isFinite(c.v) ? `<v>${c.v}</v>` : '';
    return `<c r="${r}"${s ? ` s="${s}"` : ''}><f>${escapar(c.f)}</f>${cache}</c>`;
  }
  if (typeof c.v === 'number') {
    if (!Number.isFinite(c.v)) {
      return `<c r="${r}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t>—</t></is></c>`;
    }
    if (c.entrada) s = ESTILO_ENTRADA(c.dec);
    else if (c.moneda) s = ESTILOS.moneda;
    else if (c.dec !== undefined && c.estilo === undefined) s = ESTILO_DECIMALES(c.dec);
    return `<c r="${r}"${s ? ` s="${s}"` : ''}><v>${c.v}</v></c>`;
  }
  if (typeof c.v === 'boolean') return `<c r="${r}" t="b"${s ? ` s="${s}"` : ''}><v>${c.v ? 1 : 0}</v></c>`;
  if (c.v === null || c.v === undefined) return s ? `<c r="${r}" s="${s}"/>` : '';
  return `<c r="${r}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${escapar(c.v)}</t></is></c>`;
}

function hojaXml(hoja, indice) {
  const filas = hoja.filas || [];
  const nCols = Math.max(1, hoja.columnas?.length || 0, ...filas.map((f) => f.length));
  const nFilas = Math.max(1, filas.length);
  const congelar = hoja.congelar || {};
  const fy = congelar.filas || 0;
  const fx = congelar.columnas || 0;
  let vista = `<sheetView workbookViewId="0"${indice === 0 ? ' tabSelected="1"' : ''}>`;
  if (fy || fx) {
    const panel = fy && fx ? 'bottomRight' : (fy ? 'bottomLeft' : 'topRight');
    vista += `<pane${fx ? ` xSplit="${fx}"` : ''}${fy ? ` ySplit="${fy}"` : ''} topLeftCell="${ref(fy, fx)}" activePane="${panel}" state="frozen"/>`
      + `<selection pane="${panel}" activeCell="${ref(fy, fx)}" sqref="${ref(fy, fx)}"/>`;
  }
  vista += '</sheetView>';
  const cols = (hoja.columnas || []).map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const altos = hoja.altos || {};
  const datos = filas.map((fila, i) => {
    const celdas = fila.map((c, j) => celdaXml(c, i, j)).join('');
    const alto = altos[i] ? ` ht="${altos[i]}" customHeight="1"` : '';
    return celdas || alto ? `<row r="${i + 1}"${alto}>${celdas}</row>` : '';
  }).join('');
  const filtro = hoja.filtro ? `<autoFilter ref="${hoja.filtro}"/>` : '';
  // Celdas combinadas, p. ej. 'B20:C20' (el contenido va en la primera)
  const combinar = hoja.combinar?.length
    ? `<mergeCells count="${hoja.combinar.length}">${hoja.combinar.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>`
    : '';
  // Hojas anchas: al imprimir, horizontal y ajustada al ancho de la página
  const ajustar = hoja.horizontal ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '';
  const pagina = hoja.horizontal ? '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' : '';
  return CABECERA + `<worksheet xmlns="${XMLNS}" xmlns:r="${XMLNS_R}">`
    + ajustar
    + `<dimension ref="A1:${ref(nFilas - 1, nCols - 1)}"/>`
    + `<sheetViews>${vista}</sheetViews>`
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + (cols ? `<cols>${cols}</cols>` : '')
    + `<sheetData>${datos}</sheetData>`
    + filtro
    + combinar
    + '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
    + pagina
    + '</worksheet>';
}

/** Rango del filtro automático para una tabla: encabezado en `filaEncabezado` (0 = primera). */
export function rangoTabla(filaEncabezado, nColumnas, nFilasDatos) {
  return `A${filaEncabezado + 1}:${ref(filaEncabezado + Math.max(1, nFilasDatos), nColumnas - 1)}`;
}

function fechaW3C(fecha) {
  return new Date(fecha).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Arma el libro y devuelve los bytes del archivo .xlsx (Uint8Array).
 * hojas: [{ nombre, filas, columnas?, congelar?, filtro?, altos?, combinar?, horizontal? }]
 */
export function crearXlsx(hojas, { titulo = '', autor = '', aplicacion = 'Simulador hídrico 3D', fecha = new Date() } = {}) {
  const usados = new Set();
  const nombres = hojas.map((h) => nombreHoja(h.nombre, usados));
  const n = hojas.length;
  const archivos = [];
  const agregar = (ruta, texto) => archivos.push({ ruta, datos: new TextEncoder().encode(texto) });

  agregar('[Content_Types].xml', CABECERA
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    + '</Types>');

  agregar('_rels/.rels', CABECERA
    + `<Relationships xmlns="${XMLNS_PKG}">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
    + '</Relationships>');

  const creado = fechaW3C(fecha);
  agregar('docProps/core.xml', CABECERA
    + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
    + `<dc:title>${escapar(titulo)}</dc:title><dc:creator>${escapar(autor)}</dc:creator>`
    + `<dcterms:created xsi:type="dcterms:W3CDTF">${creado}</dcterms:created>`
    + `<dcterms:modified xsi:type="dcterms:W3CDTF">${creado}</dcterms:modified>`
    + '</cp:coreProperties>');

  agregar('docProps/app.xml', CABECERA
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">'
    + `<Application>${escapar(aplicacion)}</Application>`
    + '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Hojas de cálculo</vt:lpstr></vt:variant>'
    + `<vt:variant><vt:i4>${n}</vt:i4></vt:variant></vt:vector></HeadingPairs>`
    + `<TitlesOfParts><vt:vector size="${n}" baseType="lpstr">${nombres.map((x) => `<vt:lpstr>${escapar(x)}</vt:lpstr>`).join('')}</vt:vector></TitlesOfParts>`
    + '</Properties>');

  const filtros = hojas
    .map((h, i) => (h.filtro ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${escapar(nombres[i].replace(/'/g, "''"))}'!${h.filtro.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}</definedName>` : ''))
    .join('');
  agregar('xl/workbook.xml', CABECERA
    + `<workbook xmlns="${XMLNS}" xmlns:r="${XMLNS_R}">`
    + '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="16000" activeTab="0"/></bookViews>'
    + `<sheets>${nombres.map((x, i) => `<sheet name="${escapar(x)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>`
    + (filtros ? `<definedNames>${filtros}</definedNames>` : '')
    + '<calcPr calcId="191029" fullCalcOnLoad="1"/>'
    + '</workbook>');

  agregar('xl/_rels/workbook.xml.rels', CABECERA
    + `<Relationships xmlns="${XMLNS_PKG}">`
    + hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>');

  agregar('xl/styles.xml', estilosXml());
  hojas.forEach((h, i) => agregar(`xl/worksheets/sheet${i + 1}.xml`, hojaXml(h, i)));

  return empaquetarZip(archivos, fecha);
}

// ── ZIP ───────────────────────────────────────────────────────────────────
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** Suma de verificación CRC-32 que exige el formato ZIP. */
export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ── DEFLATE (RFC 1951) con códigos de Huffman fijos ─────────────────────────
// Compresión síncrona y sin dependencias: busca repeticiones de al menos 3 bytes
// en los últimos 32 KB (LZ77) y escribe literales y pares (longitud, distancia)
// con los códigos fijos de la norma. El XML de las hojas se repite mucho, así
// que el archivo queda varias veces más pequeño.
const BASE_LONG = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const EXTRA_LONG = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const BASE_DIST = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const EXTRA_DIST = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

const invertirBits = (codigo, bits) => {
  let r = 0;
  for (let k = 0; k < bits; k++) { r = (r << 1) | (codigo & 1); codigo >>= 1; }
  return r;
};

const TABLAS_DEFLATE = (() => {
  // Códigos fijos de literales/longitudes (0–287) y de distancias (0–29), ya invertidos
  const codLit = new Uint16Array(288);
  const bitsLit = new Uint8Array(288);
  for (let s = 0; s < 288; s++) {
    let codigo;
    let bits;
    if (s < 144) { codigo = 0x30 + s; bits = 8; }
    else if (s < 256) { codigo = 0x190 + (s - 144); bits = 9; }
    else if (s < 280) { codigo = s - 256; bits = 7; }
    else { codigo = 0xc0 + (s - 280); bits = 8; }
    codLit[s] = invertirBits(codigo, bits);
    bitsLit[s] = bits;
  }
  const codDist = new Uint8Array(30).map((_, d) => invertirBits(d, 5));
  const simLong = new Uint8Array(259);
  for (let k = 0; k < 28; k++) for (let l = BASE_LONG[k]; l < BASE_LONG[k + 1]; l++) simLong[l] = k;
  simLong[258] = 28;
  const simDist = new Uint8Array(32769);
  for (let k = 0; k < 30; k++) {
    const hasta = k < 29 ? BASE_DIST[k + 1] : 32769;
    for (let d = BASE_DIST[k]; d < hasta; d++) simDist[d] = k;
  }
  return { codLit, bitsLit, codDist, simLong, simDist };
})();

/** Comprime con DEFLATE (un solo bloque con códigos fijos). Devuelve un Uint8Array. */
export function deflate(datos) {
  const { codLit, bitsLit, codDist, simLong, simDist } = TABLAS_DEFLATE;
  const n = datos.length;
  const salida = new Uint8Array(n + (n >> 3) + 64);
  let pos = 0;
  let acumulado = 0;
  let nBits = 0;
  const escribir = (valor, bits) => {
    acumulado |= valor << nBits;
    nBits += bits;
    while (nBits >= 8) { salida[pos++] = acumulado & 0xff; acumulado >>>= 8; nBits -= 8; }
  };
  const literal = (b) => escribir(codLit[b], bitsLit[b]);

  const VENTANA = 32768;
  const MASCARA_V = VENTANA - 1;
  const BITS_HASH = 15;
  const MASCARA_H = (1 << BITS_HASH) - 1;
  const cabeza = new Int32Array(1 << BITS_HASH).fill(-1);
  const previo = new Int32Array(VENTANA);
  const hash = (k) => ((datos[k] << 10) ^ (datos[k + 1] << 5) ^ datos[k + 2]) & MASCARA_H;
  const insertar = (k) => { const h = hash(k); previo[k & MASCARA_V] = cabeza[h]; cabeza[h] = k; };

  escribir(3, 3); // BFINAL = 1 y BTYPE = 01 (Huffman fijo)
  let i = 0;
  while (i < n) {
    let largo = 0;
    let distancia = 0;
    if (i + 2 < n) {
      const maximo = Math.min(258, n - i);
      let j = cabeza[hash(i)];
      for (let cadena = 64; j >= 0 && i - j <= VENTANA && cadena > 0; cadena--) {
        if (datos[j + largo] === datos[i + largo]) {
          let l = 0;
          while (l < maximo && datos[j + l] === datos[i + l]) l++;
          if (l > largo) { largo = l; distancia = i - j; if (l >= maximo) break; }
        }
        const anterior = previo[j & MASCARA_V];
        if (anterior >= j) break;
        j = anterior;
      }
      insertar(i);
    }
    if (largo >= 3) {
      const sl = simLong[largo];
      escribir(codLit[257 + sl], bitsLit[257 + sl]);
      if (EXTRA_LONG[sl]) escribir(largo - BASE_LONG[sl], EXTRA_LONG[sl]);
      const sd = simDist[distancia];
      escribir(codDist[sd], 5);
      if (EXTRA_DIST[sd]) escribir(distancia - BASE_DIST[sd], EXTRA_DIST[sd]);
      for (let k = 1; k < largo; k++) if (i + k + 2 < n) insertar(i + k);
      i += largo;
    } else {
      literal(datos[i]);
      i += 1;
    }
  }
  escribir(codLit[256], bitsLit[256]); // fin del bloque
  if (nBits > 0) salida[pos++] = acumulado & 0xff;
  return salida.subarray(0, pos);
}

function fechaDos(fecha) {
  const d = new Date(fecha);
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dia = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}

/** Empaqueta los archivos en un ZIP (método DEFLATE; STORE si comprimir no ahorra espacio). */
export function empaquetarZip(archivos, fecha = new Date()) {
  const { hora, dia } = fechaDos(fecha);
  const partes = [];
  const central = [];
  let desplazamiento = 0;
  for (const a of archivos) {
    const nombre = new TextEncoder().encode(a.ruta);
    const crc = crc32(a.datos);
    const comprimido = deflate(a.datos);
    const usarDeflate = comprimido.length < a.datos.length;
    const cuerpo = usarDeflate ? comprimido : a.datos;
    const metodo = usarDeflate ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);          // nombres en UTF-8
    local.setUint16(8, metodo, true);
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, cuerpo.length, true);
    local.setUint32(22, a.datos.length, true);
    local.setUint16(26, nombre.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nombre, cuerpo);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, metodo, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, dia, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, cuerpo.length, true);
    c.setUint32(24, a.datos.length, true);
    c.setUint16(28, nombre.length, true);
    c.setUint16(30, 0, true);
    c.setUint16(32, 0, true);
    c.setUint16(34, 0, true);
    c.setUint16(36, 0, true);
    c.setUint32(38, 0, true);
    c.setUint32(42, desplazamiento, true);
    central.push(new Uint8Array(c.buffer), nombre);
    desplazamiento += 30 + nombre.length + cuerpo.length;
  }
  const tamCentral = central.reduce((s, b) => s + b.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(4, 0, true);
  fin.setUint16(6, 0, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, desplazamiento, true);
  fin.setUint16(20, 0, true);
  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const total = todo.reduce((s, b) => s + b.length, 0);
  const salida = new Uint8Array(total);
  let k = 0;
  for (const b of todo) { salida.set(b, k); k += b.length; }
  return salida;
}
