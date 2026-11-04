/**
 * huella.js — Huella hídrica de los cultivos, huella de carbono de llevar la cosecha a
 * la ciudad y daño del cultivo cuando se inunda.
 * -----------------------------------------------------------------------
 *  1. Huella hídrica (Hoekstra y otros, 2011): agua por tonelada cosechada [m³/t].
 *     Verde: la lluvia que el cultivo evapotranspira. Azul: el agua de riego que
 *     evapotranspira (la necesidad neta; lo que se pierde al regar vuelve a la cuenca).
 *     Gris: el agua que haría falta para diluir el nitrógeno que se lava hasta el límite:
 *       HH_verde = 10·ET_verde/Y,  HH_azul = 10·ET_azul/Y,  HH_gris = (α·N/(c_máx − c_nat))/Y
 *  2. Huella de carbono del transporte: viajes de ida (cargado) y vuelta (vacío) en camión
 *     hasta la ciudad; CO₂ = litros de ACPM × factor de emisión. Costo con la tarifa del
 *     impuesto nacional al carbono.
 *  3. Inundación del lote de la zona baja, que está en la vega del río y junto al canal
 *     del arroyo: la creciente del río (cuando pasa de la cota de la vega) y el desborde
 *     del arroyo dañan el cultivo según cuánto aguante encharcado:
 *       daño = mín(1, días/tolerancia) × mín(1, profundidad/0.30 m).
 *     En la montaña y el piedemonte los lotes están en la ladera, por encima de la creciente.
 * Funciones puras, sin DOM.
 */
import * as R from './rio.js';
import * as G from './riego.js';

/**
 * Datos de cada cultivo:
 *  rend: rendimiento [t/ha por ciclo]: promedio nacional 2025 de las Evaluaciones
 *        Agropecuarias (UPRA, 2026; preliminar); palma: racimos de fruta, con 3.6 t de
 *        aceite por hectárea y 21 % de extracción; pastos: forraje seco, aproximado.
 *  ciclo: días del ciclo (365 en los cultivos permanentes); ciclos: cosechas al año.
 *  N: nitrógeno aplicado [kg/ha por ciclo] (dosis típica de referencia, editable en %).
 *  ref: huella hídrica promedio mundial [m³/t] (Mekonnen y Hoekstra, 2011).
 *  tolerancia: días que aguanta encharcado sin perder la cosecha (aproximado).
 */
export const DATOS_CULTIVO = {
  banano: { rend: 25.4, ciclo: 365, ciclos: 1, N: 300, producto: 'racimos', ref: { verde: 660, azul: 97, gris: 33 }, tolerancia: 2 },
  platano: { rend: 11.4, ciclo: 365, ciclos: 1, N: 150, producto: 'racimos', ref: { verde: 1570, azul: 27, gris: 6 }, tolerancia: 2 },
  palma: { rend: 17.1, ciclo: 365, ciclos: 1, N: 120, producto: 'racimos de fruta', ref: { verde: 1057, azul: 0, gris: 40 }, tolerancia: 14 },
  arroz: { rend: 5.5, ciclo: 120, ciclos: 2, N: 150, producto: 'arroz paddy', ref: { verde: 1146, azul: 341, gris: 187 }, tolerancia: 10 },
  maiz: { rend: 3.2, ciclo: 120, ciclos: 2, N: 120, producto: 'grano', ref: { verde: 947, azul: 81, gris: 194 }, tolerancia: 3 },
  yuca: { rend: 12.2, ciclo: 300, ciclos: 1, N: 60, producto: 'raíces', ref: { verde: 550, azul: 0, gris: 13 }, tolerancia: 2 },
  cacao: { rend: 0.7, ciclo: 365, ciclos: 1, N: 80, producto: 'grano seco', ref: { verde: 19745, azul: 4, gris: 179 }, tolerancia: 4 },
  cafe: { rend: 1.2, ciclo: 365, ciclos: 1, N: 200, producto: 'café verde', ref: { verde: 15249, azul: 116, gris: 532 }, tolerancia: 2 },
  citricos: { rend: 16, ciclo: 365, ciclos: 1, N: 150, producto: 'frutas', ref: { verde: 401, azul: 110, gris: 49 }, tolerancia: 3 },
  hortalizas: { rend: 58.8, ciclo: 120, ciclos: 2, N: 180, producto: 'tomate', ref: { verde: 108, azul: 63, gris: 43 }, tolerancia: 1 },
  pastos: { rend: 12, ciclo: 365, ciclos: 1, N: 100, producto: 'forraje seco', ref: null, tolerancia: 7 },
};

