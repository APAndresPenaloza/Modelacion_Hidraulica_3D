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

test('Cuadrática: canal trapezoidal con talud 1:1 y P = 6 m', () => {
  const z = 1;
  const k = 2 * Math.SQRT2; // 2√2 = 2.828427
  // b = 2.4 → y = 3.6/2√2 = 1.272792; A = (2.4 + 1.272792)·1.272792 = 4.674701
  const y = M.tiranteDesdePerimetro(6, 2.4, z);
  cerca(y, 1.272792, 1e-6);
  cerca(M.areaCanal(6, 2.4, z), 4.674701, 1e-6);
  cerca(M.areaTrapecio(2.4, y, z), M.areaCanal(6, 2.4, z), 1e-12);
  cerca(M.perimetroTrapecio(2.4, y, z), 6, 1e-12);
  cerca(M.anchoSuperficial(2.4, y, z), 4.945584, 1e-6);
  // Vértice: b* = 6(k − 2)/(2(k − 1)) = 1.359245, y* = 6/(2(k − 1)) = 1.640755
  const opt = M.seccionOptima(6, z);
  cerca(opt.b, (6 * (k - 2)) / (2 * (k - 1)), 1e-12);
  cerca(opt.y, 6 / (2 * (k - 1)), 1e-12);
  cerca(opt.A, (opt.b + opt.y) * opt.y, 1e-12);
  // Condición de máxima eficiencia: b/y = 2(√(1+z²) − z)
  cerca(opt.b / opt.y, 2 * (Math.SQRT2 - 1), 1e-12);
  for (const b of [0.3, 0.8, 1.2, 1.5, 2.4, 4]) assert.ok(M.areaCanal(6, b, z) < opt.A);
  // Con z = 0 se recupera el canal rectangular
  const rect = M.coeficientesAreaCanal(6, 0);
  assert.deepEqual([rect.a, rect.b, rect.c], [-0.5, 3, 0]);
  // Anchos con la misma área que b = 2.4 (raíces de la cuadrática)
  const anchos = M.anchosParaArea(6, M.areaCanal(6, 2.4, z), z);
  assert.ok(anchos.some((b) => Math.abs(b - 2.4) < 1e-9));
});

