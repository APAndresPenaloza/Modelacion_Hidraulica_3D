// Pruebas de la huella hídrica (verde, azul y gris), la huella de carbono del
// transporte y el daño del cultivo cuando se inunda.
// Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';
import * as H from '../js/huella.js';
import * as S from '../js/sistema.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a} (tol ${tol})`);
const base = { ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO };
const calcular = (cambios = {}) =>
  S.calcular({ ...base, ...cambios }, { nivel: 4.4, bomba: true, t: 6 * 3600 }).huella;

test('Huella hídrica: verde, azul y gris por tonelada (Hoekstra)', () => {
  const h = H.huellaHidrica('banano', 'baja');
  cerca(h.verde, (10 * h.agua.verde) / 25.4, 1e-9);
  cerca(h.azul, (10 * h.agua.azul) / 25.4, 1e-9);
  cerca(h.gris, (0.1 * 300) / (10 / 1000) / 25.4, 1e-9);    // 3 000 m³/ha repartidos en 25.4 t
  cerca(h.gris, 118.11, 0.01);
  cerca(h.agua.verde + h.agua.azul, h.agua.ETc, 1e-9);       // la ET del ciclo se reparte en verde y azul
  cerca(h.total, 790, 0.05 * 790);                           // cerca del promedio mundial del banano
});

test('El mismo cultivo gasta más agua azul en la zona baja (más calor y menos lluvia)', () => {
  const [alta, media, baja] = ['alta', 'media', 'baja'].map((z) => H.huellaHidrica('banano', z));
  assert.ok(alta.azul < media.azul && media.azul < baja.azul);
  assert.ok(alta.total < baja.total);
});

test('La huella es inversamente proporcional al rendimiento (función racional)', () => {
  const h = H.huellaHidrica('maiz', 'baja');
  const mitad = H.huellaHidrica('maiz', 'baja', { perdida: 0.5 });
  cerca(mitad.total, 2 * h.total, 1e-9);                     // la mitad de la cosecha, el doble de agua por tonelada
  const doble = H.huellaHidrica('maiz', 'baja', { fN: 2 });
  cerca(doble.gris, 2 * h.gris, 1e-9);                       // la huella gris es lineal en el nitrógeno
  cerca(doble.azul, h.azul, 1e-12);
});

test('Carbono del transporte: viajes de ida y vuelta, ACPM y costo del impuesto', () => {
  const c = H.carbonoTransporte('baja', 254);
  assert.equal(c.viajes, 26);                                // 254 t en camiones de 10 t
  cerca(c.litros, 26 * 6 * (0.3 + 0.2), 1e-9);
  cerca(c.kgCO2, c.litros * 2.68, 1e-9);
  cerca(c.costo, (c.kgCO2 / 1000) * 29070.49, 1e-9);
  const alta = H.carbonoTransporte('alta', 254);
  cerca(alta.kgCO2 / c.kgCO2, (55 * 1.35) / 6, 1e-9);       // más lejos y por vías de montaña
  assert.equal(H.carbonoTransporte('baja', 0).viajes, 0);
});

test('Inundación: el daño depende de la profundidad, los días y el cultivo', () => {
  cerca(H.danoInundacion('banano', 0.15, 1), 0.5 * 0.5, 1e-12);
  assert.equal(H.danoInundacion('banano', 0.5, 3), 1);       // aguanta 2 días: la pierde toda
  cerca(H.danoInundacion('palma', 0.5, 3), 3 / 14, 1e-12);   // la palma aguanta 14 días
  cerca(H.danoInundacion('arroz', 0.5, 3), 0.3, 1e-12);
  assert.equal(H.danoInundacion('banano', 0.01, 3), 0);
  cerca(H.perdidaTotal(0.5, 0.5), 0.75, 1e-12);
});

test('La creciente del río y el desborde del arroyo inundan el lote de la zona baja', () => {
  const normal = calcular();
  assert.equal(normal.perdida, 0);
  assert.ok(normal.checks.every((c) => c.nivel === 'ok'));
  const aguacero = calcular({ lluvia: 'aguacero', cotaRio: 3.3 });
  cerca(aguacero.profRio, 3.3 - H.COTA_VEGA, 1e-9);
  cerca(aguacero.perdida, 1 / 3, 1e-9);                      // 0.10 m de 0.30 y 3 días de 2
  const inundacion = calcular({ lluvia: 'inundacion', cotaRio: 3.7 });
  assert.equal(inundacion.perdida, 1);
  // La represa guarda agua y la creciente llega más baja
  const conRepresa = calcular({ lluvia: 'inundacion', cotaRio: 3.7, operacionPresa: 'guardar' });
  assert.ok(conRepresa.profRio < inundacion.profRio && conRepresa.perdida < inundacion.perdida);
  // El arroyo se sale del canal: el agua pasa sobre la orilla como sobre un vertedero
  const r = S.calcular({ ...base, Qcrecida: 40 }, { nivel: 4.4, bomba: true, t: 6 * 3600 });
  const exceso = 40 - r.canal.Qcap;
  cerca(r.huella.profArroyo, ((exceso / 150) / 1.7) ** (2 / 3), 1e-9);
  assert.ok(r.huella.perdida > 0 && r.huella.perdida < 0.2);
  // En la montaña el lote está en la ladera: la creciente no lo alcanza
  assert.equal(calcular({ zonaRiego: 'alta', cultivo: 'cafe', lluvia: 'inundacion', cotaRio: 3.7 }).profRio, 0);
  // Pero el lote de la llanura (banano) sí se inunda en la escena
  assert.equal(calcular({ zonaRiego: 'alta', cultivo: 'cafe', lluvia: 'inundacion', cotaRio: 3.7 }).loteBaja.perdida, 1);
});

test('Comparaciones: todos los cultivos en la zona y el cultivo en las tres zonas', () => {
  const h = calcular();
  assert.equal(h.porCultivo.length, 11);
  assert.equal(h.porZona.length, 3);
  const cafe = h.porCultivo.find((x) => x.id === 'cafe');
  const hortalizas = h.porCultivo.find((x) => x.id === 'hortalizas');
  assert.ok(cafe.hh.total > 50 * hortalizas.hh.total);      // el café pide mucha más agua por tonelada
  assert.ok(h.porZona[0].carbono.porTonelada > h.porZona[2].carbono.porTonelada);
});
