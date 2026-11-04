// Pruebas de la lluvia: lluvia–caudal del río, el año con El Niño y La Niña, la curva
// intensidad–duración–frecuencia, el arroyo (método racional), los deslizamientos, la
// avenida torrencial y cómo la lluvia cambia el resto del sistema.
// Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';
import * as R from '../js/rio.js';
import * as L from '../js/lluvia.js';
import * as P from '../js/represa.js';
import * as S from '../js/sistema.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a} (tol ${tol})`);
const base = { ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO };
const calcular = (cambios = {}) => S.calcular({ ...base, ...cambios }, { nivel: 4.4, bomba: true, t: 6 * 3600 });
const escenario = (id) => calcular({ lluvia: id, ...L.parametrosEscenario(id) });

test('Lluvia–caudal: 75 mm en 30 días dan el río normal y la inversa explica cada escenario', () => {
  cerca(L.K30, (0.35 * 400) / 2592, 1e-15);                 // m³/s por mm en 30 días
  cerca(L.caudalDeLluvia(75), R.caudalRio(2.5).Q, 1e-12);    // condición normal: cota 2.50 m
  cerca(L.cotaDeLluvia(75), 2.5, 1e-6);
  cerca(L.Q_SUB, R.caudalRio(2.5).Q - L.K30 * 75, 1e-12);    // lo que queda cuando no llueve
  // Sube linealmente con la lluvia: cada mm más son K m³/s más
  cerca(L.caudalDeLluvia(100) - L.caudalDeLluvia(99), L.K30, 1e-12);
  // La inversa devuelve la lluvia de cada escenario
  cerca(L.lluviaDeCaudal(R.caudalRio(1.9).Q).P30, 10.95, 0.01);
  cerca(L.lluviaDeCaudal(R.caudalRio(2.9).Q).P30, 124.98, 0.01);
  for (const P30 of [0, 20, 75, 180, 300]) cerca(L.lluviaDeCaudal(L.caudalDeLluvia(P30)).P30, P30, 1e-9);
  // Una tormenta sobre la cuenca suma su lluvia: la de 30 días que explica el río es menor
  const t = L.tormenta({ T: 10, D: 180 });
  cerca(L.lluviaDeCaudal(R.caudalRio(3.3).Q, { Pt: t.Pcuenca }).P30, 111.45, 0.01);
  // Si el río está más bajo de lo que da el agua subterránea, no llovió y el acuífero aporta menos
  const seco = L.lluviaDeCaudal(1);
  assert.equal(seco.P30, 0);
  cerca(seco.fSub, 1 / L.Q_SUB, 1e-12);
});

test('Año normal: 900 mm en la cuenca, caudales del régimen bimodal y la vega se moja en octubre y noviembre', () => {
  const ano = L.anoClima('normal', 3.2);
  cerca(ano.lluviaCuenca, 900, 1e-9);                       // 12 × 75 mm
  cerca(ano.lluviaCiudad, 546, 1e-9);                       // Santa Marta, 1991–2020
  L.MESES.forEach((m, k) => cerca(L.caudalMes(k), m.f * L.Q_MEDIO, 1e-12));
  assert.deepEqual(ano.sinCaptar, []);
  assert.deepEqual(ano.conVega, ['Oct', 'Nov']);
  assert.equal(P.MESES, L.MESES);                           // la represa usa los mismos meses
});

test('El Niño y La Niña: sequía en la bocatoma en febrero y marzo, o el río en la vega de septiembre a noviembre', () => {
  const nino = L.anoClima('nino', 3.2);
  const nina = L.anoClima('nina', 3.2);
  cerca(nino.lluviaCuenca, 0.6 * 900, 1e-9);
  cerca(nina.lluviaCuenca, 1.5 * 900, 1e-9);
  assert.deepEqual(nino.sinCaptar, ['Feb', 'Mar']);
  assert.deepEqual(nino.conVega, []);
  assert.deepEqual(nina.sinCaptar, []);
  assert.deepEqual(nina.conVega, ['Sep', 'Oct', 'Nov']);
  assert.equal(L.listaMeses(nina.conVega), 'septiembre, octubre y noviembre');
  // Cada mes, El Niño baja el río y La Niña lo sube
  L.MESES.forEach((_, k) => assert.ok(L.caudalMes(k, 'nino') < L.caudalMes(k) && L.caudalMes(k) < L.caudalMes(k, 'nina')));
  cerca(nino.recarga, 0.6 * L.anoClima('normal').recarga, 1e-9);
});

