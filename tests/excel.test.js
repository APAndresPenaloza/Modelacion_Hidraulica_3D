// Pruebas del generador de Excel y del registro de la simulación.
// Se descomprime el .xlsx con zlib de Node para revisar su contenido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { crc32, deflate, nombreColumna, crearXlsx } from '../js/excel.js';
import { Registro, libroRepresa, libroAno, libroHuella, libroCultivos, construirHojas, crearLibro, relojSimulado, unirEsquemas } from '../js/datos.js';
import * as M from '../js/modelo.js';
import * as S from '../js/sistema.js';

const texto = (s) => new TextEncoder().encode(s);

/** Lee las entradas de un ZIP recorriendo sus encabezados locales. */
function leerZip(bytes) {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const archivos = {};
  let k = 0;
  while (vista.getUint32(k, true) === 0x04034b50) {
    const metodo = vista.getUint16(k + 8, true);
    const crc = vista.getUint32(k + 14, true);
    const tam = vista.getUint32(k + 18, true);
    const largoNombre = vista.getUint16(k + 26, true);
    const nombre = new TextDecoder().decode(bytes.subarray(k + 30, k + 30 + largoNombre));
    const cuerpo = bytes.subarray(k + 30 + largoNombre, k + 30 + largoNombre + tam);
    const datos = metodo === 8 ? new Uint8Array(inflateRawSync(cuerpo)) : cuerpo;
    assert.equal(crc32(datos), crc, `CRC de ${nombre}`);
    archivos[nombre] = new TextDecoder().decode(datos);
    k += 30 + largoNombre + tam;
  }
  return archivos;
}

test('ZIP: CRC-32 de la norma y DEFLATE que zlib descomprime igual', () => {
  assert.equal(crc32(texto('123456789')), 0xcbf43926);
  const casos = [
    new Uint8Array(0),
    texto('a'),
    texto('abcabcabcabcabcabcabc'),
    texto('<c r="A1"><v>3.2</v></c>'.repeat(5000)),
    new Uint8Array(70000).map((_, i) => (i * 7919) % 251),          // pseudoaleatorio
    new Uint8Array(100000).fill(65),                                  // repeticiones solapadas
  ];
  // Datos con repeticiones lejanas (más de 32 KB de distancia)
  const bloque = new Uint8Array(40000).map((_, i) => (i * 31 + (i >> 7)) % 256);
  const lejos = new Uint8Array(80000);
  lejos.set(bloque, 0);
  lejos.set(bloque, 40000);
  casos.push(lejos);
  for (const datos of casos) {
    const comprimido = deflate(datos);
    assert.deepEqual(new Uint8Array(inflateRawSync(comprimido)), datos);
  }
  // El XML repetitivo queda mucho más pequeño
  assert.ok(deflate(casos[3]).length < casos[3].length / 20);
});

test('Excel: columnas, celdas, fórmulas y hojas del libro', () => {
  assert.equal(nombreColumna(0), 'A');
  assert.equal(nombreColumna(25), 'Z');
  assert.equal(nombreColumna(26), 'AA');
  assert.equal(nombreColumna(701), 'ZZ');
  assert.equal(nombreColumna(702), 'AAA');
  const bytes = crearXlsx([
    { nombre: 'Datos', columnas: [10, 10], congelar: { filas: 1 }, filas: [['Texto <&>', { v: 3.14159, dec: 2 }], [{ f: 'B1*2', v: 6.28318, dec: 2 }, Infinity]] },
    { nombre: 'Datos', filas: [['nombre repetido']] },
  ]);
  const zip = leerZip(bytes);
  assert.ok(zip['[Content_Types].xml'].includes('spreadsheetml.sheet.main+xml'));
  assert.ok(zip['xl/workbook.xml'].includes('<sheet name="Datos"'));
  assert.ok(zip['xl/workbook.xml'].includes('<sheet name="Datos 2"'));
  const hoja = zip['xl/worksheets/sheet1.xml'];
  assert.ok(hoja.includes('Texto &lt;&amp;&gt;'));
  assert.ok(hoja.includes('<v>3.14159</v>'));          // el valor se guarda completo
  assert.ok(hoja.includes('<f>B1*2</f><v>6.28318</v>'));
  assert.ok(hoja.includes('<pane ySplit="1"'));
  assert.ok(hoja.includes('<t>—</t>'));                // infinito se escribe como texto
});

