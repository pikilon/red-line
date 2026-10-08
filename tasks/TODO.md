# Backlog de Tareas - Modern Conquest: Red Line

Convención: Los agentes deben tomar tareas en orden de dependencia, cambiar `[ ]` a `[x]`, y dejar constancia de los tests pasados.

---

## Fase 1: Núcleo Determinista y Movimiento (Headless)
- [x] **TASK-001**: Inicialización del Workspace Rust (`mgra_core`, `mgra_sim_bot`, `mgra_web`) y `AGENTS.md`.
- [ ] **TASK-002**: Sistema de Rejilla y Pathfinding por Flow Fields (para enjambres de unidades fluidos). Spec: `specs/02_flow_field_pathfinding.md`.
- [ ] **TASK-003**: Definición de Datos de Facciones (Ucrania vs Rusia inicial) en JSON/RON: infantería, blindados, drones FPV y artillería.
- [ ] **TASK-004**: Sistema de Combate y Balística (rango de disparo, línea de visión, armadura/penetración, daño de área).
- [ ] **TASK-005**: Economía y Edificios (Centro de mando, planta de energía, refinería y cosecha continua de recursos).

---

## Fase 2: Simulador Headless y Balance con IA Local
- [ ] **TASK-006**: Bot básico de Skirmish para `mgra_sim_bot` (Macro de producción + Micro de ataque).
- [ ] **TASK-007**: Script de benchmark headless (50 partidas simuladas a 1000x y exportación de métricas de equilibrio en JSON).

---

## Fase 3: Renderizador Web 2.5D y UI Clásica
- [ ] **TASK-008**: Configuración de Bevy con cámara isométrica y plano de terreno.
- [ ] **TASK-009**: Selección con marco de arrastre (drag-box), selección múltiple y comandos de movimiento visual.
- [ ] **TASK-010**: Barra lateral clásica (Sidebar de C&C) con pestañas de construcción y cola de producción.
- [ ] **TASK-011**: Compilación a WebAssembly (WASM) y servidor de prueba local.