/** Días de la época seca y de la de lluvias en el año (Santa Marta: secas de diciembre a abril). */
export const DIAS_EPOCA = { seca: 151, lluviosa: 214 };
export const ALFA_N = 0.1;          // fracción del nitrógeno que se lava (Mekonnen y Hoekstra, 2011)
export const CMAX_N = 10;           // mg/L de N-NO₃ (límite)
export const CNAT_N = 0;            // concentración natural supuesta (igual que la referencia)

/** Transporte a la ciudad: distancia por carretera desde cada zona [km] y camión de referencia. */
export const DISTANCIA_CIUDAD = { alta: 55, media: 28, baja: 6 };
export const PENDIENTE_VIA = { alta: 1.35, media: 1.15, baja: 1 };   // más consumo en las vías de montaña
export const CAMION = { capacidad: 10, consumoCargado: 0.3, consumoVacio: 0.2 };   // t y L/km
export const FACTOR_ACPM = 2.68;    // kg de CO₂ por litro de ACPM (IPCC, 2006)
export const IMPUESTO_CARBONO = 29070.49;   // COP por t de CO₂e desde febrero de 2026 (DIAN, Resolución 000003)

/** Profundidad sobre el lote desde la que hay daño completo [m] y duración del desborde del arroyo [días]. */
export const COTA_VEGA = 3.2;       // cota del terreno de la vega donde está el lote de la zona baja [m.s.n.m.]
export const PROF_DANO = 0.3;
export const DIAS_ARROYO = 0.25;
export const L_DESBORDE = 150;      // m de orilla del canal por donde se sale el agua

// ── 1. Huella hídrica ──────────────────────────────────────────────────────
/**
 * Evapotranspiración del cultivo en un ciclo, separada en verde (lluvia) y azul (riego) [mm].
 * fLluvia: lluvia del año frente a un año normal (El Niño o La Niña).
 */
export function aguaCiclo(cultivo, zona, fLluvia = 1) {
  const c = G.CULTIVOS[cultivo] ?? G.CULTIVOS.banano;
  const d = DATOS_CULTIVO[cultivo] ?? DATOS_CULTIVO.banano;
  const out = { verde: 0, azul: 0, ETc: 0, dias: d.ciclo };
  for (const epoca of ['seca', 'lluviosa']) {
    const cl = G.climaZona(zona, epoca, fLluvia);
    const dias = (d.ciclo * DIAS_EPOCA[epoca]) / 365;
    const ETc = c.Kc * cl.ET0;
    out.verde += Math.min(ETc, cl.Pe) * dias;
    out.azul += Math.max(0, ETc - cl.Pe) * dias;
    out.ETc += ETc * dias;
  }
  return out;
}

/**
 * Huella hídrica de un cultivo en una zona [m³/t].
 * fN: fracción de la dosis típica de nitrógeno; perdida: fracción de la cosecha perdida.
 */
export function huellaHidrica(cultivo, zona, { fN = 1, perdida = 0, fLluvia = 1 } = {}) {
  const d = DATOS_CULTIVO[cultivo] ?? DATOS_CULTIVO.banano;
  const agua = aguaCiclo(cultivo, zona, fLluvia);
  const Y = d.rend * (1 - Math.min(0.999, Math.max(0, perdida)));
  const N = d.N * fN;
  const grisHa = (ALFA_N * N) / ((CMAX_N - CNAT_N) / 1000);          // m³/ha: kg ÷ (kg/m³)
  const verde = (10 * agua.verde) / Y;
  const azul = (10 * agua.azul) / Y;
  const gris = grisHa / Y;
  return { cultivo, zona, d, agua, Y, N, grisHa, verde, azul, gris, total: verde + azul + gris };
}

