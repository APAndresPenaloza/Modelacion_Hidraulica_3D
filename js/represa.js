/**
 * represa.js — Represa y embalse en la zona alta del río.
 * -----------------------------------------------------------------------
 *  1. Embalse: el valle tiene forma de V, así que el volumen crece con el cuadrado
 *     del nivel: V(h) = a·h² (ecuación cuadrática), h = √(V/a) y el área del espejo
 *     A(h) = 2·a·h (recta).
 *  2. Operación: suelta lo que entra (filo de agua), un caudal fijo o solo el caudal
 *     ambiental (guarda el resto). Balance: dV/dt = Q_entra − Q_sale (recta en el tiempo).
 *  3. Central al pie de la presa: P = ρ·g·Q·H_n·η, con H_n = h − y_abajo − k·Q².
 *  4. Costos de operación: producir la energía, llevarla a la ciudad por la línea
 *     (pérdidas P_p = 3·I²·r·L, cuadráticas en la corriente) y, para el agua de la
 *     ciudad, bombear del río o traerla por gravedad desde el embalse.
 *  5. Caudal que llega a las zonas alta, media y baja con la represa y sin ella, y
 *     una simulación mes a mes de un año.
 * Funciones puras, sin DOM.
 */
import * as M from './modelo.js';
import * as R from './rio.js';
import * as L from './lluvia.js';

/** Sitio de la presa y constantes del embalse, la central y la línea. */
export const PRESA = Object.freeze({
  km: 7,                    // km del río (zona alta, aguas arriba del vertimiento de la zona alta)
  fraccionCuenca: 0.25,     // parte del caudal de la bocatoma que nace aguas arriba de la presa
  cotaLecho: 1250,          // cota del lecho del río en la presa [m.s.n.m.]
  aValle: 6579,             // V = a·h² [m³/m²]: con 38 m de agua guarda 9.5 millones de m³
  bordeLibre: 2,            // m entre el nivel máximo de operación y la cresta
  fraccionMinima: 0.35,     // nivel mínimo de operación: 35 % de la altura de la presa
  kForzada: 0.5,            // pérdida en la tubería forzada h = k·Q² [s²/m⁵]
  distanciaCiudad: 40,      // km de línea eléctrica y de tubería hasta la ciudad
  rLinea: 0.3,              // resistencia del conductor de la línea [Ω/km]
  fp: 0.95,                 // factor de potencia
  consumoVivienda: 173,     // consumo de subsistencia por debajo de 1 000 m.s.n.m. [kWh/mes]
  evaporacion: 4,           // evaporación del espejo de agua [mm/día] (informativa)
  presionTramo: 100,        // m.c.a. máximos por tramo de la tubería por gravedad (cámaras de quiebre)
});

export const OPERACIONES = {
  filo: 'Soltar lo que entra (filo de agua)',
  fijo: 'Soltar un caudal fijo',
  guardar: 'Guardar agua: soltar solo el caudal ambiental',
};

/** Tensión de la línea eléctrica [kV]. */
export const TENSIONES = [13.2, 34.5];

/**
 * Caudal medio de cada mes frente al caudal medio del año (régimen bimodal del Caribe):
 * está en lluvia.js, que lo cambia con el clima del año (El Niño o La Niña).
 */
export const { MESES } = L;

// ── Embalse ────────────────────────────────────────────────────────────────
export const volumen = (h, a = PRESA.aValle) => a * Math.max(0, h) ** 2;
export const nivelDeVolumen = (V, a = PRESA.aValle) => Math.sqrt(Math.max(0, V) / a);
export const areaEspejo = (h, a = PRESA.aValle) => 2 * a * Math.max(0, h);
export const nivelMaximo = (alturaPresa) => Math.max(1, alturaPresa - PRESA.bordeLibre);
export const nivelMinimo = (alturaPresa) => PRESA.fraccionMinima * alturaPresa;

/** Caudal medio natural que entra al embalse (el de la condición normal del río). */
export const caudalMedioEntrada = () => PRESA.fraccionCuenca * R.caudalRio(R.LLUVIAS.normal.cota).Q;

/** Potencia eléctrica de la central [W] y sus alturas. */
export function central(Qt, h, Qsale, eta) {
  const alta = R.ZONAS.alta.cauce;
  const yAbajo = Qsale > 0 ? M.tiranteNormal(Qsale, alta.ancho, alta.pendiente, alta.n, 0) : 0;
  const Hb = Math.max(0, h - yAbajo);
  const hf = PRESA.kForzada * Qt * Qt;
  const Hn = Math.max(0, Hb - hf);
  return { yAbajo, Hb, hf, Hn, P: M.RHO * M.G * Qt * Hn * eta };
}