test('Registro: muestras en la cuadrícula del intervalo y eventos de la bomba', () => {
  const reg = new Registro(900);
  reg.reiniciar(6 * 3600);
  assert.equal(reg.proxima, 6 * 3600);
  reg.agregarFila({ t: 6 * 3600 });
  assert.equal(reg.proxima, 6 * 3600 + 900);
  reg.agregarEvento(7 * 3600, 4.75, false, 'parada');
  reg.agregarEvento(9 * 3600, 3, true, 'arranque');
  assert.equal(reg.eventos[1].duracion, 2 * 3600);
  // Cambiar a 1 h deja la próxima muestra en la siguiente hora en punto
  reg.cambiarIntervalo(3600, 6 * 3600 + 1200);
  assert.equal(reg.proxima, 7 * 3600);
  assert.equal(relojSimulado(30 * 3600 + 15 * 60).texto, 'Día 2, 06:15');
});

test('Libro de la simulación: hojas, escenarios y fórmulas del ciclo', () => {
  const p = { ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO };
  const r = S.calcular(p, { nivel: 4.4, bomba: true, t: 6 * 3600 });
  const reg = new Registro(900);
  reg.reiniciar(6 * 3600);
  reg.agregarFila({ t: 6 * 3600, nivel: 4.4, volumen: r.volumen, llenado: 88, bomba: true, Qin: 15, factor: r.factor, Qsal: 13.41, Hb: r.alturaBombeo, potencia: r.potencia / 1000, presionRed: r.red.presionMin, casa: r.casa.id, Hcasa: r.Hcasa, estado: 'Servicio normal', horasBomba: 0, energia: 0, costoEnergia: 0, usoCanal: 43 });
  const fila = (clave, valor, extra = {}) => ({ clave, bloque: 'Parámetros', grupo: 'Captación · Bombeo', etiqueta: clave, unidad: 'L/s', valor, dec: 2, ...extra });
  reg.escenarios = [{ nombre: 'Base', momento: 'Día 1, 06:00', filas: [fila('Q', 15)] }];
  const actual = { nombre: 'Al exportar', momento: 'Día 1, 08:00', filas: [fila('Q', 18), fila('Rebose', 1)] };
  const ci = r.ciclo;
  const ciclo = {
    automatico: true, alcanza: r.alcanza, Dtanque: p.Dtanque, hA: p.nivelArranque, hP: p.nivelParada, Qb: p.Qbombeo / 1000, Qs: p.Qdemanda / 1000,
    cotaRio: p.cotaRio, cotaTanque: p.cotaTanque, hf: r.hfBombeo, eficiencia: p.eficiencia, tarifa: p.tarifaKWh, cargoFijo: p.cargoFijo,
    At: r.At, dV: ci.dV, tEnc: ci.tLlenado, tApag: ci.tVaciado, ciclo: ci.ciclo, horasDia: r.horasDia, arranquesHora: ci.arranquesHora,
    nivelMedio: r.nivelMedio, Hmedia: r.Hmedia, Vmes: r.Vmes, m: r.costo.m, energia: r.costo.energia, costo: r.costo.costo,
    etaMotor: r.etaMotor, motorHP: r.bombas.acueducto.motor.hp, capta: r.capta,
  };
  const datos = {
    meta: { fecha: '1 de noviembre de 2026', reloj: 'Día 1, 08:00' },
    resumen: [['Costo mensual de bombeo', r.costo.costo, 'COP']],
    actual,
    registro: reg,
    ciclo,
    revision: r.revisionTotal,
    cantidades: r.cantidades.filas,
    perfil: { puntos: r.rio.calidad.puntos, marcas: [{ km: 44, texto: 'Bocatoma' }] },
    represa: libroRepresa(p, r),
    ano: libroAno(p, r),
    huella: libroHuella(p, r),
    cultivos: libroCultivos(p, r),
  };
  const hojas = construirHojas(datos);
  assert.deepEqual(hojas.map((h) => h.nombre), ['Resumen', 'Parámetros y resultados', 'Serie de tiempo', 'Arranques y paradas', 'Ciclo y costo', 'Revisión del diseño',
    'Cantidades de obra', 'Perfil del río', 'Represa y energía', 'Embalse mes a mes', 'Huella hídrica', 'Huella por cultivo']);
  // Una columna por escenario guardado más el estado al exportar
  assert.deepEqual(hojas[1].filas[3].map((c) => c?.v), ['Variable', 'Unidad', 'Base', 'Al exportar']);
  // La fila que solo existe al exportar queda vacía en el escenario guardado
  assert.equal(hojas[1].filas.find((f) => f[0] === 'Rebose')[2], null);
  // Las fórmulas de la hoja Ciclo y costo apuntan a las celdas correctas
  const hojaCiclo = hojas[4].filas;
  assert.equal(hojaCiclo[18][0], 'Eficiencia del motor η_m');   // fila 19 de Excel
  assert.equal(hojaCiclo[22][1].f, 'B22/(B9-B10)/3600');   // fila 23 de Excel: t_enc
  assert.equal(hojaCiclo[31][1].f, 'B15*B17*B18*B30/(B14*B19*3600000)');   // fila 32: m con η·η_m
  assert.equal(hojaCiclo[33][1].f, 'B32*B31+B16');         // fila 34 de Excel: C = m·V + b
  // Con las celdas de entrada, las fórmulas dan el mismo costo que el simulador
  const B = {};
  hojaCiclo.forEach((f, k) => { if (f[1] && typeof f[1] === 'object') B[k + 1] = f[1].v; });
  const dV = ((Math.PI * B[6] ** 2) / 4) * (B[8] - B[7]);
  const tEnc = dV / (B[9] - B[10]) / 3600;
  const horas = (24 * tEnc) / (tEnc + dV / B[10] / 3600);
  const Hm = B[12] + (B[7] + B[8]) / 2 - B[11] + B[13];
  const m = (B[15] * B[17] * B[18] * Hm) / (B[14] * B[19] * 3600000);
  assert.ok(Math.abs(m * B[9] * horas * 3600 * 30 + B[16] - r.costo.costo) < 1e-3);
  // La revisión (acueducto, río, bombas, riego, represa, huella y acuífero) y las cantidades pasan completas
  assert.equal(hojas[5].filas.length, 4 + r.revisionTotal.length);
  assert.ok(r.revisionTotal.length > r.checks.length);
  assert.deepEqual([...new Set(hojas[5].filas.slice(4).map((f) => f[0]))], ['Acueducto', 'Río', 'Bombas', 'Riego', 'Represa', 'Huella', 'Acuífero']);
  assert.equal(hojas[6].filas.length, 4 + r.cantidades.filas.length);
  // Perfil del río: una fila cada 0.5 km del km 0 al 50, con la bocatoma marcada
  assert.equal(hojas[7].filas.length, 4 + 101);
  assert.equal(hojas[7].filas[4 + 88][8].v, 'Bocatoma');
  // El libro completo se puede descomprimir y trae las doce hojas
  const zip = leerZip(crearLibro(datos));
  assert.ok(zip['xl/worksheets/sheet5.xml'].includes('<f>PI()*B6^2/4</f>'));
  assert.ok(zip['xl/worksheets/sheet7.xml'].includes('Tubería principal'));
  assert.ok(zip['xl/worksheets/sheet8.xml'].includes('Coliformes fecales'));
  assert.ok(zip['xl/worksheets/sheet9.xml'].includes('<f>B15*B16*B11*B34*B14/1000</f>'));
  assert.ok(zip['xl/worksheets/sheet10.xml'].includes('<f>SUM(H5:H16)</f>'));
  assert.ok(zip['xl/worksheets/sheet11.xml'].includes('<f>ROUNDUP(B27/B34,0)</f>'));
  assert.ok(zip['xl/worksheets/sheet12.xml'].includes('Café'));
  // En el Resumen, la descripción de cada hoja ocupa B:C y se ajusta (cabe a lo ancho al imprimir)
  const resumen = zip['xl/worksheets/sheet1.xml'];
  assert.ok(resumen.includes('<mergeCells count="11">'));
  assert.ok(resumen.indexOf('</sheetData>') < resumen.indexOf('<mergeCells') && resumen.indexOf('<mergeCells') < resumen.indexOf('<pageMargins'));
});

