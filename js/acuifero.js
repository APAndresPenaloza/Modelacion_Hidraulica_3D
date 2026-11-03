/**
 * acuifero.js — El agua subterránea de las zonas alta, media y baja del río.
 * -----------------------------------------------------------------------
 *  1. Capas del terreno: suelo (zona no saturada), capa de arcilla si el
 *     acuífero es semiconfinado o confinado, acuífero y roca.
 *  2. Nivel freático frente al río: si queda más bajo que el río, el río le
 *     entrega agua al acuífero (río perdedor); si queda más alto, el acuífero
 *     alimenta el río (río ganador). Flujo de Darcy: v = K·i/n_e.
 *  3. Pozo que bombea: cono de abatimiento de Thiem s(r) = Q/(2πT)·ln(R/r), con
 *     el radio de influencia de Sichardt R = 3000·s·√K.
 *  4. Tiempo de viaje del agua del río hasta el pozo, curva de llegada y calidad
 *     del agua del pozo.
 * La infiltración vertical hasta el nivel freático y el índice GOD están en
 * rio.js (función acuifero). Funciones puras, sin DOM.
 */
import * as M from './modelo.js';
import * as R from './rio.js';

/** Material del acuífero: conductividad K [m/día], porosidad efectiva y remoción de bacterias [log₁₀/m]. */
export const MATERIALES_ACUIFERO = {
  grava: { nombre: 'Grava limpia', K: 100, ne: 0.25, remocion: 0.01 },
  arenaGruesa: { nombre: 'Arena gruesa con grava', K: 30, ne: 0.25, remocion: 0.03 },
  arena: { nombre: 'Arena media', K: 10, ne: 0.2, remocion: 0.06 },
  arenaFina: { nombre: 'Arena fina y limosa', K: 1, ne: 0.15, remocion: 0.15 },
};

export const COTA_LLANURA = 4.0;          // cota del terreno de la llanura junto al río [m.s.n.m.]

/**
 * El acuífero en cada zona del río. banca: altura del terreno junto al río sobre el lecho
 * [m]; material, espesor y suelo típicos (el panel los propone al cambiar de zona).
 *  · Alta: aluvión delgado de grava sobre roca, en el fondo del valle.
 *  · Media: abanico aluvial de arena gruesa y grava, el más permeable y profundo.
 *  · Baja: la llanura costera, de arena media (los valores base).
 * En la zona baja las cotas son las de la bocatoma (m.s.n.m.); en las otras se miden
 * desde un lecho a la cota 1.00 m, igual que en la bocatoma, para compararlas.
 */
export const ZONAS_ACUIFERO = {
  alta: { banca: 2.5, material: 'grava', espesor: 8, suelo: 'grava', tipo: 'libre' },
  media: { banca: 2.0, material: 'arenaGruesa', espesor: 30, suelo: 'arena', tipo: 'libre' },
  baja: { banca: COTA_LLANURA - 1, material: 'arena', espesor: 20, suelo: 'arena', tipo: 'semiconfinado' },
};
export const L_CONEXION = 150;            // distancia en la que el nivel freático se junta con el río [m]
export const RADIO_POZO = 0.15;           // radio del pozo [m]
export const K_COLIFORMES_ACUIFERO = 0.3; // muerte de coliformes en el agua subterránea [1/día]
export const DIAS_PROTECCION = 50;        // viaje mínimo de referencia entre el río y un pozo [días]
export const NO3_FONDO = 0.5;             // nitratos del agua subterránea sin contaminar [mg/L de N]
export const ABATIMIENTO_MAX = 0.6;       // abatimiento admisible: fracción del espesor del acuífero
export const DISPERSIVIDAD = 0.1;         // α_L / L (dispersión de la curva de llegada)

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1).replace('-', '−') : '—');
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2).replace('-', '−') : '—');

/** Complemento de la función de error (Abramowitz y Stegun 7.1.26, error < 1.5×10⁻⁷). */
export function erfc(x) {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const poli = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poli * Math.exp(-z * z);
  return x >= 0 ? 1 - erf : 1 + erf;
}

/**
 * Capas en cotas [m.s.n.m.] bajo la llanura: suelo hasta la profundidad d; si hay
 * capa de arcilla va debajo del suelo; luego el acuífero de espesor b y la roca.
 * nivel: nivel freático (o piezométrico) lejos del río.
 */
