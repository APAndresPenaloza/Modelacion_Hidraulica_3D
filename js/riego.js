/**
 * riego.js — Riego de cultivos en la zona rural de la cuenca.
 * -----------------------------------------------------------------------
 * Necesidad de agua de un cultivo en las zonas alta, media y baja del río:
 *   ET₀ (Hargreaves) = 0.0023·(T + 17.8)·√ΔT·R_a        [mm/día]
 *   ET_c = K_c·ET₀,   N_n = ET_c − P_e,   N_b = N_n/E_a  [mm/día]
 *   Q = N_b·A·10/(horas·3600)                           [m³/s]  (1 mm sobre 1 ha = 10 m³)
 * El sistema se diseña con la época seca (la más exigente); la época elegida solo
 * cambia cuántas horas al día se riega. Funciones puras, sin DOM.
 */
import * as M from './modelo.js';
import * as D from './diseno.js';
import * as R from './rio.js';
import * as B from './bombas.js';

/** Radiación extraterrestre media anual a 11° N, expresada como lámina evaporable [mm/día]. */
export const RA = 14.7;

/**
 * Cultivos: Kc de mitad de temporada (FAO-56, valores de referencia), rango de
 * altitud donde se dan bien [m.s.n.m.], métodos de riego adecuados, forma en la
 * escena 3D y si se come crudo (exige agua de mejor calidad).
 */
export const CULTIVOS = {
  banano: { nombre: 'Banano', Kc: 1.1, altitud: [0, 900], metodos: ['microaspersion', 'goteo', 'aspersion'], forma: 'platanera', color: 0x5f9a3a },
  platano: { nombre: 'Plátano', Kc: 1.1, altitud: [0, 2000], metodos: ['microaspersion', 'goteo', 'aspersion'], forma: 'platanera', color: 0x6a9c3c },
  palma: { nombre: 'Palma de aceite', Kc: 1.0, altitud: [0, 500], metodos: ['goteo', 'microaspersion', 'surcos'], forma: 'palma', color: 0x4f7f34 },
  arroz: { nombre: 'Arroz', Kc: 1.2, altitud: [0, 800], metodos: ['inundacion'], forma: 'pasto', color: 0x8fb54a },
  maiz: { nombre: 'Maíz', Kc: 1.2, altitud: [0, 2500], metodos: ['surcos', 'aspersion', 'pivote', 'goteo'], forma: 'maiz', color: 0x9db33e },
  yuca: { nombre: 'Yuca', Kc: 0.8, altitud: [0, 1800], metodos: ['surcos', 'aspersion', 'goteo'], forma: 'mata', color: 0x6f9445 },
  cacao: { nombre: 'Cacao', Kc: 1.05, altitud: [0, 1200], metodos: ['microaspersion', 'goteo'], forma: 'arbol', color: 0x3f6f35 },
  cafe: { nombre: 'Café', Kc: 0.95, altitud: [1000, 2000], metodos: ['goteo', 'microaspersion'], forma: 'arbusto', color: 0x2f5f2f },
  citricos: { nombre: 'Cítricos', Kc: 0.7, altitud: [0, 1800], metodos: ['goteo', 'microaspersion'], forma: 'arbol', color: 0x4a7d3a },
  hortalizas: { nombre: 'Hortalizas (tomate, cebolla, ají)', Kc: 1.05, altitud: [0, 2800], metodos: ['goteo', 'aspersion', 'surcos'], forma: 'mata', color: 0x7aa84a, crudo: true },
  pastos: { nombre: 'Pastos para ganado', Kc: 0.95, altitud: [0, 3000], metodos: ['aspersion', 'pivote', 'surcos'], forma: 'pasto', color: 0x86a94b },
};

/**
 * Métodos de riego: eficiencia de aplicación Ea y presión que necesita el emisor
 * a la entrada del lote [m.c.a.].
 */
export const METODOS_RIEGO = {
  inundacion: { nombre: 'Inundación (melgas o pozas)', Ea: 0.5, presion: 1, emisor: 'compuertas' },
  surcos: { nombre: 'Gravedad por surcos (tubería con compuertas)', Ea: 0.6, presion: 2, emisor: 'compuertas' },
  aspersion: { nombre: 'Aspersión', Ea: 0.75, presion: 30, emisor: 'aspersores' },
  pivote: { nombre: 'Pivote central', Ea: 0.85, presion: 25, emisor: 'pivote' },
  microaspersion: { nombre: 'Microaspersión', Ea: 0.85, presion: 15, emisor: 'microaspersores' },
  goteo: { nombre: 'Goteo', Ea: 0.9, presion: 10, emisor: 'goteros' },
};

/** Longitud de la succión de la bomba de riego [m]. */
export const L_SUCCION_RIEGO = 6;
/** Fracción máxima del caudal del río que se capta para riego (criterio de referencia). */
export const FRACCION_MAX_RIO = 0.25;
/** Coliformes fecales máximos en el agua para regar lo que se come crudo [NMP/100 mL]. */
export const CF_RIEGO_CRUDO = 1000;

