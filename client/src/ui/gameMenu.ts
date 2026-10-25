import { t } from "../i18n";
import {
  DEFAULT_AUDIO_MASTER,
  DEFAULT_AUDIO_MUSIC,
  DEFAULT_AUDIO_SFX,
  DEFAULT_AUDIO_VOICE,
} from "../settings";
import { appendDiv, setText } from "./dom";

export type VolumeSliderChannel =
  | "audioMaster"
  | "audioSfx"
  | "audioVoice"
  | "audioMusic";

/** What one game menu render shows (spec 08 §3.1). */
export interface GameMenuView {
  open: boolean;
  gore: boolean;
  /** Whether the AI plays; null when no AI is attached (§3.3). */
  ai: boolean | null;
  /** Generated textures on (spec 12 §3); absent counts as off. */
  generatedTextures?: boolean;
  /** Snow on (spec 22 §4); absent counts as off. */
  weather?: boolean;
  /** Map revealed (spec 08 §3.5); absent counts as off. */
  revealed?: boolean;
  /** Performance panel shown (spec 08 §3.5); absent counts as off. */
  fpsPanel?: boolean;
  /** Master volume 0..100 (spec 25 §10). */
  audioMaster?: number;
  /** Effects volume 0..100 (spec 25 §10). */
  audioSfx?: number;
  /** Voices volume 0..100 (spec 25 §10). */
  audioVoice?: number;
  /** Music volume 0..100 (spec 25 §10). */
  audioMusic?: number;
}

/** Callbacks the game menu buttons invoke (spec 08 §3.1). */
export interface GameMenuActions {
  /** Closes the menu and resumes. */
  resume(): void;
  /** Opens "Save game" (spec 19 §5.5); no button when absent. */
  openSaveGame?(): void;
  /** Opens "Load game" (spec 19 §5.5); no button when absent. */
  openLoadGame?(): void;
  /** Same as the `G` key (spec 07 §5). */
  toggleGore(): void;
  /** Pauses or resumes the skirmish AI (§3.3). */
  toggleAi(): void;
  /** Switches procedural/generated textures (spec 12 §3); no button when absent. */
  toggleTextures?(): void;
  /** Switches the snow effect on or off (spec 22 §4); no button when absent. */
  toggleWeather?(): void;
  /** Switches the controlled player, like `F2` (spec 08 §3.5); no button when absent. */
  switchSide?(): void;
  /** Reveals or hides the map, like `F3` (spec 08 §3.5); no button when absent. */
  toggleReveal?(): void;
  /** Shows or hides the performance panel (spec 08 §3.5); no button when absent. */
  toggleFpsPanel?(): void;
  /** Adjusts an audio bus volume 0..100 (spec 25 §10); no sliders when absent. */
  setVolume?(channel: VolumeSliderChannel, value: number): void;
  /** Reloads the page with the same query string. */
  restart(): void;
}

/** The `#game-menu` overlay (spec 08 §3.1). */
export interface GameMenu {
  /** `#game-menu`. */
  readonly root: HTMLElement;
  /** Re-renders only when `view` differs from the last rendered view. */
  render(view: GameMenuView): void;
}

interface VolumeSliderRow {
  channel: VolumeSliderChannel;
  labelEl: HTMLElement;
  inputEl: HTMLInputElement;
  labelKey:
    | "menu.volumeMaster"
    | "menu.volumeSfx"
    | "menu.volumeVoice"
    | "menu.volumeMusic";
  defaultVal: number;
}

/** The full-screen game menu: a backdrop with a centred panel holding the
 *  title and the Resume, Gore, AI and Restart buttons (§3.3). Buttons are
 *  created once, so they stay clickable with a real mouse (spec 08 §3.1,
 *  AC-03-65). */