test('Curva IDF: Gumbel para la lluvia diaria y Dyck–Peschke para las duraciones cortas', () => {
  cerca(L.kGumbel(2), -0.1643, 1e-4);
  cerca(L.kGumbel(100), 3.1367, 1e-4);
  cerca(L.lluvia24(2), 75 * (1 + 0.4 * L.kGumbel(2)), 1e-12);
  cerca(L.lluvia24(100), 169.1, 0.05);
  for (const T of L.PERIODOS) cerca(L.periodoDeLluvia24(L.lluvia24(T)), T, 1e-6);   // inversa
  // P(D) = P24·(D/1440)^0.25: en 1 h cae el 45 % de la lluvia del día
  cerca(L.lluviaDuracion(10, 60) / L.lluvia24(10), (60 / 1440) ** 0.25, 1e-12);
  cerca(L.intensidad(10, 60), L.lluviaDuracion(10, 60), 1e-12);
  // La intensidad baja con la duración y sube con el período de retorno
  assert.ok(L.intensidad(10, 30) > L.intensidad(10, 60) && L.intensidad(10, 60) > L.intensidad(10, 180));
  assert.ok(L.intensidad(100, 60) > L.intensidad(10, 60) && L.intensidad(10, 60) > L.intensidad(2, 60));
  // Con una estación más lluviosa (M mayor) todo sube en proporción
  cerca(L.lluviaDuracion(25, 120, 90) / L.lluviaDuracion(25, 120, 75), 90 / 75, 1e-12);
});

test('Arroyo: método racional con tc de Kirpich; la tormenta de 2 años es la crecida de diseño del canal', () => {
  cerca(L.ARROYO.tc, 28.23, 0.01);                          // min
  cerca(L.ARROYO.area, 0.689, 0.001);                       // km²
  const Q = (T) => L.crecidaArroyo(L.tormenta({ T, D: 180 })).Q;
  cerca(Q(2), 8, 1e-9);
  cerca(Q(10), 13.03, 0.01);
  cerca(Q(100), 19.31, 0.01);
  // Q = C·i·A/3.6
  const i = L.intensidad(25, L.ARROYO.tc);
  cerca(Q(25), (0.75 * i * L.ARROYO.area) / 3.6, 1e-9);
  // Una tormenta corta (menos que tc) reparte su lluvia en tc
  cerca(L.crecidaArroyo(L.tormenta({ T: 10, D: 15 })).Q, (0.75 * (L.lluviaDuracion(10, 15) / (L.ARROYO.tc / 60)) * L.ARROYO.area) / 3.6, 1e-9);
  // Si la tormenta cae en la montaña, el arroyo de la ciudad no crece
  assert.equal(L.crecidaArroyo(L.tormenta({ T: 100, zona: 'alta' })).activa, false);
  assert.equal(L.crecidaParaCanal(L.tormenta({ T: 100, zona: 'alta' })), 8);
});

test('Deslizamientos: umbral de Larsen y Simon (1993), más bajo con el suelo húmedo', () => {
  cerca(L.umbralDeslizamiento(1), 91.46, 1e-12);
  cerca(L.umbralDeslizamiento(6), 91.46 * 6 ** -0.82, 1e-12);
  assert.equal(L.factorAntecedente(75), 1);
  assert.ok(L.factorAntecedente(250) < 1 && L.factorAntecedente(250) >= 0.6);
  assert.equal(L.factorAntecedente(0), 1.15);
  const t = L.tormenta({ T: 100, D: 360 });
  const seco = L.deslizamientos(t, 20);
  const humedo = L.deslizamientos(t, 150);
  assert.ok(humedo.r > seco.r);                              // la misma tormenta, más peligro
  cerca(humedo.r, t.I / (L.umbralDeslizamiento(6) * L.factorAntecedente(150)), 1e-12);
  // En la zona baja no hay laderas
  assert.equal(L.deslizamientos(L.tormenta({ T: 100, zona: 'baja' }), 150).enLaderas, false);
});

test('Avenida torrencial: índice de Melton, lodo y rocas, y el tiempo para avisar a la ciudad', () => {
  const q = L.QUEBRADA;
  cerca(q.melton, 1.45 / Math.sqrt(4.5), 1e-12);            // 0.68: flujo de detritos
  assert.equal(L.tipoTorrente(q.melton).tipo, 'flujo de detritos');
  assert.equal(L.tipoTorrente(0.4).tipo, 'avenida de lodo');
  assert.equal(L.tipoTorrente(0.2).tipo, 'crecida de agua');
  const t = L.tormenta({ T: 100, D: 360, zona: 'alta' });
  const a = L.avenidaTorrencial(t, L.deslizamientos(t, 110));
  assert.equal(a.probable, true);
  cerca(a.Qlodo, a.Qagua / (1 - 0.45), 1e-9);
  cerca(a.tLlegada, ((44 - 12) * 1000) / 3 / 3600, 1e-12);  // casi 3 h hasta la bocatoma
  // Sin lluvia en la montaña no hay avenida
  const tb = L.tormenta({ T: 100, D: 360, zona: 'baja' });
  assert.equal(L.avenidaTorrencial(tb, L.deslizamientos(tb, 110)).probable, false);
});

