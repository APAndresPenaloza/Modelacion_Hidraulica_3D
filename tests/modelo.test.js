// Pruebas del núcleo matemático. Ejecutar con:  node --test tests/
// Los valores esperados están calculados a mano (ver comentarios).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a} (tol ${tol})`);

test('Decimales: redondeo sin error de coma flotante', () => {
  assert.equal(M.redondear(1.005, 2), 1.01);
  assert.equal(M.redondear(2.845, 2), 2.85);
  assert.equal(M.redondear(-2.845, 2), -2.85);
  assert.equal(M.lpsAm3s(2.85), 0.00285);
  cerca(M.mcaAkPa(10), 97.81, 0.01); // 997.05·9.81·10/1000 = 97.81 kPa
});

test('Continuidad: V = Q/A y su inversa', () => {
  cerca(M.areaCircular(0.1), 0.0078539816, 1e-9);
  cerca(M.velocidadMedia(0.0125, 0.15), 0.707355, 1e-5);
  cerca(M.caudalDesdeVelocidad(M.velocidadMedia(0.0125, 0.15), 0.15), 0.0125, 1e-12);
});

test('Reynolds: 2.85 L/s en tubo de 10 cm es turbulento (≈ 40 650)', () => {
  const Re = M.reynolds(0.00285, 0.1);
  cerca(Re, 40652, 5);
  assert.equal(M.regimen(Re), 'turbulento');
  assert.equal(M.regimen(1500), 'laminar');
  assert.equal(M.regimen(3000), 'transición');
});

test('Lineal: Hagen-Poiseuille h_f = k·Q', () => {
  // k = 128·0.00089·10 / (π·997.05·9.81·0.02⁴) = 231.71 s/m²
  cerca(M.pendientePoiseuille(10, 0.02), 231.71, 0.01);
  cerca(M.perdidaLaminar(1e-5, 10, 0.02), 0.0023171, 1e-6);
  // Proporcionalidad: duplicar Q duplica h_f; Q = 0 → h_f = 0 (pasa por el origen)
  cerca(M.perdidaLaminar(2e-5, 10, 0.02), 2 * M.perdidaLaminar(1e-5, 10, 0.02), 1e-12);
  assert.equal(M.perdidaLaminar(0, 10, 0.02), 0);
});

test('Darcy con f = 64/Re coincide con Hagen-Poiseuille en laminar', () => {
  const Q = 1e-5, L = 10, D = 0.02;
  assert.equal(M.regimen(M.reynolds(Q, D)), 'laminar');
  cerca(M.perdidaDarcy(Q, L, D), M.perdidaLaminar(Q, L, D), 1e-12);
});

test('Lineal: nivel del tanque h(t) = h₀ + (Qe − Qs)/A · t', () => {
  const At = M.areaTanque(12); // 113.097 m²
  cerca(At, 113.0973, 1e-4);
  // 3.20 + (0.0125 − 0.01085)/113.097 · 3600 = 3.252522 m
  cerca(M.nivelTanque(3.2, 0.0125, 0.01085, At, 3600), 3.252522, 1e-6);
  // Tiempo para vaciar 1 m con déficit de 1 L/s: 113.097/0.001 = 113 097 s
  cerca(M.tiempoHastaNivel(1, 0, 0.0, 0.001, At), 113097.3, 0.1);
  assert.equal(M.tiempoHastaNivel(1, 0, 0.002, 0.001, At), Infinity);
});

test('Lineal: costo de bombeo C(V) = m·V + b', () => {
  // E = 997.05·9.81·40·1000/(0.7·3.6e6) = 155.255 kWh → 155.255·950 + 150000
  const r = M.costoBombeo(1000, 40, 0.7, 950, 150000);
  cerca(r.energia, 155.2549, 1e-3);
  cerca(r.costo, 297492.2, 0.5);
  // Linealidad: C(2000) − C(1000) = m·1000
  const r2 = M.costoBombeo(2000, 40, 0.7, 950, 150000);
  cerca(r2.costo - r.costo, r.m * 1000, 1e-6);
  assert.equal(M.costoBombeo(0, 40, 0.7, 950, 150000).costo, 150000);
});