// ── 2. Huella de carbono del transporte ───────────────────────────────────
/** CO₂ de llevar una cosecha de T toneladas desde la zona hasta la ciudad. */
export function carbonoTransporte(zona, T, { capacidad = CAMION.capacidad, tarifa = IMPUESTO_CARBONO } = {}) {
  const dist = DISTANCIA_CIUDAD[zona] ?? DISTANCIA_CIUDAD.baja;
  const f = PENDIENTE_VIA[zona] ?? 1;
  const viajes = T > 0 ? Math.ceil(T / capacidad) : 0;
  const litrosViaje = dist * (CAMION.consumoCargado + CAMION.consumoVacio) * f;
  const litros = viajes * litrosViaje;
  const kgCO2 = litros * FACTOR_ACPM;
  return {
    zona, dist, f, viajes, litrosViaje, litros, kgCO2, tCO2: kgCO2 / 1000,
    porTonelada: T > 0 ? kgCO2 / T : 0,                              // kg de CO₂ por t (= g por kg)
    costo: (kgCO2 / 1000) * tarifa, tarifa,
  };
}

// ── 3. Inundación del cultivo ──────────────────────────────────────────────
/**
 * Profundidad del agua sobre el lote por la creciente del río [m]: el lote de la zona
 * baja está en la vega, a la cota 3.20 m; los de las otras zonas, en la ladera.
 */
export function inundacionRio(zona, cotaRio) {
  return zona === 'baja' ? Math.max(0, cotaRio - COTA_VEGA) : 0;
}

/** Profundidad del agua que sale del canal del arroyo y cubre el lote junto a él [m]. */
export function inundacionArroyo(zona, exceso) {
  if (zona !== 'baja' || exceso <= 0) return 0;
  // El agua pasa sobre la orilla como sobre un vertedero de cresta ancha: q = 1.7·h^(3/2)
  return ((exceso / L_DESBORDE) / 1.7) ** (2 / 3);
}

/** Fracción de la cosecha que se pierde con una inundación (0 a 1). */
export function danoInundacion(cultivo, prof, dias) {
  if (prof < 0.02 || dias <= 0) return 0;
  const tol = (DATOS_CULTIVO[cultivo] ?? DATOS_CULTIVO.banano).tolerancia;
  return Math.min(1, dias / tol) * Math.min(1, prof / PROF_DANO);
}

/** Fracción perdida por la creciente del río y el desborde del arroyo juntos. */
export const perdidaTotal = (danoRio, danoArroyo) => 1 - (1 - danoRio) * (1 - danoArroyo);

/**
 * Todo junto: la huella del cultivo elegido, las comparaciones y la inundación.
 * cotaRio: cota del río en la bocatoma (con la represa); excesoArroyo: m³/s que no caben en el canal;
 * fLluvia: lluvia del año frente a un año normal (clima del año, lluvia.js).
 */
