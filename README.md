# Simulador hídrico 3D de Santa Marta

Aplicación web interactiva que simula el abastecimiento de agua de un sector de Santa Marta (río → bombeo → aducción → tanque → distribución → grifo de una vivienda) y la capacidad de un arroyo canalizado durante una crecida.

Proyecto final de Álgebra y Geometría Analítica, 2026-II. Línea de investigación: Hidráulica de Canales Abiertos y Redes de Acueducto.

## Estructura

```
index.html            Página principal
css/styles.css        Estilos (modo claro y oscuro, adaptable a móvil)
js/modelo.js          Núcleo matemático: solo funciones puras, sin gráficos
js/escena3d.js        Escena 3D con Three.js
js/graficas.js        Gráficas con Chart.js
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
| Ecuación cuadrática | Área del canal con perímetro fijo A(b) = −½b² + (P/2)b y su vértice | `areaCanal`, `seccionOptima` |
| Ecuación cuadrática | Trayectoria del chorro y(x) = −(g/2v²)x² + h₀ | `trayectoriaChorro`, `alcanceChorro` |
| Ecuación cuadrática | Velocidad de salida del grifo ((1+K)/2g)v² − H = 0 | `velocidadGrifo` |

El simulador calcula también el número de Reynolds. Con caudales reales de acueducto el flujo es turbulento, de modo que la recta laminar subestima la pérdida; para la presión de la vivienda se usa Darcy-Weisbach (Swamee-Jain). Esa diferencia se muestra en la pestaña Tuberías.

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

La tarifa de energía (950 COP/kWh), el cargo fijo y la presión mínima de servicio (15 m.c.a.) son valores editables de referencia. Reglamento Técnico del Sector de Agua Potable y Saneamiento Básico (RAS, Resolución 0330 de 2017).
