// Pruebas del río: curva de descarga, captación, mezcla, Streeter-Phelps, coliformes,
// sedimentos y acuífero. Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';
import * as R from '../js/rio.js';
import * as S from '../js/sistema.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a} (tol ${tol})`);

const base = (cambios = {}) => ({ ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO, ...cambios });

test('Río: curva de descarga de Manning en la bocatoma', () => {
  // Cota 2.50 m con el fondo en 1.00 m: y = 1.5 m, A = 15 m², P = 13 m
  const c = R.caudalRio(2.5);
  cerca(c.y, 1.5, 1e-12);
  const esperado = (1 / 0.045) * 15 * (15 / 13) ** (2 / 3) * Math.sqrt(0.0003);
  cerca(c.Q, esperado, 1e-9);
  cerca(c.Q, 6.35, 0.01);
  // Más nivel, más caudal; sin lámina no hay caudal
  assert.ok(R.caudalRio(2.9).Q > c.Q && R.caudalRio(1.9).Q < c.Q);
  assert.equal(R.caudalRio(0.9).Q, 0);
});

test('Río: la bocatoma capta desde 0.15 m de lámina sobre la rejilla', () => {
  cerca(R.COTA_MIN_CAPTACION, 1.75, 1e-12);
  assert.equal(R.captaAgua(1.75), true);
  assert.equal(R.captaAgua(1.74), false);
  // Con el río bajo, la bomba no trabaja y el costo del mes es solo el cargo fijo
  const r = S.calcular(base({ cotaRio: 1.5 }), { nivel: 4.0, bomba: true, t: 6 * 3600 });
  assert.equal(r.bomba, false);
  assert.equal(r.horasDia, 0);
  cerca(r.costo.costo, 150000, 1e-9);
  assert.equal(r.rio.checks[0].nivel, 'alerta');
});

test('Río: mezcla de un vertimiento por balance de masa', () => {
  // 6 m³/s con DBO 2 mg/L + 20 L/s de agua residual con 250 mg/L
  cerca(R.mezcla(6, 2, 0.02, 250), (6 * 2 + 0.02 * 250) / 6.02, 1e-12);
  // Un río más grande diluye más
  assert.ok(R.mezcla(12, 2, 0.02, 250) < R.mezcla(6, 2, 0.02, 250));
});

test('Oxígeno disuelto de saturación: baja con la temperatura y con la altitud', () => {
  cerca(R.odSaturacion(20), 9.09, 0.01);     // tabla APHA: 9.09 mg/L
  cerca(R.odSaturacion(27), 7.97, 0.01);     // tabla APHA: 7.97 mg/L
  assert.ok(R.odSaturacion(27, 1200) < R.odSaturacion(27, 0));
  cerca(R.presionAtm(0), 101.325, 1e-9);
});

test('Streeter-Phelps: el déficit es máximo en el tiempo crítico', () => {
  const [L0, D0, kd, ka] = [20, 0.8, 0.45, 1.6];
  const D = (t) => ((kd * L0) / (ka - kd)) * (Math.exp(-kd * t) - Math.exp(-ka * t)) + D0 * Math.exp(-ka * t);
  const { tc, Dc } = R.puntoCritico(L0, D0, kd, ka);
  assert.ok(tc > 0);
  cerca(D(tc), Dc, 1e-9);                        // D_c = (k_d/k_a)·L₀·e^(−k_d·t_c)
  assert.ok(D(tc - 0.01) < Dc && D(tc + 0.01) < Dc);
  // La reaireación de O'Connor y Dobbins crece con la velocidad y baja con la profundidad
  assert.ok(R.reaireacion(1, 1) > R.reaireacion(0.5, 1) && R.reaireacion(0.5, 2) < R.reaireacion(0.5, 1));
});

