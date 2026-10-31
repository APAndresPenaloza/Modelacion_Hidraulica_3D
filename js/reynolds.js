/**
 * reynolds.js — Animación del experimento de Reynolds (corte longitudinal de un tubo).
 *
 * Una aguja inyecta tinta en el eje del tubo y unos trazadores marcan el agua:
 *  - Laminar (Re < 2000): las capas se deslizan sin mezclarse; la tinta sigue una
 *    línea recta y el perfil de velocidad es la parábola u(r) = 2V(1 − r²/R²).
 *  - Transición (2000 a 4000): aparecen ráfagas de agitación; la tinta ondula y se rompe.
 *  - Turbulento (Re > 4000): los remolinos mezclan la tinta en toda la sección y el
 *    perfil se aplana (ley de potencia 1/7, velocidad en el eje ≈ 1.22 V).
 * Solo dibuja: el número de Reynolds lo calcula modelo.js.
 */
import * as M from './modelo.js';

const TINTA = '#E2572F';

function css(nombre, respaldo) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return v || respaldo;
}

function suave(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

function azar() {
  return (Math.random() + Math.random() + Math.random() - 1.5) * 2;
}

/** Factor u/V del perfil mezclado: 0 = laminar (parábola), 1 = turbulento (1/7). */
function factorPerfil(eta, beta) {
  const a = Math.min(Math.abs(eta), 1);
  const lam = 2 * (1 - a * a);
  const tur = 1.2245 * Math.pow(Math.max(0, 1 - a), 1 / 7);
  return lam * (1 - beta) + tur * beta;
}

export class ExperimentoReynolds {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.config = { V: 0.1, D: 0.01, Re: 1120, regimen: 'laminar', etiqueta: 'Tubo de vidrio' };
    this.beta = 0;
    this.transicion = 0;
    this.activo = false;
    this.t = 0;
    this.emitir = 0;
    this.tinta = [];
    this.trazadores = [];
    this.fases = [Math.random() * 6, Math.random() * 6, Math.random() * 6];
    this.cuadro = this.cuadro.bind(this);
    this.redimensionar();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.redimensionar()).observe(canvas);
    document.addEventListener('visibilitychange', () => this.revisar());
  }

  /** config: { V [m/s], D [m], Re, regimen, etiqueta } */
  configurar(config) {
    Object.assign(this.config, config);
    this.beta = suave((config.Re - M.RE_LAMINAR) / (M.RE_TURBULENTO - M.RE_LAMINAR));
    // Intermitencia: máxima a mitad de la transición
    this.transicion = this.beta > 0 && this.beta < 1 ? 1 - Math.abs(2 * this.beta - 1) : 0;
    if (!this.raf) this.dibujar();
  }

  activar(si) {
    this.activo = si;
    this.revisar();
  }

  revisar() {
    const debe = this.activo && !document.hidden;
    if (debe && !this.raf) {
      this.ultimo = performance.now();
      this.raf = requestAnimationFrame(this.cuadro);
    } else if (!debe && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
  }

  redimensionar() {
    const c = this.canvas;
    const w = c.clientWidth || 360;
    const h = c.clientHeight || 190;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w;
    this.h = h;
    // Geometría del tubo (px): a la derecha queda espacio para el perfil de velocidad
    this.x0 = 14;
    this.x1 = Math.max(160, w - 96);
    this.yc = h / 2 + 4;
    this.R = Math.min(58, h / 2 - 30);
    this.xAguja = this.x0 + 22;
    if (!this.trazadores.length || this.anchoPrevio !== w) {
      this.trazadores = Array.from({ length: Math.round((this.x1 - this.x0) / 3.2) }, () => ({
        x: this.x0 + Math.random() * (this.x1 - this.x0),
        eta: (Math.random() * 2 - 1) * 0.96,
      }));
      this.anchoPrevio = w;
    }
    if (!this.raf) this.dibujar();
  }

  cuadro(ahora) {
    const dt = Math.min(0.05, (ahora - this.ultimo) / 1000);
    this.ultimo = ahora;
    this.paso(dt);
    this.dibujar();
    this.raf = this.activo && !document.hidden ? requestAnimationFrame(this.cuadro) : null;
  }

  /** Velocidad visual media [px/s]: crece con V pero se mantiene legible. */
  velocidadVisual() {
    const V = Math.max(0, this.config.V);
    return 26 + 120 * (V / (V + 0.3));
  }

  /**
   * Ráfaga de agitación en (x, t): en la transición la turbulencia llega en
   * manchas que viajan con el flujo (0 = calma, 1 = ráfaga); en turbulento pleno vale 1.
   */
  rafaga(x, t, S) {
    if (this.transicion <= 0) return 1;
    const r = Math.max(0, Math.sin(0.02 * (x - S * t) + this.fases[0]));
    return (1 - this.transicion) + this.transicion * r * r * 1.8;
  }

  /** Velocidad radial de los remolinos [η/s] en (x, η, t). */
  remolino(x, eta, t, S) {
    if (this.beta <= 0) return 0;
    const [f1, f2, f3] = this.fases;
    // Onda larga: hace ondular el hilo de tinta desde el comienzo de la transición
    const onda = Math.sin(0.045 * (x - 0.9 * S * t) + f1) * Math.cos(1.5 * eta);
    // Remolinos pequeños: solo dentro de las ráfagas (y en todas partes si es turbulento)
    const finos = 0.8 * Math.sin(0.083 * (x - 1.1 * S * t) + f2 + 2.2 * eta)
      + 0.55 * Math.sin(0.15 * (x - S * t) + f3 - 3.1 * eta);
    return 1.2 * this.beta * (onda + finos * this.rafaga(x, t, S) * this.beta);
  }

  paso(dt) {
    this.t += dt;
    const S = this.velocidadVisual();
    const b = this.beta;
    const difusion = 0.85 * b * b * b * Math.sqrt(dt);   // mezcla fina: casi nula en la transición
    const largo = this.x1 - this.x0;
    const mover = (p, k) => {
      p.x += S * factorPerfil(p.eta, b) * dt;
      if (b > 0) {
        p.eta += this.remolino(p.x, p.eta, this.t, S) * dt + difusion * k * this.rafaga(p.x, this.t, S) * azar();
        if (p.eta > 0.97) p.eta = 1.94 - p.eta;
        if (p.eta < -0.97) p.eta = -1.94 - p.eta;
      }
    };
    for (const p of this.trazadores) {
      mover(p, 1);
      if (p.x > this.x1) p.x -= largo;
    }
    // Tinta: sale de la punta de la aguja, en el eje
    this.emitir += dt * 85;
    while (this.emitir >= 1) {
      this.emitir -= 1;
      this.tinta.push({ x: this.xAguja + 2, eta: azar() * 0.012, edad: 0 });
    }
    for (const p of this.tinta) {
      p.edad += dt;
      mover(p, 1.15);
    }
    this.tinta = this.tinta.filter((p) => p.x < this.x1 - 1).slice(-900);
  }

  dibujar() {
    const g = this.ctx;
    const { w, h, x0, x1, yc, R } = this;
    if (!w) return;
    const tinta = css('--tinta', '#12303B');
    const tinta2 = css('--tinta-2', '#4B6670');
    const agua = css('--agua', '#1C86B8');
    const linea = css('--linea', '#C6D2D1');
    g.clearRect(0, 0, w, h);

    // Agua dentro del tubo
    g.fillStyle = agua;
    g.globalAlpha = 0.13;
    g.fillRect(x0, yc - R, x1 - x0, 2 * R);
    g.globalAlpha = 1;

    // Trazadores
    g.fillStyle = agua;
    g.globalAlpha = 0.55;
    for (const p of this.trazadores) {
      g.beginPath();
      g.arc(p.x, yc + p.eta * R, 1.6, 0, Math.PI * 2);
      g.fill();
    }
    // Tinta
    g.fillStyle = TINTA;
    for (const p of this.tinta) {
      g.globalAlpha = Math.max(0.25, 0.9 - 0.25 * Math.abs(p.eta));
      g.beginPath();
      g.arc(p.x, yc + p.eta * R, 2.1, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // Paredes de vidrio
    g.strokeStyle = tinta2;
    g.lineWidth = 2.5;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(x0, yc + s * (R + 1.5));
      g.lineTo(x1, yc + s * (R + 1.5));
      g.stroke();
    }
    // Aguja de tinta
    g.strokeStyle = tinta2;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(this.xAguja - 10, yc - R - 14);
    g.lineTo(this.xAguja - 10, yc - 3);
    g.lineTo(this.xAguja + 2, yc);
    g.stroke();
    g.fillStyle = TINTA;
    g.beginPath();
    g.arc(this.xAguja - 10, yc - R - 16, 4, 0, Math.PI * 2);
    g.fill();

    // Perfil de velocidad a la derecha: flechas proporcionales a u/V
    const xe = x1 + 14;
    const L = Math.min(64, w - xe - 10);
    const escala = L / 2;               // u = 2V (eje en laminar) ocupa todo el largo
    g.strokeStyle = linea;
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(xe + escala, yc - R);
    g.lineTo(xe + escala, yc + R);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = tinta2;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(xe, yc - R);
    g.lineTo(xe, yc + R);
    g.stroke();
    g.strokeStyle = agua;
    g.fillStyle = agua;
    for (let eta = -0.9; eta <= 0.91; eta += 0.225) {
      const len = factorPerfil(eta, this.beta) * escala;
      const y = yc + eta * R;
      g.beginPath();
      g.moveTo(xe, y);
      g.lineTo(xe + len, y);
      g.stroke();
      if (len > 5) {
        g.beginPath();
        g.moveTo(xe + len, y);
        g.lineTo(xe + len - 5, y - 3);
        g.lineTo(xe + len - 5, y + 3);
        g.closePath();
        g.fill();
      }
    }
    g.lineWidth = 2;
    g.beginPath();
    for (let k = 0; k <= 40; k++) {
      const eta = -1 + (2 * k) / 40;
      const x = xe + factorPerfil(eta, this.beta) * escala;
      const y = yc + eta * R;
      if (k === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();

    // Textos
    const c = this.config;
    const color = c.regimen === 'laminar' ? css('--ok', '#2F7D5B') : c.regimen === 'turbulento' ? css('--alerta', '#C0422A') : css('--aviso', '#B7790C');
    g.textBaseline = 'alphabetic';
    g.font = '600 13px "Archivo", system-ui, sans-serif';
    g.fillStyle = color;
    const re = Math.round(c.Re).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    g.fillText(`Re = ${re} · ${c.regimen}`, x0 + 2, 16);
    g.font = '12px "Archivo", system-ui, sans-serif';
    g.fillStyle = tinta2;
    const dmm = c.D * 1000;
    g.fillText(`${c.etiqueta}: D = ${dmm < 20 ? dmm.toFixed(1) : dmm.toFixed(0)} mm, V = ${c.V < 0.1 ? c.V.toFixed(3) : c.V.toFixed(2)} m/s`, x0 + 2, h - 8);
    g.fillStyle = tinta;
    g.textAlign = 'center';
    g.fillText('perfil', xe + L / 2, 16);
    g.font = '11px "Archivo", system-ui, sans-serif';
    g.fillStyle = tinta2;
    g.fillText('V media', xe + escala, yc + R + 14);
    g.textAlign = 'left';
  }
}