export function estratos(p, terreno = COTA_LLANURA) {
  const tipo = R.ACUIFEROS[p.tipoAcuifero] ?? R.ACUIFEROS.libre;
  const d = Math.max(0.1, p.profFreatico);
  const e = tipo.capa ? tipo.capa.espesor : 0;
  const b = Math.max(1, p.espesorAcuifero);
  const nivel = terreno - d;
  const techoAcuifero = nivel - e;
  return { tipo, d, e, b, terreno, nivel, baseSuelo: nivel, techoAcuifero, fondo: techoAcuifero - b };
}

/** Radio de influencia de Sichardt iterado con Thiem. Q [m³/s], T [m²/s], K [m/s]. */
export function conoAbatimiento(Q, T, K, rw = RADIO_POZO) {
  if (Q <= 0 || T <= 0) return { s: 0, R: rw, C: 0 };
  const C = Q / (2 * Math.PI * T);
  let Rr = 100;
  let s = 0;
  for (let k = 0; k < 200; k++) {
    s = C * Math.log(Math.max(Rr, rw * 1.01) / rw);
    const Rn = Math.max(rw * 1.5, 3000 * s * Math.sqrt(K));
    if (Math.abs(Rn - Rr) < 1e-9 * Rn) { Rr = Rn; break; }
    Rr = Rn;
  }
  s = C * Math.log(Math.max(Rr, rw * 1.01) / rw);
  return { s, R: Rr, C };
}

/** Abatimiento de Thiem a la distancia r del pozo [m]: s(r) = Q/(2πT)·ln(R/r). */
export const abatimientoEn = (cono, r) => (r >= cono.R ? 0 : cono.C * Math.log(cono.R / Math.max(r, RADIO_POZO)));

/** Nivel del agua subterránea sin bombeo a la distancia x del río [m]: en la orilla vale lo del río. */
export const nivelNatural = (a, x) => a.est.nivel + (a.hRio - a.est.nivel) * Math.exp(-Math.max(0, x) / (L_CONEXION / 3));

/** Nivel con el pozo bombeando (superposición): natural menos el abatimiento. */
export const nivelConPozo = (a, x) => nivelNatural(a, x) - abatimientoEn(a.cono, Math.abs(x - a.L));

/**
 * Fracción del agua del río que ya llegó al pozo t días después de empezar
 * (advección y dispersión en una dimensión): ½·erfc((1 − τ)/(2√(α·τ))), τ = t/t_viaje.
 */
export function curvaLlegada(tViaje, t) {
  if (!Number.isFinite(tViaje) || t <= 0) return 0;
  const tau = t / tViaje;
  return 0.5 * erfc((1 - tau) / (2 * Math.sqrt(DISPERSIVIDAD * tau)));
}

/**
 * El acuífero de la zona baja junto al río y el pozo de una finca.
 * rio: resultado de rio.calcularRio (calidad del agua que recarga y la infiltración vertical).
 */