test('Vertimientos: aguas arriba de la bocatoma la contaminan; aguas abajo, no', () => {
  const p = base({ vertTipo: 'domestica', Qvert: 20 });
  const arriba = R.calcularRio({ ...p, vertZona: 'baja' });       // km 40
  const abajo = R.calcularRio({ ...p, vertZona: 'abajo' });       // km 47
  const limpio = R.calcularRio({ ...p, vertTipo: 'ninguno' });
  assert.ok(arriba.calidad.bocatoma.CF > p.cfMax);                // no apta para potabilizar
  cerca(abajo.calidad.bocatoma.CF, limpio.calidad.bocatoma.CF, 1e-9);
  assert.ok(abajo.calidad.desembocadura.CF > limpio.calidad.desembocadura.CF);
  // Los coliformes mueren río abajo: menos en la bocatoma que justo después de la mezcla
  assert.ok(arriba.calidad.bocatoma.CF < arriba.calidad.inicio.N0);
  // La DBO sube en la mezcla y el oxígeno baja río abajo del vertimiento
  assert.ok(arriba.calidad.inicio.L0 > limpio.calidad.bocatoma.DBO);
  assert.ok(arriba.calidad.odMin.od < limpio.calidad.odMin.od);
});

test('Vertimientos: una carga grande en la zona baja agota el oxígeno', () => {
  const r = R.calcularRio(base({ cotaRio: 1.9, vertTipo: 'cafe', vertZona: 'baja', Qvert: 30 }));
  assert.ok(r.calidad.odMin.od < 4);
  assert.equal(r.checks.find((c) => c.texto.startsWith('Río: oxígeno')).nivel, 'alerta');
  // En la montaña el río se airea rápido: la misma carga baja menos el oxígeno
  const alta = R.calcularRio(base({ cotaRio: 1.9, vertTipo: 'cafe', vertZona: 'alta', Qvert: 1.5 }));
  assert.ok(alta.calidad.zonas.alta.odMin > 7);
});

test('Sedimentos: los aguaceros llenan el desarenador más rápido', () => {
  const p = base();
  const normal = R.sedimentos(p, 0.015, 17.36, 0.00005);
  // C·Q·horas·3600 = 150 g/m³ × 0.015 m³/s × 17.36 h × 3600 s = 140.6 kg/día
  cerca(normal.Mentra, 150 * 0.015 * 17.36 * 3600 / 1000, 1e-9);
  // Del grano de 0.05 mm para arriba se queda el 35 % (arenas)
  cerca(normal.f, 0.35, 1e-9);
  const aguacero = R.sedimentos({ ...p, sedimento: 3000 }, 0.015, 17.36, 0.00005);
  cerca(aguacero.dias, normal.dias / 20, 1e-6);
  assert.ok(aguacero.dias < 7 && normal.dias > 7);
});

test('Acuífero: tiempo de llegada (Darcy), coliformes y vulnerabilidad GOD', () => {
  const agua = { DBO: 10, CF: 10000, NO3: 12 };
  const grava = R.acuifero({ sueloAcuifero: 'grava', tipoAcuifero: 'libre', profFreatico: 6 }, agua);
  const arcilla = R.acuifero({ sueloAcuifero: 'arcilla', tipoAcuifero: 'libre', profFreatico: 6 }, agua);
  // t = d·n_e/K
  cerca(grava.t, 6 * 0.25 / 50, 1e-12);
  assert.ok(arcilla.t > grava.t && arcilla.CF < grava.CF);
  // Los nitratos no se degradan en el suelo
  assert.equal(grava.NO3, 12);
  // GOD = G·O·D: libre (1.0) × grava (0.9) × 6 m (0.8)
  cerca(grava.god, 0.72, 1e-12);
  assert.equal(grava.clase, 'extrema');
  const confinado = R.acuifero({ sueloAcuifero: 'grava', tipoAcuifero: 'confinado', profFreatico: 6 }, agua);
  assert.ok(confinado.god < grava.god && confinado.t > grava.t);
});