/** Pérdidas de la línea trifásica [W]: I = P/(√3·U·fp), P_p = 3·I²·r·L. */
export function perdidasLinea(P, kV, L = PRESA.distanciaCiudad, r = PRESA.rLinea, fp = PRESA.fp) {
  if (P <= 0) return { I: 0, perdidas: 0, fraccion: 0 };
  const I = P / (Math.sqrt(3) * kV * 1000 * fp);
  const perdidas = 3 * I * I * r * L;
  return { I, perdidas, fraccion: perdidas / P };
}

/** Caudal que suelta la presa según la operación, con los límites del embalse. */
export function caudalSalida(op, { Qin, Qfijo, Qamb, h, hMin, hMax }) {
  let Q = op === 'fijo' ? Qfijo : (op === 'guardar' ? Qamb : Qin);
  if (h >= hMax - 1e-9 && Q < Qin) Q = Qin;          // lleno: lo que sobra pasa por el vertedero
  if (h <= hMin + 1e-9 && Q > Qin) Q = Qin;          // en el mínimo: no puede soltar más de lo que entra
  return Math.max(0, Q);
}

/**
 * Represa en este instante.
 * Qboc: caudal natural del río en la bocatoma (sin represa) [m³/s]; h: nivel del embalse [m].
 */
export function calcularRepresa(p, Qboc, h) {
  const Hp = p.alturaPresa;
  const hMax = nivelMaximo(Hp);
  const hMin = nivelMinimo(Hp);
  const nivel = Math.min(hMax, Math.max(0, h));
  const Qin = PRESA.fraccionCuenca * Qboc;
  const Qmedio = caudalMedioEntrada();
  const Qamb = (p.caudalAmbiental / 100) * Qmedio;
  const Qsale = caudalSalida(p.operacionPresa, { Qin, Qfijo: p.Qpresa, Qamb, h: nivel, hMin, hMax });
  const Qturb = nivel >= hMin - 1e-6 ? Math.min(Qsale, p.QturbMax) : 0;   // bajo el mínimo la central para
  const Qvert = Qsale - Qturb;
  const eta = p.etaTurbina;
  const c = central(Qturb, nivel, Qsale, eta);
  const V = volumen(nivel);
  const Vmax = volumen(hMax);
  const Vmin = volumen(hMin);
  const A = areaEspejo(nivel);
  const Qevap = (A * PRESA.evaporacion) / 1000 / 86400;
  const dQ = Qsale - Qin;                               // > 0: el río lleva más que sin represa
  const neto = Qin - Qsale;                             // m³/s que se guardan (o se sacan) del embalse
  const tLlenar = neto > 1e-9 ? (Vmax - V) / neto : Infinity;
  const tVaciar = neto < -1e-9 ? (V - Vmin) / -neto : Infinity;
  const pendienteNivel = A > 0 ? neto / A : 0;          // m/s de subida del nivel

  // Energía y costos de operación (mes de 30 días)
  const horasMes = 24 * 30;
  const P = c.P;
  const Emes = (P / 1000) * horasMes;
  const linea = perdidasLinea(P, p.tensionLinea);
  const Eent = Emes - (linea.perdidas / 1000) * horasMes;
  const costoGenerar = p.costoGeneracion * Emes;
  const costoPuesto = Eent > 0 ? (costoGenerar / Eent) + p.costoLinea : Infinity;    // COP por kWh en la ciudad
  const viviendas = Eent / PRESA.consumoVivienda;
  const PinstW = central(p.QturbMax, hMax, p.QturbMax, eta).P;

  // Caudal en cada zona con la represa y sin ella
  const zonas = {};
  for (const [id, z] of Object.entries(R.ZONAS)) {
    const nat = z.fraccionQ * Qboc;
    zonas[id] = { natural: nat, conRepresa: Math.max(0, nat + dQ), cambio: nat > 0 ? dQ / nat : 0 };
  }
  // Agua para la ciudad por gravedad: desnivel y cámaras de quiebre de presión
  const cotaEmbalse = PRESA.cotaLecho + nivel;
  const desnivel = cotaEmbalse - p.cotaTanque;
  const camaras = Math.max(0, Math.ceil(desnivel / PRESA.presionTramo) - 1);

  const checks = [];
  const f2 = (x) => x.toFixed(2);
  R.revisar(checks, `Represa: caudal que suelta ${f2(Qsale)} m³/s ≥ caudal ambiental ${f2(Qamb)} m³/s`, Qsale >= Qamb - 1e-9,
    'Por debajo del caudal ambiental el tramo de río bajo la presa se queda casi seco: peces, plantas y los usuarios aguas abajo.');
  R.revisar(checks, `Embalse: nivel ${f2(nivel)} m ≥ nivel mínimo de operación ${f2(hMin)} m`, nivel >= hMin - 1e-9,
    'Con menos agua las turbinas toman aire y sedimento: la central se detiene hasta que el embalse vuelva a subir.', 'aviso');
  if (Qturb > 0) {
    R.revisar(checks, `Central: caudal turbinado ${f2(Qturb)} m³/s ≥ 30 % de la capacidad (${f2(0.3 * p.QturbMax)} m³/s)`, Qturb >= 0.3 * p.QturbMax - 1e-9,
      'Con muy poco caudal la turbina trabaja lejos de su punto óptimo y su eficiencia cae.', 'aviso');
  }
  R.revisar(checks, `Línea: pérdidas ${(100 * linea.fraccion).toFixed(1)} % ≤ 5 %`, linea.fraccion <= 0.05,
    'Las pérdidas crecen con el cuadrado de la corriente: con más tensión la corriente baja y se pierde mucho menos.', 'aviso');
  R.revisar(checks, `Energía puesta en la ciudad ${Number.isFinite(costoPuesto) ? Math.round(costoPuesto) : '—'} COP/kWh ≤ tarifa ${Math.round(p.tarifaKWh)} COP/kWh`,
    costoPuesto <= p.tarifaKWh, 'Si cuesta más que la tarifa, conviene más comprar la energía de la red.', 'aviso');

  return {
    Hp, hMax, hMin, nivel, Qin, Qmedio, Qamb, Qsale, Qturb, Qvert, eta, ...c, P, V, Vmax, Vmin, A, Qevap, dQ, neto,
    tLlenar, tVaciar, pendienteNivel, horasMes, Emes, linea, Eent, costoGenerar, costoPuesto, viviendas, PinstW,
    zonas, cotaEmbalse, desnivel, camaras, checks, llena: nivel >= hMax - 1e-9, vacia: nivel <= hMin + 1e-9,
  };
}

