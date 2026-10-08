# SPEC-002: Rejilla Isométrica y Pathfinding por Flow Fields

## Contexto
En un RTS clásico (y especialmente con enjambres modernos de drones o pelotones de infantería), el algoritmo tradicional $A^*$ por unidad satura la CPU cuando hay 50+ unidades moviéndose al mismo punto. Los **Flow Fields (Campos de Flujo / Vector Fields)** resuelven esto calculando un mapa de integración de distancias (Dijkstra desde el objetivo) y generando un vector de dirección por celda. Cientos de unidades navegan fluidamente leyendo el vector de su celda actual.

## Requisitos Técnicos
1. **Grid de Costes:**
   - Dimensiones configurables (ej. 64x64 o 128x128 celdas).
   - Cada celda tiene un coste de terreno (1 = llano, 2 = bosque/barro, 255 = obstáculo infranqueable/agua/edificio).
2. **Generación del Flow Field:**
   - `IntegrationField`: Dijkstra desde la celda destino (`target_cell`).
   - `FlowField`: Matriz donde cada celda almacena un vector unitario discreto o continuo en dirección al vecino con menor coste acumulado.
3. **Mapeo Mundo <-> Celda:**
   - Conversión precisa de coordenadas continuas `Vec2D` a `CellCoord(u32, u32)` y viceversa.
4. **Criterios de Aceptación (Tests que deben pasar):**
   - Una unidad en `(0.0, 0.0)` con destino `(10.0, 10.0)` debe calcular vectores que la acerquen continuamente al destino en cada tick.
   - Si se coloca una pared infranqueable en medio, los vectores del Flow Field deben rodear la pared sin atascarse.
