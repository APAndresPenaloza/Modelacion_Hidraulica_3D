// Pruebas del diseño de bombas: potencias, motor comercial, curvas y punto de
// operación, NPSH y tipos de bomba. Ejecutar con:  npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/modelo.js';
import * as B from '../js/bombas.js';
import * as S from '../js/sistema.js';

const cerca = (a, b, tol = 1e-6) =>
  assert.ok(Math.abs(a - b) <= tol, `esperado ${b}, obtenido ${a} (tol ${tol})`);

const calcular = (cambios = {}) =>
  S.calcular({ ...M.PARAMETROS_INICIALES, ...S.PARAMETROS_DISENO, ...cambios }, { nivel: 4.4, bomba: true, t: 6 * 3600 });

test('Bomba del acueducto: potencia hidráulica, al freno, eléctrica e instalada', () => {
  const r = calcular();
  const b = r.bombas.acueducto;
  cerca(b.H, r.Hmedia, 1e-9);                                  // se diseña con la altura media del ciclo
  cerca(b.Ph, 997.05 * 9.81 * 0.015 * r.Hmedia, 1e-6);         // ρ·g·Q·H
  cerca(b.Pb, b.Ph / 0.7, 1e-6);                               // al freno: P_h/η_b
  cerca(b.Pb / 1000, 8.93, 0.01);
  // Motor: 15 HP (11.19 kW), 2 polos, η_m = 0.91; trabaja al 80 % de su capacidad
  assert.equal(b.motor.hp, 15);
  cerca(b.motor.kW, 15 * 0.7457, 1e-9);
  cerca(b.Pe, b.Pb / 0.91, 1e-6);                              // la potencia real que se paga
  cerca(b.factorCarga, 0.8, 0.01);
  // Con la bomba de reserva se instalan dos motores iguales
  assert.equal(b.unidades, 2);
  cerca(b.instaladaW, 2 * 15 * 745.7, 1e-6);
});

test('Motor comercial: margen de seguridad y tamaño siguiente del catálogo', () => {
  // 4 kW = 5.36 HP → margen 20 % → 6.44 HP → motor de 7.5 HP
  const m = B.motorComercial(4000, 1750);
  cerca(m.hpFreno, 4000 / 745.7, 1e-12);
  assert.equal(m.margen, 0.2);
  assert.equal(m.hp, 7.5);
  assert.equal(m.polos, 4);
  // Los motores pequeños llevan más margen; los grandes, menos
  assert.equal(B.margenMotor(1), 0.5);
  assert.equal(B.margenMotor(30), 0.1);
  // A más tamaño, más eficiencia
  assert.ok(B.motorComercial(40000, 3500).eta > B.motorComercial(1000, 3500).eta);
});

test('Curvas: el punto de operación es el de diseño y se mueve con la altura estática', () => {
  const b = calcular().bombas.acueducto;
  // La curva de la bomba pasa por el punto de diseño
  cerca(B.alturaBomba(b.curva, b.Q), b.H, 1e-9);
  cerca(b.opDis.Q, b.Q, 1e-12);
  // Con el tanque bajo (menos altura estática) la bomba entrega más caudal
  assert.ok(b.opMax.Q > b.Q && b.opMin.Q < b.Q);
  // En el punto de operación coinciden la curva de la bomba y la del sistema
  cerca(B.alturaBomba(b.curva, b.opMax.Q), B.alturaSistema(b.curva, b.opMax.Q, b.HestMin), 1e-9);
  // La eficiencia es máxima en el punto de diseño
  cerca(B.eficienciaEn(b.curva, b.Q), 0.7, 1e-12);
  assert.ok(B.eficienciaEn(b.curva, 1.2 * b.Q) < 0.7);
});

test('Bombas en paralelo: mismo punto de diseño, cada una con su parte del caudal', () => {
  const una = calcular().bombas.acueducto;
  const dos = calcular({ nBombasA: 2 }).bombas.acueducto;
  cerca(dos.qd, una.qd / 2, 1e-12);
  cerca(dos.opDis.Q, una.Q, 1e-9);
  cerca(dos.Pb1, una.Pb1 / 2, 1e-6);
  assert.ok(dos.motor.hp < una.motor.hp);
});

test('Succión: NPSH disponible y requerido', () => {
  // Presión de vapor a 20 °C ≈ 2.34 kPa
  cerca(B.presionVapor(20), 2.338, 0.005);
  const b = calcular().bombas.acueducto;
  // NPSH_d = (P_atm − P_v)/(ρg) − z_s − h_fs, con z_s = eje − (río − descenso del pozo)
  const at = B.cargaAtmosferica(6, 27);
  cerca(b.succion.NPSHd, at.carga - (6 - (2.5 - S.DESCENSO_POZO)) - b.succion.hfs, 1e-9);
  cerca(b.succion.NPSHr, ((3500 * Math.sqrt(0.015)) / 180) ** (4 / 3), 1e-9);
  // A la mitad de la velocidad la bomba necesita mucho menos NPSH
  assert.ok(B.npshRequerido(1750, 0.015) < B.npshRequerido(3500, 0.015) / 2);
  // Con el eje muy alto la bomba cavita: la revisión lo marca
  const alta = calcular({ cotaEjeA: 9, Qbombeo: 25 });
  const npsh = alta.bombas.checksA.find((c) => c.texto.includes('NPSH'));
  assert.equal(npsh.nivel, 'alerta');
  // Una sumergible no tiene succión
  const sum = calcular({ tipoBombaA: 'sumergible' }).bombas.acueducto;
  assert.equal(sum.succion.zs, -B.SUMERGENCIA);
  assert.ok(sum.etapas >= 2);
});

test('Tipos de bomba: velocidad específica y campo de aplicación', () => {
  const r = calcular();
  const b = r.bombas.acueducto;
  // n_q = n·√Q/H^0.75 = 3500 × √0.015 / 42.62^0.75 ≈ 25.7: rodete radial
  cerca(b.nq, (3500 * Math.sqrt(0.015)) / r.Hmedia ** 0.75, 1e-9);
  assert.equal(b.clase, 'radial');
  const apt = Object.fromEntries(r.bombas.aptitudA.map((a) => [a.id, a]));
  assert.equal(apt.centrifuga.apta, true);
  assert.equal(apt.partida.apta, false);       // 15 L/s es poco para una de doble succión
  assert.equal(apt.axial.apta, false);         // 42 m es mucha altura para una hélice
  assert.equal(B.tipoRecomendado(r.bombas.aptitudA).id, 'centrifuga');
  // En el escenario base todas las revisiones de las bombas se cumplen
  assert.deepEqual([...r.bombas.checksA, ...r.bombas.checksR].filter((c) => c.nivel !== 'ok'), []);
});