export function calcularAcuifero(p, rio) {
  const mat = MATERIALES_ACUIFERO[p.materialAcuifero] ?? MATERIALES_ACUIFERO.arena;
  // Zona del corte: en la baja, el río de la bocatoma; en las otras, el de esa zona
  const zona = ZONAS_ACUIFERO[p.zonaAcuifero] ? p.zonaAcuifero : 'baja';
  const baja = zona === 'baja';
  const terreno = baja ? COTA_LLANURA : R.CAUCE.fondo + ZONAS_ACUIFERO[zona].banca;
  const est = estratos(p, terreno);
  const b = est.b;
  const hRio = baja ? p.cotaRio : R.CAUCE.fondo + rio.calidad.hid[zona].y;
  const dh = hRio - est.nivel;                         // > 0: el río está más alto que el acuífero
  const regimen = Math.abs(dh) < 0.05 ? 'equilibrio' : (dh > 0 ? 'perdedor' : 'ganador');
  const i = Math.abs(dh) / L_CONEXION;
  const K = mat.K;                                     // m/día
  const vNat = (K * i) / mat.ne;                       // velocidad real del agua [m/día]
  const qOrilla = K * i * b;                           // m³/día por metro de orilla
  // Pozo (Thiem con el radio de influencia de Sichardt)
  const Q = M.lpsAm3s(Math.max(0, p.Qpozo));
  const T = (K / 86400) * b;
  const cono = conoAbatimiento(Q, T, K / 86400);
  const L = Math.max(1, p.distanciaPozo);
  const sRio = abatimientoEn(cono, L);
  const sMax = ABATIMIENTO_MAX * b;
  const seco = cono.s > sMax;
  // ¿Llega agua del río al pozo? Si el cono alcanza el río y baja el nivel por debajo
  // del río, el pozo lo atrae (infiltración inducida); si no, solo si el río es perdedor.
  const capa = est.tipo.capa;
  const tCapa = capa ? capa.espesor / (capa.K / capa.ne) : 0;     // cruzar la arcilla bajo el cauce [días]
  let via = 'ninguna';
  let tHoriz = Infinity;
  if (Q > 0 && cono.R > L && dh + sRio > 0) {
    via = 'bombeo';
    tHoriz = (Math.PI * b * mat.ne * L * L) / (Q * 86400);     // t = π·b·n_e·L²/Q
  } else if (dh > 0) {
    via = 'natural';
    tHoriz = L / Math.max(vNat, 1e-9);
  }
  const tViaje = tHoriz + tCapa;
  const llega = Number.isFinite(tViaje);
  const agua = baja ? rio.recarga : R.aguaRecarga(rio.calidad.puntos, zona);
  const vert = baja ? rio.acu : R.acuifero(p, agua);
  const logs = mat.remocion * L + (capa ? capa.remocion * capa.espesor : 0);
  const CFpozo = llega ? agua.CF * Math.exp(-K_COLIFORMES_ACUIFERO * tViaje) * 10 ** -logs : 0;
  const NO3pozo = llega ? agua.NO3 : NO3_FONDO;
  const a = { zona, terreno, mat, est, b, hRio, dh, regimen, i, K, vNat, qOrilla, Q, T, cono, L, sRio, sMax, seco,
    tCapa, via, tHoriz, tViaje, llega, agua, logs, CFpozo, NO3pozo, vert };
  a.nivelPozo = nivelConPozo(a, L);
  a.vMedia = llega && Number.isFinite(tHoriz) && tHoriz > 0 ? L / tHoriz : 0;

  // Revisión: lo que se infiltra desde la superficie y el pozo
  const checks = [];
  const v = vert;
  R.revisar(checks, `Acuífero: nitratos que se infiltran ${f2(v.NO3)} ≤ 10 mg/L de N`, v.NO3 <= 10,
    'Los nitratos no se degradan en el suelo: tarde o temprano llegan al agua subterránea.');
  R.revisar(checks, `Acuífero: coliformes que llegan al nivel freático ${v.CF < 1 ? f2(v.CF) : R.miles(v.CF)} ≤ 1 NMP/100 mL`, v.CF <= 1,
    'Con suelos permeables y el agua cerca de la superficie las bacterias llegan vivas al agua subterránea.', 'aviso');
  R.revisar(checks, `Acuífero: vulnerabilidad GOD ${f2(v.god)} (${v.clase}) < 0.5`, v.god < 0.5,
    'Acuífero muy vulnerable: hay que proteger su zona de recarga de los vertimientos.', 'aviso');
  R.revisar(checks, `Pozo: abatimiento ${f2(cono.s)} m ≤ ${ABATIMIENTO_MAX * 100} % del espesor del acuífero (${f1(sMax)} m)`, !seco,
    'Si el agua baja más, el pozo se seca o la bomba succiona aire: se bombea menos, se reparte en varios pozos o se busca un material más permeable.');
  if (llega) {
    R.revisar(checks, `Pozo: el agua del río tarda ${f1(tViaje)} días en llegar ≥ ${DIAS_PROTECCION} días`, tViaje >= DIAS_PROTECCION,
      'Con menos días de viaje las bacterias y los virus del río pueden llegar vivos al pozo: se aleja el pozo del río o se bombea menos.', 'aviso');
  }
  R.revisar(checks, `Pozo: coliformes fecales ${CFpozo < 1 ? f2(CFpozo) : R.miles(CFpozo)} ≤ 1 NMP/100 mL`, CFpozo <= 1,
    'El agua del pozo se desinfecta antes de tomarla.', 'aviso');
  R.revisar(checks, `Pozo: nitratos ${f2(NO3pozo)} ≤ 10 mg/L de N`, NO3pozo <= 10,
    'Valor de referencia para agua de consumo: por encima hay riesgo para la salud de los bebés.');
  a.checks = checks;
  return a;
}