test('Esquemas: une filas de varios escenarios sin perder el orden', () => {
  const a = [{ clave: '1' }, { clave: '2' }, { clave: '4' }];
  const b = [{ clave: '1' }, { clave: '3' }, { clave: '4' }];
  // '3' solo está en b: queda después de su vecina '1' y antes de '4'
  assert.deepEqual(unirEsquemas([a, b]).map((x) => x.clave), ['1', '3', '2', '4']);
});

test('Hojas de la represa y de la huella: las fórmulas dan lo mismo que el simulador', () => {
  for (const cambios of [{}, { operacionPresa: 'fijo', Qpresa: 3, tensionLinea: 13.2 }, { cultivo: 'cacao', zonaRiego: 'media', dosisN: 150 }, { lluvia: 'inundacion', cotaRio: 3.7, Qcrecida: 40 }]) {
    const p = { ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO, ...cambios };
    const r = S.calcular(p, { nivel: 4.4, bomba: true, t: 6 * 3600 });
    const hojas = construirHojas({
      meta: { fecha: 'hoy', reloj: 'Día 1, 06:00' }, resumen: [], actual: { nombre: 'Al exportar', momento: '', filas: [] }, registro: new Registro(900),
      ciclo: { automatico: false, alcanza: true }, represa: libroRepresa(p, r), ano: libroAno(p, r), huella: libroHuella(p, r), cultivos: libroCultivos(p, r),
    });
    // Valores de la columna B por número de fila de Excel
    const B = (hoja) => {
      const o = {};
      hoja.filas.forEach((f, k) => { const c = f[1]; o[k + 1] = c && typeof c === 'object' ? c.v : c; });
      return o;
    };
    const rp = B(hojas[8]);
    const Hn = rp[7] - rp[12] - rp[13] * rp[11] ** 2;
    const Pk = (rp[15] * rp[16] * rp[11] * Hn * rp[14]) / 1000;
    assert.ok(Math.abs(Pk - r.represa.P / 1000) < 1e-9);
    assert.ok(Math.abs(rp[35] - Pk) < 1e-9);                              // la caché de la fórmula
    const I = (Pk * 1000) / (Math.sqrt(3) * rp[17] * 1000 * rp[20]);
    const Pp = (3 * I * I * rp[19] * rp[18]) / 1000;
    assert.ok(Math.abs(Pp - r.represa.linea.perdidas / 1000) < 1e-9);
    const Eent = (Pk - Pp) * 720;
    assert.ok(Math.abs(Eent - r.represa.Eent) < 1e-6);
    if (Eent > 0) assert.ok(Math.abs((rp[21] * Pk * 720) / Eent + rp[22] - r.represa.costoPuesto) < 1e-9);
    assert.ok(Math.abs(rp[8] * rp[7] ** 2 - r.represa.V) < 1e-6);         // V = a·h²
    // Huella: verde, azul y gris con las celdas de entrada
    const hu = B(hojas[10]);
    const hh = r.huella.hh;
    assert.ok(Math.abs((10 * hu[9]) / hu[8] - hh.verde) < 1e-9);
    assert.ok(Math.abs((10 * hu[10]) / hu[8] - hh.azul) < 1e-9);
    assert.ok(Math.abs((hu[12] * hu[11]) / ((hu[13] - hu[14]) / 1000) / hu[8] - hh.gris) < 1e-9);
    const T = hu[8] * hu[15] * hu[16] * (1 - hu[17]);
    assert.ok(Math.abs(T - r.huella.produccion) < 1e-9);
    const viajes = T > 0 ? Math.ceil(T / hu[34]) : 0;
    assert.equal(viajes, r.huella.carbono.viajes);
    const kg = viajes * hu[32] * (hu[35] + hu[36]) * hu[33] * hu[37];
    assert.ok(Math.abs(kg - r.huella.carbono.kgCO2) < 1e-9);
    // Un año de operación: doce meses y la fila del año con la energía sumada
    assert.equal(hojas[9].filas.length, 4 + 12 + 1 + 2);
    assert.ok(Math.abs(hojas[9].filas[16][7].v - r.anoRepresa.Eano) < 1e-6);
    // Todos los cultivos en la zona y el elegido en las tres zonas
    assert.equal(hojas[11].filas.filter((f) => typeof f[0] === 'string' && f.length === 10).length, 11 + 3);
  }
});
