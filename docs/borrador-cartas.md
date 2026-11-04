# Borrador: colección de cartas (en pausa)

Juego de cartas con los platos, aparcado hasta terminar la gestión del restaurante.
Estos archivos **no forman parte de la web publicada**: nadie llega a ellos desde la carta.

- `borrador-cartas.html`: la página de la colección (34 cartas, se giran al tocarlas,
  brillo en épicas y legendaria, filtros por categoría y rareza).
- `borrador-cards.json`: rareza, estadísticas (🌶️ picante, 💪 llenador, ✨ sabor, ⚡ rapidez)
  y habilidad de cada plato. Si un plato tiene `attributes` en Supabase, esos valores mandan.

Para retomarlo:

1. Mover `borrador-cartas.html` a la raíz como `cartas.html` y `borrador-cards.json`
   a `data/cards.json` (y volver a apuntar el `fetchJson` dentro del HTML).
2. Añadir el botón en `index.html`, debajo del eslogan:
   `<a class="cards-btn" href="cartas.html">🎴 Colección de cartas</a>`, con su estilo.

Pendiente de decidir: duelo contra la máquina, combos en el pedido, sobre diario y álbum.