/** Evapotranspiración de referencia de Hargreaves [mm/día]. */
export function et0Hargreaves(Tmed, dT, Ra = RA) {
  return 0.0023 * (Tmed + 17.8) * Math.sqrt(Math.max(0, dT)) * Ra;
}

/** Clima de una zona en una época: en lluvias el cielo nublado reduce ΔT en 2 °C. */
export function climaZona(zona, epoca) {
  const z = R.ZONAS[zona] ?? R.ZONAS.baja;
  const lluviosa = epoca === 'lluviosa';
  const dT = lluviosa ? z.dT - 2 : z.dT;
  return { z, Tmed: z.Tmed, dT, ET0: et0Hargreaves(z.Tmed, dT), Pe: z.lluvia[lluviosa ? 'lluviosa' : 'seca'] };
}

/** Necesidad de agua y caudal de riego de un cultivo. A en ha, horas de riego al día. */
export function necesidadRiego({ zona, cultivo, metodo, area, horas, epoca = 'seca' }) {
  const c = CULTIVOS[cultivo] ?? CULTIVOS.banano;
  const m = METODOS_RIEGO[metodo] ?? METODOS_RIEGO.goteo;
  const cl = climaZona(zona, epoca);
  const ETc = c.Kc * cl.ET0;
  const Nn = Math.max(0, ETc - cl.Pe);
  const Nb = Nn / m.Ea;
  const Vdia = Nb * area * 10;
  const Q = horas > 0 ? Vdia / (horas * 3600) : 0;
  return { c, m, ...cl, ETc, Nn, Nb, Vdia, Q, modulo: area > 0 ? M.m3sAlps(Q) / area : 0 };
}

export const cultivoApto = (cultivo, zona) => {
  const c = CULTIVOS[cultivo];
  const z = R.ZONAS[zona];
  return Boolean(c && z) && z.elevacion >= c.altitud[0] && z.elevacion <= c.altitud[1];
};
export const metodoAdecuado = (cultivo, metodo) => Boolean(CULTIVOS[cultivo]?.metodos.includes(metodo));

/** Altura de bombeo del riego: desnivel hasta el lote + presión del emisor + pérdidas [m]. */
export function alturaRiego(zona, metodo, hf) {
  const z = R.ZONAS[zona] ?? R.ZONAS.baja;
  const Hest = z.desnivelCampo + (METODOS_RIEGO[metodo] ?? METODOS_RIEGO.goteo).presion;
  return { Hest, H: Hest + hf };
}

/**
 * Riego completo. e: especificación de la tubería de riego (diseno.especTubo);
 * agua: calidad del río en la toma { CF, NO3, DBO }; Qrio: caudal del río en la toma [m³/s];
 * ciudad: { QMD [m³/s], qCasaQMD [m³/s por vivienda] } para comparar.
 */
export function calcularRiego(p, e, { agua, Qrio, ciudad }) {
  const base = { zona: p.zonaRiego, cultivo: p.cultivo, metodo: p.metodoRiego, area: p.areaRiego, horas: p.horasRiego };
  const dis = necesidadRiego({ ...base, epoca: 'seca' });
  const act = p.epoca === 'lluviosa' ? necesidadRiego({ ...base, epoca: 'lluviosa' }) : dis;
  const horasAct = dis.Nb > 0 ? (p.horasRiego * act.Nb) / dis.Nb : 0;
  const met = p.metodoPerdidas;
  const tubo = D.tramo(dis.Q, p.Lriego, e, met);
  const succion = D.tramo(dis.Q, L_SUCCION_RIEGO, e, met);
  const { Hest, H } = alturaRiego(p.zonaRiego, p.metodoRiego, tubo.hfReal + succion.hfReal);
  const Vmes = act.Vdia * 30;
  // Comparación con la ciudad
  const Vciudad = ciudad.QMD * 86400;
  const viviendas = ciudad.qCasaQMD > 0 ? dis.Vdia / (ciudad.qCasaQMD * 86400) : 0;
  // Nitrógeno que trae el agua del río: mg/L = g/m³
  const nitrogeno = p.areaRiego > 0 ? (agua.NO3 * Vmes) / 1000 / p.areaRiego : 0;
  // El riego en el día: desde las 06:00 durante las horas de la época
  const inicio = 6;
  const zona = R.ZONAS[p.zonaRiego] ?? R.ZONAS.baja;
  return {
    dis, act, horasAct, tubo, succion, Hest, H, hf: tubo.hfReal + succion.hfReal, Vmes,
    zona, inicio, Vciudad, fraccionCiudad: Vciudad > 0 ? dis.Vdia / Vciudad : 0, viviendas,
    agua, Qrio, fraccionRio: Qrio > 0 ? dis.Q / Qrio : Infinity, nitrogeno,
    apto: cultivoApto(p.cultivo, p.zonaRiego), adecuado: metodoAdecuado(p.cultivo, p.metodoRiego),
  };
}