test('Cuadrática: fórmula general', () => {
  assert.deepEqual(M.resolverCuadratica(1, -5, 6).raices, [2, 3]);
  assert.deepEqual(M.resolverCuadratica(1, 2, 1).raices, [-1]);
  assert.deepEqual(M.resolverCuadratica(1, 0, 1).raices, []);
});

test('Cuadrática: canal rectangular óptimo con P = 6 m', () => {
  const opt = M.seccionOptima(6);
  cerca(opt.b, 3, 1e-12);   // b = P/2
  cerca(opt.y, 1.5, 1e-12); // y = P/4
  cerca(opt.A, 4.5, 1e-12); // A = P²/8
  cerca(M.areaCanal(6, 2.4), 4.32, 1e-12);
  const anchos = M.anchosParaArea(6, 4.32);
  cerca(anchos[0], 2.4, 1e-9);
  cerca(anchos[1], 3.6, 1e-9);
  // Cualquier otro ancho da menos área que el vértice
  for (const b of [0.5, 1, 2, 2.9, 3.1, 4, 5.5]) assert.ok(M.areaCanal(6, b) < opt.A);
});

test('Manning y tirante normal', () => {
  // b=3, y=1.5 → A=4.5, P=6, R=0.75; Q = (1/0.015)·4.5·0.75^(2/3)·√0.005 = 17.511
  cerca(M.caudalCanal(3, 1.5, 0.005, 0.015), 17.511, 0.001);
  const y = M.tiranteNormal(8, 2.4, 0.005, 0.015);
  cerca(M.caudalCanal(2.4, y, 0.005, 0.015), 8, 1e-6);
});

test('Cuadrática: chorro parabólico', () => {
  // x = v·√(2h/g) = 2·√(3/9.81) = 1.10600 m
  const x = M.alcanceChorro(1.5, 2);
  cerca(x, 1.10600, 1e-5);
  cerca(M.trayectoriaChorro(x, 1.5, 2), 0, 1e-9);
  cerca(M.trayectoriaChorro(0, 1.5, 2), 1.5, 1e-12);
});

test('Cuadrática: velocidad en el grifo H = (1+K)v²/2g', () => {
  // H = 20 m, llave abierta (K = 10): v = √(2·9.81·20/11) = 5.97266 m/s
  cerca(M.velocidadGrifo(20, 1, 10), 5.97266, 1e-5);
  assert.equal(M.velocidadGrifo(-1, 1), 0);
  assert.ok(M.velocidadGrifo(20, 0.5) < M.velocidadGrifo(20, 1));
});

test('Sistema integrado: escenario base coherente', () => {
  const p = { ...M.PARAMETROS_INICIALES };
  const r = M.calcularSistema(p, 3.2);
  assert.equal(r.estado, 'normal');
  assert.ok(r.Hcasa > p.presionMinima);
  assert.ok(r.alturaBombeo > p.cotaTanque - p.cotaRio);
  // El canal base (b = 2.4 m) tiene menos capacidad que el óptimo (b = 3 m)
  assert.ok(r.canal.Qcap < r.canal.QcapOptimo);
});

test('Sistema integrado: tanque vacío con déficit → desabastecimiento', () => {
  const p = { ...M.PARAMETROS_INICIALES, Qbombeo: 4, Qdemanda: 10 };
  const r = M.calcularSistema(p, 0);
  assert.equal(r.estado, 'deficit');
  cerca(r.Qsal, 0.004, 1e-12);
  assert.equal(M.avanzarNivel(p, 0, 600), 0);
});

test('Sistema integrado: crecida mayor que la capacidad → desborde', () => {
  const p = { ...M.PARAMETROS_INICIALES, Qcrecida: 40 };
  assert.equal(M.calcularSistema(p, 3).canal.desborde, true);
});