/** Costo de operación de las tres formas de llevar el agua a la ciudad [COP al mes]. */
export function costosAgua(rep, { Vmes, Ebombeo, costoRed, costoGravedad }) {
  return {
    red: costoRed,                                               // bombear del río con energía de la red
    represa: Ebombeo * rep.costoPuesto,                          // bombear con energía de la represa
    gravedad: Vmes * costoGravedad,                              // traerla del embalse por gravedad
  };
}

/**
 * Un año de operación, mes a mes, desde el nivel h0 y con la operación elegida.
 * Entra el caudal medio de cada mes con el clima del año (p.climaAno: la lluvia de cada
 * mes, lluvia.js); el embalse guarda o suelta según la operación.
 */
export function simularAno(p, h0) {
  const Hp = p.alturaPresa;
  const hMax = nivelMaximo(Hp);
  const hMin = nivelMinimo(Hp);
  const Qmedio = caudalMedioEntrada();
  const Qamb = (p.caudalAmbiental / 100) * Qmedio;
  const Qboc0 = R.caudalRio(R.LLUVIAS.normal.cota).Q;
  const clima = p.climaAno ?? 'normal';
  // Caudal de cada mes frente al medio de un año normal (en un año normal es MESES[k].f)
  const fMes = (k) => (clima === 'normal' ? MESES[k].f : L.caudalMes(k, clima) / Qboc0);
  let V = volumen(Math.min(hMax, Math.max(0, h0)));
  const Vmax = volumen(hMax);
  const Vmin = volumen(hMin);
  const meses = [];
  let Eano = 0;
  for (const [k, mes] of MESES.entries()) {
    const dt = mes.dias * 86400;
    const f = fMes(k);
    const Qin = Qmedio * f;
    const h = nivelDeVolumen(V);
    let Qout = caudalSalida(p.operacionPresa, { Qin, Qfijo: p.Qpresa, Qamb, h, hMin, hMax });
    // Que el embalse no se pase del máximo ni baje del mínimo dentro del mes
    let Vf = V + (Qin - Qout) * dt;
    if (Vf > Vmax) { Qout += (Vf - Vmax) / dt; Vf = Vmax; }
    if (Vf < Vmin && Qout > Qin) { Qout = Math.max(Qin, Qout - (Vmin - Vf) / dt); Vf = V + (Qin - Qout) * dt; }
    const hm = nivelDeVolumen((V + Vf) / 2);
    const Qturb = hm >= hMin - 1e-6 ? Math.min(Qout, p.QturbMax) : 0;
    const c = central(Qturb, hm, Qout, p.etaTurbina);
    const E = (c.P / 1000) * (dt / 3600);
    Eano += E;
    const dQ = Qout - Qin;
    meses.push({
      mes: mes.nombre, Qin, Qout, Qturb, vertido: Qout - Qturb, h: nivelDeVolumen(Vf), V: Vf, E,
      bocNatural: Qboc0 * f, bocConRepresa: Math.max(0, Qboc0 * f + dQ),
    });
    V = Vf;
  }
  return { meses, Eano, Qmedio, Qamb, clima };
}