/** ¿Se está regando a esta hora del día? */
export const regando = (rg, hora) => rg.horasAct > 0 && ((hora - rg.inicio + 24) % 24) < rg.horasAct;

/**
 * Variante del riego en la época seca con otra zona o con otro método (misma tubería,
 * misma bomba): necesidad, altura, potencias y energía eléctrica al mes.
 */
function variante(p, e, zona, metodo) {
  const n = necesidadRiego({ zona, cultivo: p.cultivo, metodo, area: p.areaRiego, horas: p.horasRiego });
  const hf = D.tramo(n.Q, p.Lriego, e, p.metodoPerdidas).hfReal + D.tramo(n.Q, L_SUCCION_RIEGO, e, p.metodoPerdidas).hfReal;
  const { H } = alturaRiego(zona, metodo, hf);
  const Pb = (M.RHO * M.G * n.Q * H) / p.eficienciaR;
  const motor = B.motorComercial(Pb / Math.max(1, Math.round(p.nBombasR)), p.rpmR);
  const Pe = Pb / motor.eta;
  return { n, H, Pb, Pe, motor, Emes: (Pe / 1000) * p.horasRiego * 30 };
}

/** Mismo cultivo y método en las tres zonas: tabla comparativa. */
export function compararZonas(p, e) {
  return Object.keys(R.ZONAS).map((id) => ({ id, zona: R.ZONAS[id], ...variante(p, e, id, p.metodoRiego), apto: cultivoApto(p.cultivo, id) }));
}

/** Todos los métodos para el cultivo y la zona actuales: tabla comparativa. */
export function compararMetodos(p, e) {
  return Object.keys(METODOS_RIEGO).map((id) => ({ id, m: METODOS_RIEGO[id], ...variante(p, e, p.zonaRiego, id), adecuado: metodoAdecuado(p.cultivo, id) }));
}

/** Criterios de diseño del riego. */
export function revisarRiego(p, rg, e) {
  const checks = [];
  const z = rg.zona;
  const c = rg.dis.c;
  const f2 = (x) => x.toFixed(2);
  R.revisar(checks, `Riego: ${c.nombre.toLowerCase()} se da bien en la ${z.nombre.toLowerCase()} (${R.miles(z.elevacion)} m.s.n.m.; el cultivo va de ${R.miles(c.altitud[0])} a ${R.miles(c.altitud[1])} m)`,
    rg.apto, 'Fuera de su rango de altitud el cultivo rinde poco o no prospera: ver la tabla de cultivos por zona.', 'aviso');
  R.revisar(checks, `Riego: ${rg.dis.m.nombre.toLowerCase()} es adecuado para ${c.nombre.toLowerCase()}`, rg.adecuado,
    `Métodos usuales para este cultivo: ${c.metodos.map((k) => METODOS_RIEGO[k].nombre.toLowerCase()).join(', ')}.`, 'aviso');
  R.revisar(checks, `Tubería de riego: velocidad ${f2(rg.tubo.V)} m/s entre ${p.Vmin} y ${p.Vmax} m/s`, rg.tubo.V >= p.Vmin && rg.tubo.V <= p.Vmax,
    'Menos de la mínima sedimenta; más de la máxima gasta energía en fricción y aumenta el golpe de ariete.', 'aviso');
  R.revisar(checks, `Tubería de riego: presión de la bomba ${rg.H.toFixed(1)} m ≤ presión de trabajo ${e.pnMca.toFixed(0)} m (${e.clase})`,
    rg.H <= e.pnMca, 'La bomba entrega su altura dinámica a la salida: se escoge una clase de mayor presión.');
  R.revisar(checks, `Toma de riego: ${f2(M.m3sAlps(rg.dis.Q))} L/s ≤ ${FRACCION_MAX_RIO * 100} % del caudal del río (${R.miles(M.m3sAlps(rg.Qrio))} L/s)`,
    rg.fraccionRio <= FRACCION_MAX_RIO, 'Criterio de referencia para dejar caudal ambiental aguas abajo; se contrasta con la concesión de aguas de la autoridad ambiental.', 'aviso');
  if (c.crudo) {
    R.revisar(checks, `Agua de riego: coliformes fecales ${R.miles(rg.agua.CF)} ≤ ${R.miles(CF_RIEGO_CRUDO)} NMP/100 mL (cultivo que se come crudo)`,
      rg.agua.CF <= CF_RIEGO_CRUDO, 'Valor de referencia para regar hortalizas y frutas que se consumen sin cocinar: un vertimiento aguas arriba de la toma lo puede superar.');
  }
  return checks;
}