test('Escenarios: cada uno fija el río, el clima y la tormenta; la alerta sube con las amenazas', () => {
  const e = L.parametrosEscenario('inundacion');
  assert.equal(e.cotaRio, 3.7);
  assert.equal(e.tormentaT, 100);
  cerca(e.Qcrecida, 19.31, 0.01);                           // la tormenta llega al arroyo
  assert.equal(L.parametrosEscenario('avenida').Qcrecida, 8);
  assert.equal(L.parametrosEscenario('nino').climaAno, 'nino');
  assert.equal(L.parametrosEscenario('ninguno'), null);
  // La curva de sedimento pasa por los escenarios y crece con el caudal
  for (const id of ['seca', 'normal', 'lluvias', 'aguacero', 'inundacion']) cerca(L.sedimentoDeCaudal(R.caudalRio(R.LLUVIAS[id].cota).Q), R.LLUVIAS[id].sedimento, 1e-6);
  assert.ok(L.sedimentoDeCaudal(4) < L.sedimentoDeCaudal(8));
  // Río con más lluvia: la cota sube
  assert.ok(L.rioDeLluvia(150).cota > L.rioDeLluvia(75).cota);
  cerca(L.rioDeLluvia(75).cota, 2.5, 1e-6);
  // Alertas
  assert.equal(calcular().lluvia.alerta, 'verde');
  assert.equal(escenario('normal').lluvia.alerta, 'verde');
  assert.equal(calcular({ tormentaT: 2 }).lluvia.alerta, 'amarilla');
  assert.equal(calcular({ climaAno: 'nino' }).lluvia.alerta, 'naranja');
  const inund = escenario('inundacion').lluvia;
  assert.equal(inund.alerta, 'roja');
  assert.deepEqual(inund.amenazas, ['creciente del río', 'desborde del arroyo', 'deslizamientos', 'avenida torrencial']);
  assert.deepEqual(escenario('nino').lluvia.amenazas, ['sequía']);
  assert.deepEqual(escenario('avenida').lluvia.amenazas, ['deslizamientos', 'avenida torrencial']);
});

test('La lluvia lo mueve todo: El Niño y La Niña cambian el riego, la huella y la represa', () => {
  const normal = calcular();
  const nino = calcular({ climaAno: 'nino' });
  const nina = calcular({ climaAno: 'nina' });
  // El caso base no cambia
  cerca(normal.riego.horasAct, 12, 1e-9);
  // Con El Niño llueve menos sobre el cultivo: se riega más horas y la huella es más azul
  assert.ok(nino.riego.horasAct > 12 && nina.riego.horasAct < 12);
  assert.ok(nino.huella.hh.azul > normal.huella.hh.azul && nino.huella.hh.verde < normal.huella.hh.verde);
  cerca(nino.huella.hh.total, normal.huella.hh.total, 1e-9);  // la ET del cultivo es la misma
  // En la época de lluvias la diferencia es mayor
  assert.ok(calcular({ climaAno: 'nino', epoca: 'lluviosa' }).riego.horasAct > 1.4 * calcular({ epoca: 'lluviosa' }).riego.horasAct);
  // La represa genera menos con El Niño y más con La Niña
  assert.ok(nino.anoRepresa.Eano < 0.8 * normal.anoRepresa.Eano);
  assert.ok(nina.anoRepresa.Eano > normal.anoRepresa.Eano);
  // La sequía de El Niño deja a la bocatoma sin agua: la bomba no capta
  assert.equal(escenario('nino').capta, false);
  // La Niña saca el río a la vega y el cultivo de la zona baja pierde cosecha
  assert.ok(escenario('nina').huella.perdida > 0.5);
});

test('Revisión de la lluvia: cuatro criterios que cumplen en el caso base y fallan con la inundación', () => {
  const r = calcular();
  const lluvia = r.revisionTotal.filter((c) => c.area === 'Lluvia');
  assert.equal(lluvia.length, 4);
  assert.ok(lluvia.every((c) => c.nivel === 'ok'));
  const inund = escenario('inundacion').revisionTotal.filter((c) => c.area === 'Lluvia');
  assert.equal(inund.filter((c) => c.nivel !== 'ok').length, 3);   // arroyo, laderas y quebradas
  assert.ok(inund[0].texto.includes('19.31'));
});
