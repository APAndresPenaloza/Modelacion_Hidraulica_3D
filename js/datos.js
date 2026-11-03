/**
 * datos.js — Registro de la simulación y exportación a Excel.
 * -----------------------------------------------------------------------
 * Mientras corre el reloj se guarda una fila cada cierto tiempo simulado
 * (serie de tiempo) y cada vez que la bomba arranca o se apaga. Además se pueden
 * guardar escenarios (todos los parámetros y resultados de un momento) para
 * compararlos. Todo se descarga en un libro de Excel con doce hojas.
 * Este módulo no toca el DOM salvo en descargarArchivo().
 */
import { crearXlsx, rangoTabla } from './excel.js';
import * as R from './rio.js';
import * as G from './riego.js';
import * as H from './huella.js';
import * as P from './represa.js';

export const INTERVALOS = [
  { valor: 300, nombre: '5 min' },
  { valor: 900, nombre: '15 min' },
  { valor: 1800, nombre: '30 min' },
  { valor: 3600, nombre: '1 h' },
];
export const MAX_FILAS = 20000;
const ALMACEN = 'simulador-hidrico-3d:escenarios:v1';

/** Día y hora del reloj simulado (t en segundos desde el comienzo del día 1). */
export function relojSimulado(t) {
  const total = Math.floor(t / 60 + 1e-6);
  const dia = Math.floor(total / 1440) + 1;
  const hora = `${String(Math.floor((total % 1440) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  return { dia, hora, texto: `Día ${dia}, ${hora}` };
}

const nombreIntervalo = (s) => INTERVALOS.find((x) => x.valor === s)?.nombre ?? `${Math.round(s / 60)} min`;

// Los escenarios se conservan en el navegador (si lo permite) para no perderlos al recargar
function leerEscenarios() {
  try {
    const lista = JSON.parse(globalThis.localStorage?.getItem(ALMACEN) ?? '[]');
    return Array.isArray(lista) ? lista.filter((e) => e && Array.isArray(e.filas)) : [];
  } catch {
    return [];
  }
}

function escribirEscenarios(lista) {
  try {
    globalThis.localStorage?.setItem(ALMACEN, JSON.stringify(lista));
  } catch {
    // Sin almacenamiento (modo privado, archivo local): los escenarios duran lo que dure la página
  }
}

export class Registro {
  constructor(intervalo = 900) {
    this.intervalo = intervalo;
    this.escenarios = leerEscenarios();
    this.reiniciar(0);
  }

  /** Empieza un registro nuevo en el instante t (s); la primera fila se toma en t. */
  reiniciar(t) {
    this.inicio = t;
    this.proxima = t;
    this.filas = [];
    this.eventos = [];
    this.energia = 0;        // kWh consumidos desde el inicio del registro
    this.segundosBomba = 0;  // s con la bomba encendida
    this.ultimoCambio = t;
    this.recortado = false;
  }

  acumular(energia, segundosBomba) {
    this.energia += energia;
    this.segundosBomba += segundosBomba;
  }

  agregarFila(fila) {
    this.filas.push(fila);
    if (this.filas.length > MAX_FILAS) {
      this.filas.splice(0, this.filas.length - MAX_FILAS);
      this.recortado = true;
    }
    // La próxima muestra queda en la siguiente marca de la cuadrícula inicio + k·intervalo
    while (this.proxima <= fila.t + 1e-6) this.proxima += this.intervalo;
  }

  /** bomba: nuevo estado (true = arranca); causa: texto corto. */
  agregarEvento(t, nivel, bomba, causa) {
    this.eventos.push({ t, nivel, bomba, causa, duracion: t - this.ultimoCambio });
    this.ultimoCambio = t;
    if (this.eventos.length > MAX_FILAS) this.eventos.shift();
  }

  cambiarIntervalo(segundos, tActual) {
    this.intervalo = segundos;
    const k = Math.ceil((tActual - this.inicio) / segundos - 1e-9);
    this.proxima = this.inicio + Math.max(0, k) * segundos;
    if (this.filas.length && this.proxima <= this.filas[this.filas.length - 1].t + 1e-6) this.proxima += segundos;
  }

  guardarEscenario(escenario) {
    this.escenarios.push(escenario);
    escribirEscenarios(this.escenarios);
  }

  quitarEscenario(indice) {
    this.escenarios.splice(indice, 1);
    escribirEscenarios(this.escenarios);
  }

  get horasRegistradas() {
    return this.filas.length ? (this.filas[this.filas.length - 1].t - this.inicio) / 3600 : 0;
  }
}

// ── Construcción del libro ────────────────────────────────────────────────
const enc = (v) => ({ v, estilo: 'encabezado' });
const sec = (v) => ({ v, estilo: 'seccion' });
const nota = (v) => ({ v, estilo: 'nota' });
const num = (v, dec = 2) => (typeof v === 'number' ? { v, dec } : v ?? null);

/** Valor de una fila de la instantánea para Excel: número con sus decimales o texto. */
function celdaValor(fila) {
  if (!fila) return null;
  if (typeof fila.valor === 'number') return fila.unidad === 'COP' ? { v: fila.valor, moneda: true } : { v: fila.valor, dec: fila.dec ?? 2 };
  return fila.valor ?? null;
}

/**
 * Une los esquemas de varias instantáneas conservando el orden: una fila que solo
 * aparece en algunos escenarios (p. ej. el rebose) queda después de su vecina.
 */
export function unirEsquemas(listas) {
  const orden = [];
  const vistos = new Set();
  for (const filas of listas) {
    let pos = 0;
    for (const f of filas) {
      const i = orden.findIndex((o) => o.clave === f.clave);
      if (i >= 0) { pos = i + 1; continue; }
      if (!vistos.has(f.clave)) {
        orden.splice(pos, 0, { clave: f.clave, bloque: f.bloque, grupo: f.grupo, etiqueta: f.etiqueta, unidad: f.unidad });
        vistos.add(f.clave);
        pos += 1;
      }
    }
  }
  return orden;
}

function hojaResumen({ meta, resumen, registro, hojas }) {
  const filas = [
    [{ v: 'Simulador hídrico 3D · Santa Marta', estilo: 'titulo' }],
    [nota('Abastecimiento de agua y arroyo canalizado. Libro generado por el simulador.')],
    [],
    [sec('Datos de la exportación'), sec(''), sec('')],
    ['Fecha y hora de la exportación', meta.fecha],
    ['Tiempo simulado al exportar', meta.reloj],
    ['Inicio del registro', relojSimulado(registro.inicio).texto],
    ['Horas registradas', num(registro.horasRegistradas, 2), 'h'],
    ['Intervalo de registro', nombreIntervalo(registro.intervalo)],
    ['Filas de la serie de tiempo', registro.filas.length],
    ['Arranques y paradas registrados', registro.eventos.length],
    ['Escenarios guardados', registro.escenarios.length],
    ['Energía consumida durante el registro', num(registro.energia, 2), 'kWh'],
    ['Horas con la bomba encendida durante el registro', num(registro.segundosBomba / 3600, 2), 'h'],
    [],
    [sec('Estado al exportar'), sec(''), sec('')],
    ...resumen.map(([etiqueta, valor, unidad = '', dec = 2]) => [
      etiqueta,
      typeof valor === 'number' ? (unidad === 'COP' ? { v: valor, moneda: true } : { v: valor, dec }) : valor,
      unidad,
    ]),
    [],
    [sec('Contenido del libro'), sec(''), sec('')],
  ];
  // Qué tiene cada hoja: la descripción ocupa B y C combinadas y se ajusta en
  // varias líneas, para que la hoja quepa a lo ancho al imprimirla.
  const altos = {};
  const combinar = [];
  for (const [nombre, texto] of hojas) {
    const i = filas.length;
    filas.push([{ v: nombre, estilo: 'seccionArriba' }, { v: texto, estilo: 'parrafo' }]);
    combinar.push(`B${i + 1}:C${i + 1}`);
    altos[i] = 15 * Math.max(1, Math.ceil(String(texto).length / 50));   // unas 50 letras por línea
  }
  filas.push(
    [],
    [nota('Los valores se guardan con todos sus decimales: el formato de la celda solo cambia cómo se ven.')],
    [nota('El separador decimal (punto o coma) depende de la configuración regional de Excel.')],
  );
  if (registro.recortado) filas.push([nota(`La serie de tiempo guarda las últimas ${MAX_FILAS} filas; las más antiguas se descartaron.`)]);
  return { nombre: 'Resumen', columnas: [46, 30, 12], filas, altos, combinar };
}

function hojaParametrosResultados(actual, escenarios) {
  const columnas = [...escenarios, actual];
  const esquema = unirEsquemas(columnas.map((c) => c.filas));
  const indices = columnas.map((c) => new Map(c.filas.map((f) => [f.clave, f])));
  const LETRAS_COLUMNA = 24;   // caben unas 24 letras en una columna de ancho 22
  const filas = [
    [{ v: 'Parámetros y resultados', estilo: 'titulo' }],
    [nota('Una columna por escenario guardado; la última es el estado al momento de exportar.')],
    [],
    [enc('Variable'), enc('Unidad'), ...columnas.map((c) => enc(c.nombre))],
    [{ v: 'Momento de la simulación', estilo: 'etiqueta' }, null, ...columnas.map((c) => ({ v: c.momento, estilo: 'etiqueta' }))],
  ];
  let bloque = null;
  let grupo = null;
  for (const e of esquema) {
    if (e.bloque !== bloque) {
      bloque = e.bloque;
      grupo = null;
      filas.push([]);
      filas.push([sec(bloque.toUpperCase()), sec(''), ...columnas.map(() => sec(''))]);
    }
    if (e.grupo !== grupo) {
      grupo = e.grupo;
      filas.push([sec(grupo), sec(''), ...columnas.map(() => sec(''))]);
    }
    // Los textos largos (material, ecuación…) se parten en líneas dentro de su
    // columna en vez de quedar cortados por la columna vecina; la fila no lleva
    // alto fijo, así que Excel la agranda lo necesario.
    const valores = indices.map((m) => {
      const c = celdaValor(m.get(e.clave));
      return typeof c === 'string' && c.length > LETRAS_COLUMNA ? { v: c, estilo: 'ajuste' } : c;
    });
    filas.push([e.etiqueta, e.unidad || null, ...valores]);
  }
  return {
    nombre: 'Parámetros y resultados',
    columnas: [50, 12, ...columnas.map(() => 22)],
    congelar: { filas: 4, columnas: 2 },
    altos: { 3: 30 },
    horizontal: true,
    filas,
  };
}

const COLUMNAS_SERIE = [
  ['Día', 6, (f) => relojSimulado(f.t).dia],
  ['Hora', 8, (f) => relojSimulado(f.t).hora],
  ['Tiempo desde el inicio (h)', 12, (f, r) => num((f.t - r.inicio) / 3600, 2)],
  ['Nivel del tanque (m)', 11, (f) => num(f.nivel, 3)],
  ['Volumen almacenado (m³)', 12, (f) => num(f.volumen, 2)],
  ['Llenado (%)', 9, (f) => num(f.llenado, 1)],
  ['Bomba', 11, (f) => (f.bomba ? 'Encendida' : 'Apagada')],
  ['Caudal bombeado (L/s)', 11, (f) => num(f.Qin, 2)],
  ['Factor de consumo (× QMD)', 11, (f) => num(f.factor, 3)],
  ['Caudal consumido (L/s)', 11, (f) => num(f.Qsal, 2)],
  ['Altura dinámica (m)', 11, (f) => (f.bomba ? num(f.Hb, 2) : null)],
  ['Potencia de la bomba (kW)', 11, (f) => num(f.potencia, 2)],
  ['Presión mínima en la red (m.c.a.)', 12, (f) => num(f.presionRed, 2)],
  ['Vivienda de análisis', 10, (f) => f.casa],
  ['Carga en el grifo (m.c.a.)', 11, (f) => num(f.Hcasa, 2)],
  ['Estado del servicio', 22, (f) => f.estado],
  ['Horas de bombeo acumuladas (h)', 13, (f) => num(f.horasBomba, 2)],
  ['Energía acumulada (kWh)', 12, (f) => num(f.energia, 2)],
  ['Costo de la energía acumulada (COP)', 15, (f) => ({ v: f.costoEnergia, moneda: true })],
  ['Uso del canal del arroyo (%)', 12, (f) => num(f.usoCanal, 1)],
];

function hojaSerie(registro) {
  const filas = [COLUMNAS_SERIE.map(([t]) => enc(t))];
  for (const f of registro.filas) filas.push(COLUMNAS_SERIE.map(([, , valor]) => valor(f, registro)));
  if (!registro.filas.length) filas.push([nota('Aún no hay registros: deja correr el reloj de la simulación.')]);
  return {
    nombre: 'Serie de tiempo',
    columnas: COLUMNAS_SERIE.map(([, w]) => w),
    congelar: { filas: 1, columnas: 2 },
    filtro: registro.filas.length ? rangoTabla(0, COLUMNAS_SERIE.length, registro.filas.length) : undefined,
    altos: { 0: 45 },
    horizontal: true,
    filas,
  };
}

function hojaEventos(registro) {
  const filas = [[
    enc('N°'), enc('Día'), enc('Hora'), enc('Tiempo desde el inicio (h)'), enc('Evento'),
    enc('Nivel (m)'), enc('Duración del tramo anterior (h)'), enc('Bomba en ese tramo'), enc('Causa'),
  ]];
  registro.eventos.forEach((e, k) => {
    const reloj = relojSimulado(e.t);
    filas.push([
      k + 1, reloj.dia, reloj.hora, num((e.t - registro.inicio) / 3600, 2),
      e.bomba ? 'Arranca' : 'Se apaga', num(e.nivel, 3), num(e.duracion / 3600, 2),
      e.bomba ? 'Apagada' : 'Encendida', e.causa,
    ]);
  });
  if (!registro.eventos.length) filas.push([nota('Aún no hay arranques ni paradas: la bomba no ha cambiado de estado en el registro.')]);
  else {
    filas.push([]);
    filas.push([nota('El primer tramo se cuenta desde el inicio del registro, así que puede ser más corto que un tramo completo.')]);
    filas.push([nota('Compara las duraciones con t_enc y t_apag de la hoja Ciclo y costo.')]);
  }
  return {
    nombre: 'Arranques y paradas',
    columnas: [6, 6, 8, 13, 11, 10, 14, 13, 34],
    congelar: { filas: 1 },
    horizontal: true,
    filtro: registro.eventos.length ? rangoTabla(0, 9, registro.eventos.length) : undefined,
    altos: { 0: 45 },
    filas,
  };
}

/**
 * Hoja con el ciclo de la bomba y el costo mensual escritos como fórmulas de
 * Excel: si se cambia un dato de entrada (en azul), Excel recalcula todo.
 * c: valores del simulador (también son la caché de las fórmulas).
 */
function hojaCiclo(c) {
  const e = (v, dec) => ({ v, dec, entrada: true });
  const formulas = c.automatico && c.alcanza && c.capta !== false;
  const filas = [
    [{ v: 'Ciclo de la bomba y costo mensual', estilo: 'titulo' }],
    [nota('Los datos de entrada están en azul; lo demás se calcula con fórmulas. Si cambias un dato, Excel recalcula el ciclo y el costo.')],
    [],
    [enc('Variable'), enc('Valor'), enc('Unidad'), enc('Ecuación')],
    [sec('Datos de entrada'), sec(''), sec(''), sec('')],
    /* 6 */ ['Diámetro del tanque D', e(c.Dtanque, 2), 'm', ''],
    /* 7 */ ['Nivel de arranque h_a', e(c.hA, 2), 'm', 'la bomba arranca al bajar a este nivel'],
    /* 8 */ ['Nivel de parada h_p', e(c.hP, 2), 'm', 'la bomba se apaga al subir a este nivel'],
    /* 9 */ ['Caudal de la bomba Q_b', e(c.Qb, 5), 'm³/s', ''],
    /* 10 */ ['Caudal máximo diario del sector QMD', e(c.Qs, 5), 'm³/s', 'el ciclo se calcula con el consumo igual al QMD'],
    /* 11 */ ['Cota del río z_río', e(c.cotaRio, 2), 'm', ''],
    /* 12 */ ['Cota del fondo del tanque z_t', e(c.cotaTanque, 2), 'm', ''],
    /* 13 */ ['Pérdidas por fricción en succión y aducción h_f', e(c.hf, 4), 'm', 'con el caudal de la bomba'],
    /* 14 */ ['Eficiencia de la bomba η', e(c.eficiencia, 2), '', ''],
    /* 15 */ ['Tarifa de energía', e(c.tarifa, 0), 'COP/kWh', ''],
    /* 16 */ ['Cargo fijo mensual b', e(c.cargoFijo, 0), 'COP', ''],
    /* 17 */ ['Densidad del agua ρ', e(997.05, 2), 'kg/m³', 'agua a 25 °C'],
    /* 18 */ ['Gravedad g', e(9.81, 2), 'm/s²', ''],
    /* 19 */ ['Eficiencia del motor η_m', e(c.etaMotor ?? 1, 3), '', `motor de ${c.motorHP ?? '—'} HP elegido en la pestaña Bombas`],
    [sec('Ciclo de la bomba (ecuaciones lineales)'), sec(''), sec(''), sec('')],
    /* 21 */ ['Área del tanque A', { f: 'PI()*B6^2/4', v: c.At, dec: 2 }, 'm²', 'A = π·D²/4'],
    /* 22 */ ['Volumen entre interruptores ΔV', { f: 'B21*(B8-B7)', v: c.dV, dec: 2 }, 'm³', 'ΔV = A·(h_p − h_a)'],
  ];
  if (formulas) {
    filas.push(
      /* 23 */ ['Tiempo encendida t_enc', { f: 'B22/(B9-B10)/3600', v: c.tEnc / 3600, dec: 2 }, 'h', 't_enc = ΔV/(Q_b − QMD)'],
      /* 24 */ ['Tiempo apagada t_apag', { f: 'B22/B10/3600', v: c.tApag / 3600, dec: 2 }, 'h', 't_apag = ΔV/QMD'],
      /* 25 */ ['Duración del ciclo', { f: 'B23+B24', v: c.ciclo / 3600, dec: 2 }, 'h', 't_enc + t_apag'],
      /* 26 */ ['Horas de bombeo al día', { f: '24*B23/B25', v: c.horasDia, dec: 2 }, 'h', '24·t_enc/(t_enc + t_apag) = 24·QMD/Q_b'],
      /* 27 */ ['Arranques por hora', { f: '1/B25', v: c.arranquesHora, dec: 3 }, '1/h', '1/ciclo'],
      [sec('Costo mensual de bombeo (ecuación lineal)'), sec(''), sec(''), sec('')],
      /* 29 */ ['Nivel medio mientras bombea', { f: '(B7+B8)/2', v: c.nivelMedio, dec: 3 }, 'm', '(h_a + h_p)/2'],
    );
  } else {
    const motivo = c.capta === false ? 'el río está por debajo de la rejilla: la bomba no trabaja'
      : (!c.automatico ? 'bombeo continuo: la bomba nunca se apaga' : 'Q_b ≤ QMD: la bomba no alcanza a llenar el tanque');
    const horas = c.capta === false ? 0 : 24;
    filas.push(
      /* 23 */ ['Tiempo encendida t_enc', c.capta === false ? 'no arranca' : 'no se apaga', '', motivo],
      /* 24 */ ['Tiempo apagada t_apag', '—', '', ''],
      /* 25 */ ['Duración del ciclo', '—', '', ''],
      /* 26 */ ['Horas de bombeo al día', { v: horas, dec: 2 }, 'h', horas ? 'trabaja todo el día' : 'no hay agua que captar'],
      /* 27 */ ['Arranques por hora', { v: 0, dec: 3 }, '1/h', ''],
      [sec('Costo mensual de bombeo (ecuación lineal)'), sec(''), sec(''), sec('')],
      /* 29 */ ['Nivel medio mientras bombea', { v: c.nivelMedio, dec: 3 }, 'm', c.alcanza ? 'el tanque se mantiene lleno' : 'el tanque termina vacío'],
    );
  }
  filas.push(
    /* 30 */ ['Altura dinámica media H_m', { f: 'B12+B29-B11+B13', v: c.Hmedia, dec: 2 }, 'm', 'H_m = z_t + nivel medio − z_río + h_f'],
    /* 31 */ ['Volumen bombeado al mes V', { f: 'B9*B26*3600*30', v: c.Vmes, dec: 2 }, 'm³', 'V = Q_b · horas · 3600 · 30'],
    /* 32 */ ['Pendiente m (costo de subir 1 m³)', { f: 'B15*B17*B18*B30/(B14*B19*3600000)', v: c.m, dec: 2 }, 'COP/m³', 'm = tarifa·ρ·g·H_m/(η·η_m·3.6×10⁶)'],
    /* 33 */ ['Energía eléctrica al mes E', { f: 'B17*B18*B30*B31/(B14*B19*3600000)', v: c.energia, dec: 2 }, 'kWh', 'E = ρ·g·H_m·V/(η·η_m·3.6×10⁶)'],
    /* 34 */ ['Costo mensual C', { f: 'B32*B31+B16', v: c.costo, moneda: true }, 'COP', 'C(V) = m·V + b'],
    [],
    [nota('El costo es mensual: usa el ciclo completo de la bomba, así que no cambia cuando la bomba se apaga o se prende.')],
    [nota('Mientras la bomba trabaja el nivel sube en línea recta de h_a a h_p; como H es lineal en el nivel, su promedio es la altura con el nivel medio.')],
    [nota('Se paga la energía eléctrica: la potencia en el eje se divide por la eficiencia de la bomba y la del motor.')],
  );
  return { nombre: 'Ciclo y costo', columnas: [46, 16, 10, 46], congelar: { filas: 4 }, horizontal: true, filas };
}

function hojaRevision(revision) {
  const textos = { ok: 'Cumple', aviso: 'Aviso', alerta: 'No cumple' };
  const filas = [
    [{ v: 'Revisión de los criterios de diseño', estilo: 'titulo' }],
    [nota('Estado al momento de exportar. Los criterios son valores de referencia editables; conviene contrastarlos con el RAS y con las normas de calidad del agua vigentes.')],
    [],
    [enc('Componente'), enc('Criterio'), enc('Resultado'), enc('Detalle')],
  ];
  // Un criterio o un detalle largo se parte en líneas dentro de su columna
  // (sin alto fijo: Excel agranda la fila lo necesario)
  const texto = (t, letras) => (String(t ?? '').length > letras ? { v: t, estilo: 'ajuste' } : t);
  for (const c of revision) filas.push([c.area ?? 'Acueducto', texto(c.texto, 66), textos[c.nivel] ?? c.nivel, texto(c.detalle, 84)]);
  return { nombre: 'Revisión del diseño', columnas: [13, 62, 12, 80], congelar: { filas: 4 }, filtro: revision.length ? `A4:D${4 + revision.length}` : undefined, horizontal: true, filas };
}

/**
 * Perfil de calidad del río: una fila cada 0.5 km desde el nacimiento hasta la
 * desembocadura. perfil: { puntos, marcas: [{ km, texto }], nota }.
 */
function hojaPerfil(perfil) {
  const filas = [
    [{ v: 'Perfil de calidad del río', estilo: 'titulo' }],
    [nota(perfil?.nota ?? 'Calidad del agua a lo largo del río con el vertimiento y el caudal del momento de exportar.')],
    [],
    [enc('Distancia (km)'), enc('Zona'), enc('DBO (mg/L)'), enc('Oxígeno disuelto (mg/L)'), enc('Saturación (mg/L)'),
      enc('Déficit de oxígeno (mg/L)'), enc('Coliformes fecales (NMP/100 mL)'), enc('Nitratos (mg/L de N)'), enc('Punto')],
  ];
  const puntos = perfil?.puntos ?? [];
  const marcas = perfil?.marcas ?? [];
  for (const x of puntos) {
    const aqui = marcas.filter((m) => Math.abs(m.km - x.km) < 0.25 - 1e-9).map((m) => m.texto).join('; ');
    filas.push([num(x.km, 1), x.zonaNombre ?? x.zona, num(x.DBO, 2), num(x.OD, 2), num(x.ODsat, 2), num(x.ODsat - x.OD, 2),
      { v: x.CF, dec: 0 }, num(x.NO3, 2), aqui ? { v: aqui, estilo: 'ajuste' } : null]);
  }
  if (!puntos.length) filas.push([nota('Sin datos del río.')]);
  return {
    nombre: 'Perfil del río',
    columnas: [10, 11, 10, 12, 11, 12, 15, 11, 40],
    congelar: { filas: 4 },
    filtro: puntos.length ? `A4:I${4 + puntos.length}` : undefined,
    altos: { 3: 45 },
    horizontal: true,
    filas,
  };
}

function hojaCantidades(cantidades) {
  const filas = [
    [{ v: 'Cantidades de obra de la red del barrio', estilo: 'titulo' }],
    [nota('Calculadas con el trazado, las tuberías y la zanja típica al momento de exportar.')],
    [],
    [enc('Ítem'), enc('Detalle'), enc('Cantidad'), enc('Unidad')],
    ...cantidades.map(([item, det, cant, und]) => [item, det, { v: cant, dec: und === 'und' ? 0 : 1 }, und]),
  ];
  return { nombre: 'Cantidades de obra', columnas: [40, 60, 12, 8], congelar: { filas: 4 }, horizontal: true, filas };
}

/**
 * Represa, embalse, central y línea con fórmulas de Excel (datos de entrada en azul).
 * c: valores del simulador (también son la caché de las fórmulas).
 */
function hojaRepresa(c) {
  const e = (v, dec) => ({ v, dec, entrada: true });
  const f = (formula, v, dec = 2) => (Number.isFinite(v) ? { f: formula, v, dec } : '—');
  const hayEnergia = c.Eent > 0;
  const filas = [
    [{ v: 'Represa, embalse y central hidroeléctrica', estilo: 'titulo' }],
    [nota('Los datos de entrada están en azul; lo demás se calcula con fórmulas. Si cambias un dato, Excel recalcula el embalse, la potencia, las pérdidas de la línea y los costos.')],
    [],
    [enc('Variable'), enc('Valor'), enc('Unidad'), enc('Ecuación')],
    [sec('Datos de entrada'), sec(''), sec(''), sec('')],
    /* 6 */ ['Altura de la presa H_p', e(c.Hp, 2), 'm', `presa en el km ${c.km} del río, lecho a la cota ${c.cotaLecho} m.s.n.m.`],
    /* 7 */ ['Nivel del agua en el embalse h', e(c.nivel, 3), 'm', 'sobre el lecho del río en la presa'],
    /* 8 */ ['Coeficiente del valle a', e(c.a, 0), 'm³/m²', 'valle en forma de V: V = a·h²'],
    /* 9 */ ['Caudal que entra al embalse Q_entra', e(c.Qin, 4), 'm³/s', `${Math.round(c.fraccionCuenca * 100)} % del caudal natural del río en la bocatoma`],
    /* 10 */ ['Caudal que suelta la presa Q_sale', e(c.Qsale, 4), 'm³/s', c.operacion],
    /* 11 */ ['Caudal turbinado Q_t', e(c.Qturb, 4), 'm³/s', `capacidad de la central: ${c.QturbMax} m³/s`],
    /* 12 */ ['Profundidad del río al pie de la presa y', e(c.yAbajo, 3), 'm', 'tirante normal (Manning) con el caudal que sale'],
    /* 13 */ ['Coeficiente de pérdida de la tubería forzada k', e(c.k, 2), 's²/m⁵', 'h_f = k·Q_t²'],
    /* 14 */ ['Eficiencia de la turbina y el generador η', e(c.eta, 2), '', ''],
    /* 15 */ ['Densidad del agua ρ', e(997.05, 2), 'kg/m³', 'agua a 25 °C'],
    /* 16 */ ['Gravedad g', e(9.81, 2), 'm/s²', ''],
    /* 17 */ ['Tensión de la línea U', e(c.kV, 1), 'kV', 'línea trifásica'],
    /* 18 */ ['Longitud de la línea L', e(c.L, 0), 'km', 'de la central a la ciudad'],
    /* 19 */ ['Resistencia del conductor r', e(c.r, 2), 'Ω/km', ''],
    /* 20 */ ['Factor de potencia fp', e(c.fp, 2), '', ''],
    /* 21 */ ['Costo de producir la energía', e(c.costoGeneracion, 0), 'COP/kWh', 'operación y mantenimiento de la central'],
    /* 22 */ ['Costo de operar la línea', e(c.costoLinea, 0), 'COP/kWh', 'por kWh que llega a la ciudad'],
    /* 23 */ ['Tarifa de la energía de la red', e(c.tarifa, 0), 'COP/kWh', ''],
    /* 24 */ ['Consumo de una vivienda', e(c.consumoVivienda, 0), 'kWh/mes', 'consumo de subsistencia por debajo de 1 000 m.s.n.m.'],
    [sec('Embalse (ecuación cuadrática)'), sec(''), sec(''), sec('')],
    /* 26 */ ['Volumen guardado V', { f: 'B8*B7^2', v: c.V, dec: 0 }, 'm³', 'V = a·h²'],
    /* 27 */ ['Volumen con el nivel máximo', { f: `B8*(B6-${c.bordeLibre})^2`, v: c.Vmax, dec: 0 }, 'm³', `nivel máximo = H_p − ${c.bordeLibre} m de borde libre`],
    /* 28 */ ['Área del espejo de agua A', { f: '2*B8*B7', v: c.A, dec: 0 }, 'm²', 'A = dV/dh = 2·a·h'],
    /* 29 */ ['Lo que entra menos lo que sale', { f: 'B9-B10', v: c.Qin - c.Qsale, dec: 4 }, 'm³/s', 'dV/dt = Q_entra − Q_sale'],
    /* 30 */ ['Cambio del nivel en un día', { f: '(B9-B10)*86400/B28', v: ((c.Qin - c.Qsale) * 86400) / c.A, dec: 3 }, 'm/día', 'dh/dt = (Q_entra − Q_sale)/A'],
    [sec('Central al pie de la presa'), sec(''), sec(''), sec('')],
    /* 32 */ ['Salto bruto H_b', { f: 'B7-B12', v: c.nivel - c.yAbajo, dec: 3 }, 'm', 'H_b = h − y'],
    /* 33 */ ['Pérdida en la tubería forzada h_f', { f: 'B13*B11^2', v: c.hf, dec: 3 }, 'm', 'h_f = k·Q_t²'],
    /* 34 */ ['Salto neto H_n', { f: 'B32-B33', v: c.Hn, dec: 3 }, 'm', 'H_n = H_b − h_f'],
    /* 35 */ ['Potencia eléctrica P', { f: 'B15*B16*B11*B34*B14/1000', v: c.P / 1000, dec: 2 }, 'kW', 'P = ρ·g·Q_t·H_n·η'],
    /* 36 */ ['Energía al mes E', { f: 'B35*24*30', v: c.Emes, dec: 0 }, 'kWh', 'E = P·24·30'],
    [sec('Línea a la ciudad (pérdidas cuadráticas en la corriente)'), sec(''), sec(''), sec('')],
    /* 38 */ ['Corriente I', { f: 'B35*1000/(SQRT(3)*B17*1000*B20)', v: c.I, dec: 2 }, 'A', 'I = P/(√3·U·fp)'],
    /* 39 */ ['Potencia que se pierde en la línea P_p', { f: '3*B38^2*B19*B18/1000', v: c.perdidas / 1000, dec: 3 }, 'kW', 'P_p = 3·I²·r·L'],
    /* 40 */ ['Parte de la potencia que se pierde', { f: 'IF(B35>0,100*B39/B35,0)', v: 100 * c.fraccionPerdida, dec: 2 }, '%', 'P_p/P'],
    /* 41 */ ['Energía que llega a la ciudad al mes', { f: '(B35-B39)*24*30', v: c.Eent, dec: 0 }, 'kWh', 'E_ciudad = (P − P_p)·24·30'],
    [sec('Costos de operación (al mes)'), sec(''), sec(''), sec('')],
    /* 43 */ ['Producir la energía', { f: 'B21*B36', v: c.costoGenerar, moneda: true }, 'COP', 'costo de producir × E'],
    /* 44 */ ['Llevarla a la ciudad (línea)', { f: 'B22*B41', v: c.costoLinea * c.Eent, moneda: true }, 'COP', 'costo de la línea × E_ciudad'],
    /* 45 */ ['Costo del kWh puesto en la ciudad', hayEnergia ? f('B43/B41+B22', c.costoPuesto, 2) : 'sin energía', 'COP/kWh', 'producir / E_ciudad + línea: las pérdidas encarecen cada kWh'],
    /* 46 */ ['Ahorro frente a la tarifa de la red', hayEnergia ? f('B23-B45', c.tarifa - c.costoPuesto, 2) : '—', 'COP/kWh', ''],
    /* 47 */ ['Viviendas que puede abastecer', { f: 'B41/B24', v: c.Eent / c.consumoVivienda, dec: 0 }, 'viviendas', 'E_ciudad / consumo de una vivienda'],
    [sec('Agua para la ciudad: costo de operación al mes'), sec(''), sec(''), sec('')],
    /* 49 */ ['Volumen que consume la ciudad al mes', e(c.Vmes, 0), 'm³', 'el volumen bombeado del acueducto'],
    /* 50 */ ['Energía para bombearla del río', e(c.Ebombeo, 1), 'kWh', 'la del costo de bombeo (pestaña Captación)'],
    /* 51 */ ['Costo de operar la tubería por gravedad', e(c.costoGravedad, 0), 'COP/m³', `${c.camaras} cámaras de quiebre de presión en ${c.desnivel} m de desnivel`],
    /* 52 */ ['Bombear del río con energía de la red', { v: c.costoRed, moneda: true, entrada: true }, 'COP', 'costo mensual de bombeo, con el cargo fijo'],
    /* 53 */ ['Bombear del río con energía de la represa', hayEnergia ? { f: 'B50*B45', v: c.Ebombeo * c.costoPuesto, moneda: true } : '—', 'COP', 'energía de bombeo × kWh puesto en la ciudad'],
    /* 54 */ ['Traerla del embalse por gravedad', { f: 'B49*B51', v: c.Vmes * c.costoGravedad, moneda: true }, 'COP', 'volumen × costo por m³'],
    [],
    [nota('Solo son costos de operación: no incluyen construir la presa, la línea ni la tubería.')],
    [nota('Con el doble de tensión la corriente baja a la mitad y las pérdidas, a la cuarta parte.')],
  ];
  return { nombre: 'Represa y energía', columnas: [46, 16, 10, 50], congelar: { filas: 4 }, horizontal: true, filas };
}

/** Un año de operación del embalse, mes a mes, y el caudal del río en la bocatoma con la represa y sin ella. */
function hojaEmbalseMeses(ano) {
  const meses = ano?.meses ?? [];
  const filas = [
    [{ v: 'Un año de operación del embalse', estilo: 'titulo' }],
    [nota(ano?.nota ?? 'Entra el caudal medio de cada mes; la presa guarda o suelta agua según la operación elegida.')],
    [],
    [enc('Mes'), enc('Entra (m³/s)'), enc('Sale (m³/s)'), enc('Turbinado (m³/s)'), enc('Vertido (m³/s)'), enc('Nivel al final (m)'),
      enc('Volumen al final (m³)'), enc('Energía (kWh)'), enc('Río en la bocatoma sin represa (m³/s)'), enc('Río en la bocatoma con represa (m³/s)')],
    ...meses.map((m) => [m.mes, num(m.Qin, 3), num(m.Qout, 3), num(m.Qturb, 3), num(m.vertido, 3), num(m.h, 2), { v: m.V, dec: 0 }, { v: m.E, dec: 0 },
      num(m.bocNatural, 3), num(m.bocConRepresa, 3)]),
  ];
  if (meses.length) {
    const n = 4 + meses.length;
    filas.push(['Año', { f: `AVERAGE(B5:B${n})`, v: meses.reduce((s, m) => s + m.Qin, 0) / meses.length, dec: 3 },
      { f: `AVERAGE(C5:C${n})`, v: meses.reduce((s, m) => s + m.Qout, 0) / meses.length, dec: 3 }, null, null, null, null,
      { f: `SUM(H5:H${n})`, v: ano.Eano, dec: 0 }]);
  } else filas.push([nota('Sin datos de la represa.')]);
  filas.push([], [nota('Caudales medios del mes (régimen de lluvias del Caribe: secas de diciembre a abril, lluvias en mayo y de septiembre a noviembre). La fila Año promedia los caudales y suma la energía.')]);
  return { nombre: 'Embalse mes a mes', columnas: [8, 11, 11, 13, 11, 12, 15, 13, 18, 18], congelar: { filas: 4 }, altos: { 3: 45 }, horizontal: true, filas };
}

/** Huella hídrica y de carbono del cultivo elegido, con fórmulas de Excel. */
function hojaHuella(c) {
  const e = (v, dec) => ({ v, dec, entrada: true });
  const conRef = c.ref > 0;
  const hayCosecha = c.produccion > 0;
  const filas = [
    [{ v: 'Huella hídrica y de carbono del cultivo', estilo: 'titulo' }],
    [nota('Los datos de entrada están en azul; lo demás se calcula con fórmulas (método de Hoekstra y otros, 2011). Si cambias un dato, Excel recalcula la huella.')],
    [],
    [enc('Variable'), enc('Valor'), enc('Unidad'), enc('Ecuación')],
    [sec('Datos del cultivo'), sec(''), sec(''), sec('')],
    /* 6 */ ['Cultivo', c.cultivo, '', c.producto],
    /* 7 */ ['Zona', c.zona, '', ''],
    /* 8 */ ['Rendimiento Y', e(c.Y, 2), 't/ha', 'por cosecha (promedio nacional)'],
    /* 9 */ ['Lluvia que el cultivo evapotranspira ET_verde', e(c.ETverde, 1), 'mm', 'en un ciclo: mín(ET_c, lluvia efectiva) cada día'],
    /* 10 */ ['Riego que el cultivo evapotranspira ET_azul', e(c.ETazul, 1), 'mm', 'en un ciclo: la necesidad neta de riego'],
    /* 11 */ ['Nitrógeno aplicado N', e(c.N, 0), 'kg/ha', 'por cosecha'],
    /* 12 */ ['Fracción que se lava α', e(c.alfa, 2), '', ''],
    /* 13 */ ['Concentración máxima c_máx', e(c.cmax, 1), 'mg/L', 'nitratos (como N)'],
    /* 14 */ ['Concentración natural c_nat', e(c.cnat, 1), 'mg/L', ''],
    /* 15 */ ['Área cultivada', e(c.area, 1), 'ha', ''],
    /* 16 */ ['Cosechas al año', e(c.ciclos, 0), '', ''],
    /* 17 */ ['Cosecha perdida por inundación', e(c.perdida, 3), '', 'fracción (0 a 1)'],
    [sec('Huella hídrica (función racional del rendimiento)'), sec(''), sec(''), sec('')],
    /* 19 */ ['Verde', { f: '10*B9/B8', v: c.verde, dec: 1 }, 'm³/t', 'HH_verde = 10·ET_verde/Y'],
    /* 20 */ ['Azul', { f: '10*B10/B8', v: c.azul, dec: 1 }, 'm³/t', 'HH_azul = 10·ET_azul/Y'],
    /* 21 */ ['Gris', { f: '(B12*B11/((B13-B14)/1000))/B8', v: c.gris, dec: 1 }, 'm³/t', 'HH_gris = (α·N/(c_máx − c_nat))/Y'],
    /* 22 */ ['Total', { f: 'B19+B20+B21', v: c.total, dec: 1 }, 'm³/t', 'verde + azul + gris'],
    /* 23 */ ['Promedio mundial', conRef ? e(c.ref, 0) : '—', 'm³/t', 'Mekonnen y Hoekstra (2011)'],
    /* 24 */ ['Frente al promedio mundial', conRef ? { f: 'B22/B23', v: c.total / c.ref, dec: 2 } : '—', 'veces', ''],
    /* 25 */ ['Total con la cosecha que deja la inundación', { f: 'IF(B17>=0.999,"no queda cosecha",B22/(1-B17))', v: c.perdida >= 0.999 ? 'no queda cosecha' : c.total / (1 - c.perdida), dec: 1 }, 'm³/t', 'la misma agua para menos toneladas'],
    [sec('Agua y cosecha al año'), sec(''), sec(''), sec('')],
    /* 27 */ ['Cosecha al año', { f: 'B8*B15*B16*(1-B17)', v: c.produccion, dec: 1 }, 't', 'Y · área · cosechas · (1 − pérdida)'],
    /* 28 */ ['Agua verde al año', { f: '10*B9*B15*B16', v: c.aguaVerde, dec: 0 }, 'm³', '1 mm sobre 1 ha son 10 m³'],
    /* 29 */ ['Agua azul al año', { f: '10*B10*B15*B16', v: c.aguaAzul, dec: 0 }, 'm³', ''],
    /* 30 */ ['Agua gris al año', { f: 'B12*B11/((B13-B14)/1000)*B15*B16', v: c.aguaGris, dec: 0 }, 'm³', ''],
    [sec('Huella de carbono de llevar la cosecha a la ciudad'), sec(''), sec(''), sec('')],
    /* 32 */ ['Distancia por carretera', e(c.dist, 0), 'km', `desde la ${c.zona.toLowerCase()}`],
    /* 33 */ ['Factor por la pendiente de la vía', e(c.fVia, 2), '', 'más consumo en las vías de montaña'],
    /* 34 */ ['Capacidad del camión', e(c.capacidad, 1), 't', ''],
    /* 35 */ ['Consumo cargado (ida)', e(c.consumoCargado, 2), 'L/km', 'ACPM'],
    /* 36 */ ['Consumo vacío (vuelta)', e(c.consumoVacio, 2), 'L/km', ''],
    /* 37 */ ['Factor de emisión del ACPM', e(c.factor, 2), 'kg CO₂/L', 'IPCC (2006)'],
    /* 38 */ ['Impuesto al carbono', e(c.impuesto, 2), 'COP/t CO₂e', 'tarifa de 2026 (DIAN, Resolución 000003)'],
    /* 39 */ ['Viajes al año', { f: 'ROUNDUP(B27/B34,0)', v: c.viajes, dec: 0 }, 'viajes', 'se redondea hacia arriba: un viaje lleva lo que quepa'],
    /* 40 */ ['ACPM al año', { f: 'B39*B32*(B35+B36)*B33', v: c.litros, dec: 1 }, 'L', 'viajes · distancia · (ida + vuelta) · factor'],
    /* 41 */ ['CO₂ al año', { f: 'B40*B37', v: c.kgCO2, dec: 1 }, 'kg', 'ACPM × factor de emisión'],
    /* 42 */ ['CO₂ por tonelada', hayCosecha ? { f: 'B41/B27', v: c.porTonelada, dec: 2 } : '—', 'kg/t', ''],
    /* 43 */ ['Costo del carbono al año', { f: 'B41/1000*B38', v: c.costo, moneda: true }, 'COP', 'CO₂ (t) × impuesto'],
    [],
    [nota('La huella azul es el agua de riego que el cultivo evapotranspira; lo que se pierde al regar vuelve a la cuenca (pestaña Riego).')],
    [nota('La huella gris es el agua que haría falta para diluir el nitrógeno que se lava hasta el límite de calidad.')],
  ];
  return { nombre: 'Huella hídrica', columnas: [46, 16, 10, 50], congelar: { filas: 4 }, horizontal: true, filas };
}

/** Todos los cultivos en la zona elegida y el cultivo elegido en las tres zonas. */
function hojaHuellaCultivos(h) {
  const cultivos = h?.cultivos ?? [];
  const zonas = h?.zonas ?? [];
  const filas = [
    [{ v: 'Huella hídrica y de carbono por cultivo', estilo: 'titulo' }],
    [nota(h?.nota ?? 'Comparación con el área, la dosis de nitrógeno y el camión del momento de exportar.')],
    [],
    [enc('Cultivo'), enc('Verde (m³/t)'), enc('Azul (m³/t)'), enc('Gris (m³/t)'), enc('Total (m³/t)'), enc('Promedio mundial (m³/t)'),
      enc('Frente al promedio'), enc('CO₂ del transporte (kg/t)'), enc('Pérdida con la inundación (%)'), enc('¿Se da en la zona?')],
    ...cultivos.map((x) => [x.nombre, num(x.verde, 0), num(x.azul, 0), num(x.gris, 0), num(x.total, 0), x.ref ? { v: x.ref, dec: 0 } : '—',
      x.ref ? num(x.total / x.ref, 2) : '—', num(x.co2, 2), num(100 * x.perdida, 1), x.apto ? 'Sí' : 'No']),
    [],
    [sec(`${h?.cultivo ?? 'El cultivo'} en las tres zonas`), sec(''), sec(''), sec(''), sec(''), sec(''), sec(''), sec(''), sec(''), sec('')],
    [enc('Zona'), enc('Verde (m³/t)'), enc('Azul (m³/t)'), enc('Gris (m³/t)'), enc('Total (m³/t)'), enc('Distancia a la ciudad (km)'),
      enc('Viajes al año'), enc('CO₂ del transporte (kg/t)'), enc('Costo del carbono (COP/año)'), enc('¿Se da en la zona?')],
    ...zonas.map((x) => [x.zona, num(x.verde, 0), num(x.azul, 0), num(x.gris, 0), num(x.total, 0), { v: x.dist, dec: 0 }, { v: x.viajes, dec: 0 },
      num(x.co2, 2), { v: x.costo, moneda: true }, x.apto ? 'Sí' : 'No']),
    [],
    [nota('Promedios mundiales de Mekonnen y Hoekstra (2011). Una huella mayor que el promedio indica un rendimiento más bajo, un clima más seco o mucho nitrógeno.')],
  ];
  return {
    nombre: 'Huella por cultivo', columnas: [30, 11, 11, 11, 11, 14, 12, 14, 15, 12], congelar: { filas: 4 }, altos: { 3: 45 },
    filtro: cultivos.length ? `A4:J${4 + cultivos.length}` : undefined, horizontal: true, filas,
  };
}

// ── Datos de las hojas de la represa y de la huella (desde los resultados del simulador) ──
/** Valores de la hoja Represa y energía. */
export function libroRepresa(p, r) {
  const rep = r.represa;
  return {
    km: P.PRESA.km, cotaLecho: P.PRESA.cotaLecho, Hp: rep.Hp, nivel: rep.nivel, a: P.PRESA.aValle, fraccionCuenca: P.PRESA.fraccionCuenca,
    Qin: rep.Qin, Qsale: rep.Qsale, Qturb: rep.Qturb, QturbMax: p.QturbMax, operacion: P.OPERACIONES[p.operacionPresa] ?? '',
    yAbajo: rep.yAbajo, k: P.PRESA.kForzada, eta: rep.eta, kV: p.tensionLinea, L: P.PRESA.distanciaCiudad, r: P.PRESA.rLinea, fp: P.PRESA.fp,
    costoGeneracion: p.costoGeneracion, costoLinea: p.costoLinea, tarifa: p.tarifaKWh, consumoVivienda: P.PRESA.consumoVivienda,
    V: rep.V, Vmax: rep.Vmax, A: rep.A, bordeLibre: P.PRESA.bordeLibre, hf: rep.hf, Hn: rep.Hn, P: rep.P, Emes: rep.Emes,
    I: rep.linea.I, perdidas: rep.linea.perdidas, fraccionPerdida: rep.linea.fraccion, Eent: rep.Eent,
    costoGenerar: rep.costoGenerar, costoPuesto: rep.costoPuesto,
    Vmes: r.Vmes, Ebombeo: r.costo.energia, costoGravedad: p.costoGravedad, costoRed: rep.agua.red, camaras: rep.camaras, desnivel: Math.round(rep.desnivel),
  };
}

/** Valores de la hoja Embalse mes a mes. */
export function libroAno(p, r) {
  const ano = r.anoRepresa;
  return {
    meses: ano.meses, Eano: ano.Eano,
    nota: `Operación: ${(P.OPERACIONES[p.operacionPresa] ?? '').toLowerCase()}; empieza en enero con el nivel actual (${r.represa.nivel.toFixed(2)} m). Caudal ambiental: ${ano.Qamb.toFixed(3)} m³/s.`,
  };
}

/** Valores de la hoja Huella hídrica (cultivo elegido). */
export function libroHuella(p, r) {
  const h = r.huella;
  const hh = h.hh;
  const d = h.d;
  const c = h.carbono;
  return {
    cultivo: G.CULTIVOS[h.cultivo]?.nombre ?? h.cultivo, producto: d.producto, zona: R.ZONAS[h.zona].nombre,
    Y: d.rend, ETverde: hh.agua.verde, ETazul: hh.agua.azul, N: hh.N, alfa: H.ALFA_N, cmax: H.CMAX_N, cnat: H.CNAT_N,
    area: p.areaRiego, ciclos: d.ciclos, perdida: h.perdida,
    verde: hh.verde, azul: hh.azul, gris: hh.gris, total: hh.total, ref: d.ref ? d.ref.verde + d.ref.azul + d.ref.gris : 0,
    produccion: h.produccion, aguaVerde: h.aguaAno.verde, aguaAzul: h.aguaAno.azul, aguaGris: h.aguaAno.gris,
    dist: c.dist, fVia: c.f, capacidad: p.capacidadCamion, consumoCargado: H.CAMION.consumoCargado, consumoVacio: H.CAMION.consumoVacio,
    factor: H.FACTOR_ACPM, impuesto: p.impuestoCarbono, viajes: c.viajes, litros: c.litros, kgCO2: c.kgCO2, porTonelada: c.porTonelada, costo: c.costo,
  };
}

/** Valores de la hoja Huella por cultivo. */
export function libroCultivos(p, r) {
  const h = r.huella;
  const suma = (ref) => (ref ? ref.verde + ref.azul + ref.gris : 0);
  return {
    cultivo: G.CULTIVOS[h.cultivo]?.nombre ?? h.cultivo,
    nota: `Cada cultivo en la ${R.ZONAS[h.zona].nombre.toLowerCase()} con ${p.areaRiego} ha, ${p.dosisN} % de la dosis típica de nitrógeno y camiones de ${p.capacidadCamion} t.`,
    cultivos: h.porCultivo.map((x) => ({
      nombre: x.nombre, verde: x.hh.verde, azul: x.hh.azul, gris: x.hh.gris, total: x.hh.total, ref: suma(x.ref),
      co2: x.carbono.porTonelada, perdida: H.perdidaTotal(x.danoRio, x.danoArroyo), apto: x.apto,
    })),
    zonas: h.porZona.map((x) => ({
      zona: R.ZONAS[x.zona].nombre, verde: x.hh.verde, azul: x.hh.azul, gris: x.hh.gris, total: x.hh.total,
      dist: x.carbono.dist, viajes: x.carbono.viajes, co2: x.carbono.porTonelada, costo: x.carbono.costo, apto: x.apto,
    })),
  };
}

/**
 * Arma las hojas del libro.
 * meta: { fecha, reloj }; resumen: [[etiqueta, valor, unidad, dec]];
 * actual: instantánea { nombre, momento, filas }; ciclo: valores de la hoja Ciclo y costo.
 */
export function construirHojas({ meta, resumen, actual, registro, ciclo, revision = [], cantidades = [], perfil = null, represa = null, ano = null, huella = null, cultivos = null }) {
  const contenido = [
    ['Parámetros y resultados', 'Todos los parámetros y resultados: una columna por escenario guardado y la última con el estado al exportar.'],
    ['Serie de tiempo', `Una fila cada ${nombreIntervalo(registro.intervalo)} de tiempo simulado: nivel, bomba, consumo, presiones, energía y costo acumulados.`],
    ['Arranques y paradas', 'Cada vez que la bomba arrancó o se apagó, con el nivel del tanque y la duración del tramo anterior.'],
    ['Ciclo y costo', 'Ciclo de la bomba y costo mensual escritos con fórmulas de Excel que se recalculan.'],
    ['Revisión del diseño', 'Los criterios de diseño del acueducto, el río, la represa, las bombas, el riego, la huella y el acuífero, con su resultado (cumple, aviso o no cumple).'],
    ['Cantidades de obra', 'Tuberías, accesorios, excavación y cama de apoyo de la red del barrio.'],
    ['Perfil del río', 'Oxígeno disuelto, DBO, coliformes y nitratos cada 0.5 km, del nacimiento a la desembocadura.'],
    ['Represa y energía', 'Embalse, potencia de la central, pérdidas de la línea y costos de operación de la energía y del agua para la ciudad, con fórmulas de Excel.'],
    ['Embalse mes a mes', 'Un año de operación: caudal que entra y que sale, nivel, energía y caudal del río en la bocatoma con la represa y sin ella.'],
    ['Huella hídrica', 'Huella verde, azul y gris del cultivo elegido y la huella de carbono de llevar la cosecha a la ciudad, con fórmulas de Excel.'],
    ['Huella por cultivo', 'Todos los cultivos en la zona elegida y el cultivo elegido en las tres zonas.'],
  ];
  return [
    hojaResumen({ meta, resumen, registro, hojas: contenido }),
    hojaParametrosResultados(actual, registro.escenarios),
    hojaSerie(registro),
    hojaEventos(registro),
    hojaCiclo(ciclo),
    hojaRevision(revision),
    hojaCantidades(cantidades),
    hojaPerfil(perfil),
    represa ? hojaRepresa(represa) : { nombre: 'Represa y energía', filas: [[nota('Sin datos de la represa.')]] },
    hojaEmbalseMeses(ano),
    huella ? hojaHuella(huella) : { nombre: 'Huella hídrica', filas: [[nota('Sin datos de la huella.')]] },
    hojaHuellaCultivos(cultivos),
  ];
}

/** Bytes del archivo .xlsx (Uint8Array) con todas las hojas. */
export function crearLibro(datos) {
  return crearXlsx(construirHojas(datos), {
    titulo: 'Simulación hídrica de Santa Marta',
    autor: 'Simulador hídrico 3D',
    fecha: datos.meta.fechaObjeto ?? new Date(),
  });
}

/** Nombre del archivo con la fecha y hora local: simulacion-hidrica_2026-11-01_14-35.xlsx */
export function nombreArchivo(fecha = new Date()) {
  const d2 = (n) => String(n).padStart(2, '0');
  return `simulacion-hidrica_${fecha.getFullYear()}-${d2(fecha.getMonth() + 1)}-${d2(fecha.getDate())}_${d2(fecha.getHours())}-${d2(fecha.getMinutes())}.xlsx`;
}

/** Descarga los bytes como archivo en el navegador. */
export function descargarArchivo(bytes, nombre) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
