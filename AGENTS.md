# Modern Conquest: Red Line (AGENTS.md)

Instrucciones maestras para agentes de desarrollo autónomo (Antigravity Pro, Claude Code, DeepSeek Harness, OpenCode, Ornith).

---

## 1. Misión del Proyecto
Construir un RTS (Real-Time Strategy) estilo híbrido entre **Command & Conquer: Generals: Zero Hour** y **Command & Conquer: Red Alert 2**, ambientado en conflictos modernos contemporáneos:
- **Vista:** 2.5D Isométrica (modelos 3D estilizados/low-poly con cámara isométrica fija).
- **Plataforma objetivo:** Navegador Web vía WebAssembly (WASM), 60 FPS estables.
- **Enfoque de Guerra Moderna:** Guerra asimétrica, enjambres de drones FPV y reconocimiento, guerra electrónica (EW), artillería de largo alcance, y doctrinas militares especializadas.
- **Modo de desarrollo:** Spec-Driven & Test-Driven (TDD). **El usuario no toca código directamente.**

---

## 2. Arquitectura de Crates (Rust Workspace)

El proyecto se divide de forma estricta para garantizar que la simulación sea 100% determinista y testeable en milisegundos en línea de comandos:

```text
crates/
├── mgra_core/       # NÚCLEO DETERMINISTA PURO (Headless, 0 dependencias gráficas)
│                    # - Ticks de simulación a 30 Hz
│                    # - Pathfinding (Flow Fields y grid)
│                    # - Combate, balística, daños, drones, economía
│                    # - Totalmente testeable con `cargo test -p mgra_core`
├── mgra_sim_bot/    # SIMULADOR DE PARTIDAS Y BALANCE CON IA LOCAL
│                    # - Ejecución a 1000x velocidad de partidas automáticas
│                    # - Bots de prueba (Kev / Jev) para medir win-rate y equilibrio
└── mgra_web/        # CAPA VISUAL WEB / WASM (Bevy 0.15 Engine)
                     # - Cámara isométrica 2.5D
                     # - Carga de assets GLTF / Shaders estilizados
                     # - UI clásica de barra lateral (Sidebar) y minimapa
```

---

## 3. Protocolo de Trabajo para Agentes

Cualquier agente que trabaje en este repositorio DEBE seguir este ciclo:

1. **Consultar el Backlog:** Leer `tasks/TODO.md` y tomar la siguiente tarea pendiente en estado `[ ]`.
2. **Leer la Especificación:** Leer el archivo correspondiente en `specs/` (ej. `specs/01_deterministic_core.md`).
3. **Escribir / Verificar Tests primero:** Todo cambio de lógica en `mgra_core` debe tener un test determinista antes de dar por buena la implementación.
4. **Verificación Estricta:**
   ```bash
   source "$HOME/.cargo/env" # Si cargo no está en PATH
   cargo test -p mgra_core
   cargo test -p mgra_sim_bot
   ```
5. **No romper contratos de datos:** Las unidades y stats se definen en `data/factions/`.

---

## 4. Reglas de Código
- **Rust Edition 2021**.
- **Determinismo estricto:** En `mgra_core` nunca usar floats no controlados con NaNs o `std::time::Instant` para la lógica del juego. Todo depende del número de `Tick(u64)`.
- Si se requiere aleatoriedad, usar un generador pseudoaleatorio determinista con semilla (*seeded PRNG*).
- Mantener los módulos desacoplados y documentados.