export function createGameMenu(
  parent: HTMLElement,
  actions: GameMenuActions,
): GameMenu {
  const root = appendDiv(parent, "game-menu");
  root.hidden = true;

  const panel = appendDiv(root, "game-menu-panel");
  const title = document.createElement("h2");
  title.id = "game-menu-title";
  title.textContent = t("menu.title");
  panel.appendChild(title);

  const resume = createButton("game-menu-resume", t("menu.resume"), () => {
    actions.resume();
  });
  const gore = createButton("game-menu-gore", t("menu.goreOff"), () => {
    actions.toggleGore();
  });
  const ai = createButton("game-menu-ai", t("menu.aiOn"), () => {
    actions.toggleAi();
  });
  const restart = createButton("game-menu-restart", t("menu.restart"), () => {
    actions.restart();
  });
  panel.appendChild(resume);
  const openSaveGame = actions.openSaveGame;
  if (openSaveGame !== undefined) {
    panel.appendChild(
      createButton("game-menu-save", t("menu.saveGame"), () =>
        openSaveGame.call(actions),
      ),
    );
  }
  const openLoadGame = actions.openLoadGame;
  if (openLoadGame !== undefined) {
    panel.appendChild(
      createButton("game-menu-load", t("menu.loadGame"), () =>
        openLoadGame.call(actions),
      ),
    );
  }
  panel.appendChild(gore);
  panel.appendChild(ai);
  const toggleTextures = actions.toggleTextures;
  const textures =
    toggleTextures === undefined
      ? null
      : createButton("game-menu-textures", t("menu.texturesProcedural"), () =>
          toggleTextures.call(actions),
        );
  if (textures !== null) panel.appendChild(textures);
  const switchSide = actions.switchSide;
  if (switchSide !== undefined) {
    panel.appendChild(
      createButton("game-menu-switch", t("menu.switchSide"), () =>
        switchSide.call(actions),
      ),
    );
  }
  const toggleReveal = actions.toggleReveal;
  const reveal =
    toggleReveal === undefined
      ? null
      : createButton("game-menu-reveal", t("menu.revealOff"), () =>
          toggleReveal.call(actions),
        );
  if (reveal !== null) panel.appendChild(reveal);
  const toggleWeather = actions.toggleWeather;
  const weather =
    toggleWeather === undefined
      ? null
      : createButton("game-menu-weather", t("menu.weatherOn"), () =>
          toggleWeather.call(actions),
        );
  if (weather !== null) panel.appendChild(weather);
  const toggleFpsPanel = actions.toggleFpsPanel;
  const fps =
    toggleFpsPanel === undefined
      ? null
      : createButton("game-menu-fps", t("menu.fpsOff"), () =>
          toggleFpsPanel.call(actions),
        );
  if (fps !== null) panel.appendChild(fps);

  const sliderRows: VolumeSliderRow[] = [];
  const setVolume = actions.setVolume;
  if (setVolume !== undefined) {
    const defs: Array<{
      id: string;
      channel: VolumeSliderChannel;
      labelKey: VolumeSliderRow["labelKey"];
      defaultVal: number;
    }> = [
      {
        id: "game-menu-volume-master",
        channel: "audioMaster",
        labelKey: "menu.volumeMaster",
        defaultVal: DEFAULT_AUDIO_MASTER,
      },
      {
        id: "game-menu-volume-sfx",
        channel: "audioSfx",
        labelKey: "menu.volumeSfx",
        defaultVal: DEFAULT_AUDIO_SFX,
      },
      {
        id: "game-menu-volume-voice",
        channel: "audioVoice",
        labelKey: "menu.volumeVoice",
        defaultVal: DEFAULT_AUDIO_VOICE,
      },
      {
        id: "game-menu-volume-music",
        channel: "audioMusic",
        labelKey: "menu.volumeMusic",
        defaultVal: DEFAULT_AUDIO_MUSIC,
      },
    ];
    for (const def of defs) {
      const row = appendDiv(panel, `${def.id}-row`);
      const labelEl = document.createElement("label");
      labelEl.id = `${def.id}-label`;
      labelEl.textContent = t(def.labelKey, { pct: def.defaultVal });
      const inputEl = document.createElement("input");
      inputEl.id = def.id;
      inputEl.type = "range";
      inputEl.min = "0";
      inputEl.max = "100";
      inputEl.value = String(def.defaultVal);
      inputEl.addEventListener("input", () => {
        const val = Math.max(0, Math.min(100, Number(inputEl.value) || 0));
        setText(labelEl, t(def.labelKey, { pct: val }));
        setVolume.call(actions, def.channel, val);
      });
      row.appendChild(labelEl);
      row.appendChild(inputEl);
      sliderRows.push({
        channel: def.channel,
        labelEl,
        inputEl,
        labelKey: def.labelKey,
        defaultVal: def.defaultVal,
      });
    }
  }

  panel.appendChild(restart);

  /** Last rendered view; an equal render mutates nothing. */
  let last: GameMenuView | null = null;

  return {
    root,
    render(view) {
      if (
        last !== null &&
        last.open === view.open &&
        last.gore === view.gore &&
        last.ai === view.ai &&
        last.generatedTextures === view.generatedTextures &&
        last.weather === view.weather &&
        last.revealed === view.revealed &&
        last.fpsPanel === view.fpsPanel &&
        last.audioMaster === view.audioMaster &&
        last.audioSfx === view.audioSfx &&
        last.audioVoice === view.audioVoice &&
        last.audioMusic === view.audioMusic
      ) {
        return;
      }
      last = {
        open: view.open,
        gore: view.gore,
        ai: view.ai,
        generatedTextures: view.generatedTextures,
        weather: view.weather,
        revealed: view.revealed,
        fpsPanel: view.fpsPanel,
        audioMaster: view.audioMaster,
        audioSfx: view.audioSfx,
        audioVoice: view.audioVoice,
        audioMusic: view.audioMusic,
      };
      if (root.hidden !== !view.open) root.hidden = !view.open;
      setText(gore, t(view.gore ? "menu.goreOn" : "menu.goreOff"));
      if (textures !== null) {
        setText(
          textures,
          t(
            view.generatedTextures === true
              ? "menu.texturesGenerated"
              : "menu.texturesProcedural",
          ),
        );
      }
      if (weather !== null) {
        setText(
          weather,
          t(view.weather === false ? "menu.weatherOff" : "menu.weatherOn"),
        );
      }
      if (reveal !== null) {
        setText(
          reveal,
          t(view.revealed === true ? "menu.revealOn" : "menu.revealOff"),
        );
      }
      if (fps !== null) {
        setText(fps, t(view.fpsPanel === true ? "menu.fpsOn" : "menu.fpsOff"));
      }
      if (ai.hidden !== (view.ai === null)) ai.hidden = view.ai === null;
      if (view.ai !== null) {
        setText(ai, t(view.ai ? "menu.aiOn" : "menu.aiOff"));
      }
      for (const row of sliderRows) {
        const val = view[row.channel] ?? row.defaultVal;
        setText(row.labelEl, t(row.labelKey, { pct: val }));
        if (row.inputEl.value !== String(val)) {
          row.inputEl.value = String(val);
        }
      }
    },
  };
}

/** A menu button created once; only its text changes on render. */
function createButton(
  id: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = id;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}