test('Manning en canal trapezoidal y tirante normal', () => {
  // b = 2, y = 1, z = 1 → A = 3, P = 2 + 2√2 = 4.828427, R = 0.621320
  // Q = (1/0.015)·3·0.621320^(2/3)·√0.005 = 200·0.728120·0.070711 = 10.297
  cerca(M.caudalCanal(2, 1, 0.005, 0.015, 1), 10.2973, 0.001);
  const y = M.tiranteNormal(8, 2.4, 0.005, 0.015, 1);
  cerca(M.caudalCanal(2.4, y, 0.005, 0.015, 1), 8, 1e-6);
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

test('Desarenador: velocidad horizontal, tiempo y carga superficial', () => {
  // Q = 12.5 L/s, B = 1 m, h = 0.8 m, L = 6 m
  cerca(M.velocidadHorizontal(0.0125, 1, 0.8), 0.015625, 1e-12);   // 0.0125/0.8
  cerca(M.tiempoRetencion(6, 0.015625), 384, 1e-9);                 // 6/0.015625
  cerca(M.cargaSuperficial(0.0125, 1, 6), 0.0020833333, 1e-9);     // 0.0125/6
  // La profundidad se cancela: h·Vh/L = Q/(B·L)
  cerca(0.8 * M.velocidadHorizontal(0.0125, 1, 0.8) / 6, M.cargaSuperficial(0.0125, 1, 6), 1e-15);
});

test('Cuadrática: ley de Stokes y grano más fino retenido', () => {
  // K = 9.81·(2650 − 997.05)/(18·0.00089) = 16 215.44/0.01602 = 1 012 199.7
  cerca(M.coeficienteStokes(), 1012199.7, 0.5);
  // vs = K·d²: d = 0.1 mm → 0.010122 m/s; duplicar d cuadruplica vs
  cerca(M.velocidadSedimentacion(1e-4), 0.0101220, 1e-6);
  cerca(M.velocidadSedimentacion(2e-4), 4 * M.velocidadSedimentacion(1e-4), 1e-12);
  // d mínimo = √(q/K) = √(0.0020833/1 012 199.7) = 4.5368e-5 m (0.045 mm)
  const d = M.diametroMinimoRetenido(0.0125, 1, 6);
  cerca(d, 4.5368e-5, 1e-8);
  cerca(M.velocidadSedimentacion(d), M.cargaSuperficial(0.0125, 1, 6), 1e-12);
  // Más caudal → grano mínimo más grueso (pasa más arena hacia la bomba)
  assert.ok(M.diametroMinimoRetenido(0.03, 1, 6) > d);
  // Re de la partícula ≈ 0.106 < 1: la ley de Stokes es válida
  assert.ok(M.reynoldsParticula(d, M.cargaSuperficial(0.0125, 1, 6)) < 1);
  assert.equal(M.claseGrano(d), 'limo');
  assert.equal(M.claseGrano(1e-4), 'arena muy fina');
  assert.equal(M.claseGrano(2e-4), 'arena fina');
});

test('Cuadrática: perfil laminar u(r) = 2V(1 − r²/R²) y perfil turbulento 1/7', () => {
  const R = 0.05, V = 0.4;
  cerca(M.velocidadLaminar(0, R, V), 0.8, 1e-12);     // vértice: 2V en el eje
  cerca(M.velocidadLaminar(R, R, V), 0, 1e-12);       // raíz: cero en la pared
  cerca(M.velocidadMaximaTurbulenta(1), 120 / 98, 1e-12); // 1.2245 V
  // La velocidad media sobre la sección es V en ambos perfiles
  const media = (perfil) => {
    let s = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const r = ((i + 0.5) / n) * R;
      s += perfil(r) * 2 * Math.PI * r * (R / n);
    }
    return s / (Math.PI * R * R);
  };
  cerca(media((r) => M.velocidadLaminar(r, R, V)), V, 1e-6);
  cerca(media((r) => M.velocidadTurbulenta(r, R, V)), V, 1e-3);
  // El perfil turbulento es más plano: en r = R/2 conserva más velocidad relativa al eje
  assert.ok(M.velocidadTurbulenta(R / 2, R, V) / M.velocidadTurbulenta(0, R, V)
    > M.velocidadLaminar(R / 2, R, V) / M.velocidadLaminar(0, R, V));
});

test('Reynolds: tubo de vidrio y canal abierto', () => {
  // 997.05·0.1·0.01/0.00089 = 1 120.3 → laminar; con 0.5 m/s, 5 601.4 → turbulento
  cerca(M.reynoldsVelocidad(0.1, 0.01), 1120.28, 0.01);
  assert.equal(M.regimen(M.reynoldsVelocidad(0.1, 0.01)), 'laminar');
  assert.equal(M.regimen(M.reynoldsVelocidad(0.5, 0.01)), 'turbulento');
  // Canal: 997.05·3.15·0.5/0.00089 = 1 570.354/0.00089 = 1 764 442.4
  cerca(M.reynoldsCanal(3.15, 0.5), 1764442.4, 0.1);
  assert.equal(M.regimenCanal(400), 'laminar');
  assert.equal(M.regimenCanal(1000), 'transición');
  assert.equal(M.regimenCanal(5000), 'turbulento');
});

test('Sistema integrado: escenario base coherente', () => {
  const p = { ...M.PARAMETROS_INICIALES };
  const r = M.calcularSistema(p, 3.2);
  assert.equal(r.estado, 'normal');
  assert.ok(r.Hcasa > p.presionMinima);
  assert.ok(r.alturaBombeo > p.cotaTanque - p.cotaRio);
  // El canal base (b = 2.4 m) tiene menos capacidad que el óptimo (b = 3 m)
  assert.ok(r.canal.Qcap < r.canal.QcapOptimo);
  // El canal es turbulento y el desarenador retiene desde 0.045 mm
  assert.equal(r.canal.regimen, 'turbulento');
  cerca(r.desarenador.dMin, 4.5368e-5, 1e-8);
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