export function calcularHuella(p, { cotaRio, excesoArroyo, fLluvia = 1 }) {
  const zona = p.zonaRiego;
  const cultivo = p.cultivo;
  const d = DATOS_CULTIVO[cultivo] ?? DATOS_CULTIVO.banano;
  const fN = (p.dosisN ?? 100) / 100;
  // Inundación del lote
  const profRio = inundacionRio(zona, cotaRio);
  const profArroyo = inundacionArroyo(zona, excesoArroyo);
  const danoRio = danoInundacion(cultivo, profRio, p.diasInundacion);
  const danoArroyo = danoInundacion(cultivo, profArroyo, DIAS_ARROYO);
  const perdida = perdidaTotal(danoRio, danoArroyo);
  // El lote de la zona baja (en la escena se ve aunque el cultivo elegido esté en otra zona)
  const cultivoBaja = zona === 'baja' ? cultivo : 'banano';
  const bajaRio = inundacionRio('baja', cotaRio);
  const bajaArroyo = inundacionArroyo('baja', excesoArroyo);
  const loteBaja = {
    cultivo: cultivoBaja, profRio: bajaRio, profArroyo: bajaArroyo,
    perdida: perdidaTotal(danoInundacion(cultivoBaja, bajaRio, p.diasInundacion), danoInundacion(cultivoBaja, bajaArroyo, DIAS_ARROYO)),
  };
  // Huella hídrica sin inundación y con la cosecha que queda
  const hh = huellaHidrica(cultivo, zona, { fN, fLluvia });
  const hhInund = huellaHidrica(cultivo, zona, { fN, perdida, fLluvia });
  const produccion = d.rend * p.areaRiego * d.ciclos * (1 - perdida);          // t al año
  const produccionSin = d.rend * p.areaRiego * d.ciclos;
  const aguaAno = {
    verde: 10 * hh.agua.verde * p.areaRiego * d.ciclos,                        // m³ al año
    azul: 10 * hh.agua.azul * p.areaRiego * d.ciclos,
    gris: hh.grisHa * p.areaRiego * d.ciclos,
  };
  const carbono = carbonoTransporte(zona, produccion, { capacidad: p.capacidadCamion, tarifa: p.impuestoCarbono });
  // Comparaciones: el cultivo en las tres zonas, y todos los cultivos en la zona elegida
  const porZona = ['alta', 'media', 'baja'].map((z) => {
    const h = huellaHidrica(cultivo, z, { fN, fLluvia });
    const T = d.rend * p.areaRiego * d.ciclos;
    return { zona: z, apto: G.cultivoApto(cultivo, z), hh: h, carbono: carbonoTransporte(z, T, { capacidad: p.capacidadCamion, tarifa: p.impuestoCarbono }) };
  });
  const porCultivo = Object.keys(DATOS_CULTIVO).map((id) => {
    const h = huellaHidrica(id, zona, { fN, fLluvia });
    const dc = DATOS_CULTIVO[id];
    const T = dc.rend * p.areaRiego * dc.ciclos;
    return {
      id, nombre: G.CULTIVOS[id].nombre, apto: G.cultivoApto(id, zona), hh: h, ref: dc.ref,
      carbono: carbonoTransporte(zona, T, { capacidad: p.capacidadCamion, tarifa: p.impuestoCarbono }),
      danoRio: danoInundacion(id, profRio, p.diasInundacion), danoArroyo: danoInundacion(id, profArroyo, DIAS_ARROYO),
    };
  });
  const checks = [];
  R.revisar(checks, `Inundación: el cultivo pierde ${(100 * perdida).toFixed(0)} % de la cosecha`, perdida < 0.005,
    profRio > 0 || profArroyo > 0
      ? `Agua sobre el lote: ${profRio > 0 ? `${profRio.toFixed(2)} m por la creciente del río` : ''}${profRio > 0 && profArroyo > 0 ? ' y ' : ''}${profArroyo > 0 ? `${profArroyo.toFixed(2)} m por el desborde del arroyo` : ''}. Este cultivo aguanta unos ${d.tolerancia} ${d.tolerancia === 1 ? 'día' : 'días'} encharcado.`
      : (zona === 'baja' ? 'El lote no se inunda.' : 'El lote está en la ladera, por encima de la creciente del río.'), 'alerta');
  if (d.ref) {
    const r = d.ref.verde + d.ref.azul + d.ref.gris;
    R.revisar(checks, `Huella hídrica ${Math.round(hh.total)} m³/t frente al promedio mundial de ${Math.round(r)} m³/t`, hh.total <= 1.5 * r,
      'Más de 1.5 veces el promedio mundial: el cultivo usa mucha agua por tonelada en esta zona (clima, rendimiento o mucho nitrógeno).', 'aviso');
  }
  R.revisar(checks, `Huella gris ${Math.round(hh.gris)} m³/t ≤ huella azul ${Math.round(hh.azul)} m³/t`, hh.gris <= Math.max(hh.azul, 1),
    'El nitrógeno que se lava ensucia más agua de la que el cultivo consume del riego: conviene ajustar la dosis o repartirla en más aplicaciones.', 'aviso');
  return {
    zona, cultivo, d, fN, fLluvia, profRio, profArroyo, danoRio, danoArroyo, perdida, dias: p.diasInundacion, loteBaja,
    hh, hhInund, produccion, produccionSin, perdidaT: produccionSin - produccion, aguaAno, carbono, porZona, porCultivo, checks,
  };
}
