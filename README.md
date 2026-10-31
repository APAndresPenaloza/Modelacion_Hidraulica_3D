# Simulador hídrico 3D de Santa Marta

Aplicación web interactiva que simula el abastecimiento de agua de un sector de Santa Marta (río → bocatoma y desarenador → bombeo → aducción → tanque → distribución → grifo de una vivienda) y la capacidad de un arroyo canalizado durante una crecida. El río corre casi lleno entre orillas bajas; el agua entra por la rejilla de una bocatoma lateral, deja la arena en un desarenador y pasa al pozo de succión de la bomba. El arroyo corre por un canal trapezoidal de concreto excavado bajo el nivel de la calle, con andenes, barandas, compuerta y pozo de disipación.

La escena muestra el régimen del flujo: en las tuberías las partículas se mueven con el perfil de velocidad (parabólico en laminar, casi plano en turbulento) y un hilo de tinta sigue recto o se mezcla. La pestaña Tuberías incluye una animación del experimento de Reynolds con un tubo de vidrio cuyo diámetro y velocidad se pueden cambiar.

Proyecto final de Álgebra y Geometría Analítica, 2026-II. Línea de investigación: Hidráulica de Canales Abiertos y Redes de Acueducto.

## Estructura

```
index.html            Página principal
css/styles.css        Estilos (modo claro y oscuro, adaptable a móvil)
js/modelo.js          Núcleo matemático: solo funciones puras, sin gráficos
js/escena3d.js        Escena 3D con Three.js
js/graficas.js        Gráficas con Chart.js
js/reynolds.js        Animación del experimento de Reynolds (laminar, transición, turbulento)
js/app.js             Deslizadores, tiempo simulado, métricas y ecuaciones
lib/                  Three.js 0.170 y Chart.js 4.4 (copias locales, licencia MIT)
tests/modelo.test.js  Pruebas del modelo con valores calculados a mano
```

Las librerías van incluidas en `lib/`, así que el simulador no depende de ningún CDN.

## Objetos matemáticos del simulador

| Requisito | Dónde se aplica | Función en `modelo.js` |
|---|---|---|
| Decimales | Cotas, caudales en L/s, áreas, volumen del tanque, presión en m.c.a. y kPa | `redondear`, `areaCircular`, `volumenTanque`, `cargaDisponible` |
| Ecuación lineal | Pérdida laminar h_f = k·Q (Hagen-Poiseuille) | `perdidaLaminar` |
| Ecuación lineal | Nivel del tanque h(t) = h₀ + m·t | `nivelTanque`, `tiempoHastaNivel` |
| Ecuación lineal | Costo de bombeo C(V) = m·V + b | `costoBombeo` |
| Ecuación cuadrática | Área del canal trapezoidal con perímetro y talud fijos A(b) = ((z−k)/k²)b² + (P(k−2z)/k²)b + zP²/k², k = 2√(1+z²), y su vértice | `areaCanal`, `seccionOptima` |
| Ecuación cuadrática | Trayectoria del chorro y(x) = −(g/2v²)x² + h₀ | `trayectoriaChorro`, `alcanceChorro` |
| Ecuación cuadrática | Velocidad de salida del grifo ((1+K)/2g)v² − H = 0 | `velocidadGrifo` |
| Decimales | Velocidad horizontal V_h = Q/(B·h), tiempo de paso y carga superficial q = Q/(B·L) del desarenador | `velocidadHorizontal`, `tiempoRetencion`, `cargaSuperficial` |
| Ecuación cuadrática | Ley de Stokes v_s = K·d²; grano más fino retenido: raíz de K·d² − q = 0 | `velocidadSedimentacion`, `diametroMinimoRetenido` |
| Ecuación cuadrática | Perfil laminar u(r) = 2V(1 − r²/R²): vértice en el eje, raíces en la pared | `velocidadLaminar` |
| Decimales | Número de Reynolds en tuberías (ρVD/μ) y en el canal (ρVR/μ, con el radio hidráulico) | `reynoldsVelocidad`, `reynoldsCanal` |

Con caudales reales de acueducto el flujo es turbulento, de modo que la recta laminar subestima la pérdida; para la presión de la vivienda se usa Darcy-Weisbach (Swamee-Jain). Esa diferencia se muestra en la pestaña Tuberías. Con caudales muy pequeños (por ejemplo 0.1 L/s en la aducción) el flujo pasa a laminar y la escena lo muestra.

## Captación y desarenador

El agua del río entra por una rejilla a la bocatoma, cruza el desarenador y rebosa por un vertedero al pozo de succión. Un grano se queda en el desarenador si cae la profundidad h antes de recorrer la longitud L, es decir si su velocidad de caída es mayor que la carga superficial q = Q/(B·L); la profundidad se cancela. Con la ley de Stokes (v_s = K·d², K = g(ρ_s − ρ)/(18μ)) el grano más fino que se queda es d = √(q/K). En el escenario base (12.5 L/s, B = 1 m, L = 6 m) se retienen los granos desde 0.045 mm; al bombear más o acortar el desarenador pasa arena más fina hacia la bomba, y la escena lo muestra con granos de cuatro tamaños.

## Sección del arroyo

El canal es trapezoidal: fondo de ancho b y paredes con talud z (z metros horizontales por cada metro vertical).

- Perímetro mojado: P = b + 2y·√(1 + z²)
- Área de flujo: A = (b + z·y)·y
- Ancho de la lámina: T = b + 2z·y

Con P y z fijos, el tirante es y = (P − b)/k con k = 2√(1 + z²), y el área queda como una parábola en b que abre hacia abajo. Su vértice da la sección de máxima eficiencia, en la que b/y = 2(√(1 + z²) − z). Con z = 0 se recupera el canal rectangular (b = P/2, A = P²/8).

## Probar en el computador

Los módulos de JavaScript no funcionan abriendo `index.html` con doble clic. Hay que servir la carpeta:

```
python -m http.server 8000
```

y abrir `http://localhost:8000`. Para correr las pruebas del modelo (requiere Node.js 18 o superior):

```
npm test
```

## Publicar en GitHub Pages

1. Crear un repositorio público en GitHub, por ejemplo `simulador-hidrico-3d`.
2. Subir todo el contenido de esta carpeta a la rama `main` (con `git push` o arrastrando los archivos en la página del repositorio).
3. En el repositorio: **Settings → Pages → Build and deployment**, elegir **Deploy from a branch**, rama `main`, carpeta `/ (root)` y guardar.
4. A los pocos minutos queda publicado en `https://USUARIO.github.io/simulador-hidrico-3d/`.

## Valores de referencia

La tarifa de energía (950 COP/kWh), el cargo fijo y la presión mínima de servicio (15 m.c.a.) son valores editables de referencia. Antes de la sustentación conviene contrastarlos con la tarifa vigente del operador de energía y con el Reglamento Técnico del Sector de Agua Potable y Saneamiento Básico (RAS, Resolución 0330 de 2017).
