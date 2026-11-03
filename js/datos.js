/**
 * datos.js — Registro de la simulación y exportación a Excel.
 * -----------------------------------------------------------------------
 * Mientras corre el reloj se guarda una fila cada cierto tiempo simulado
 * (serie de tiempo) y cada vez que la bomba arranca o se apaga. Además se pueden
 * guardar escenarios (todos los parámetros y resultados de un momento) para
 * compararlos. Todo se descarga en un libro de Excel con ocho hojas.
 * Este módulo no toca el DOM salvo en descargarArchivo().
 */
import { crearXlsx, rangoTabla } from './excel.js';

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
 * Arma las hojas del libro.
 * meta: { fecha, reloj }; resumen: [[etiqueta, valor, unidad, dec]];
 * actual: instantánea { nombre, momento, filas }; ciclo: valores de la hoja Ciclo y costo.
 */
export function construirHojas({ meta, resumen, actual, registro, ciclo, revision = [], cantidades = [], perfil = null }) {
  const contenido = [
    ['Parámetros y resultados', 'Todos los parámetros y resultados: una columna por escenario guardado y la última con el estado al exportar.'],
    ['Serie de tiempo', `Una fila cada ${nombreIntervalo(registro.intervalo)} de tiempo simulado: nivel, bomba, consumo, presiones, energía y costo acumulados.`],
    ['Arranques y paradas', 'Cada vez que la bomba arrancó o se apagó, con el nivel del tanque y la duración del tramo anterior.'],
    ['Ciclo y costo', 'Ciclo de la bomba y costo mensual escritos con fórmulas de Excel que se recalculan.'],
    ['Revisión del diseño', 'Los criterios de diseño del acueducto, el río, las bombas y el riego, con su resultado (cumple, aviso o no cumple).'],
    ['Cantidades de obra', 'Tuberías, accesorios, excavación y cama de apoyo de la red del barrio.'],
    ['Perfil del río', 'Oxígeno disuelto, DBO, coliformes y nitratos cada 0.5 km, del nacimiento a la desembocadura.'],
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
