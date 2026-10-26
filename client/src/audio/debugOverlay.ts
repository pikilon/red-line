// `?audio=debug` interactive overlay (specs/25-audio.md §3, §7, §14).
// Displays live voice pool counts, reference-pack status, admitted/culled event log,
// and a searchable browser of every event with Play (Reference/Active), Play (Synth), and WAV export.

import type { AudioMixer } from "./mixer";

export interface AudioDebugOverlay {
  readonly element: HTMLElement;
  refresh(): void;
  destroy(): void;
}

export function isAudioDebugEnabled(search = window.location.search): boolean {
  const params = new URLSearchParams(search);
  return params.get("audio") === "debug" || params.get("audio") === "1";
}

function collectAllEventIds(
  mixer: AudioMixer,
): { id: string; zhRef?: string; synthSound: string }[] {
  const items: { id: string; zhRef?: string; synthSound: string }[] = [];
  const refMap = mixer.catalog.reference.events;

  for (const [setKey, setDef] of Object.entries(mixer.catalog.voices.sets)) {
    for (const [action, ev] of Object.entries(setDef)) {
      if (!ev) continue;
      const id = `voice.${setKey}.${action}`;
      items.push({
        id,
        zhRef: refMap[id],
        synthSound: ev.sounds[0] ?? "synth:voice",
      });
    }
  }

  for (const [id, ev] of Object.entries(mixer.catalog.events)) {
    items.push({
      id,
      zhRef: refMap[id],
      synthSound: ev.sounds[0] ?? "synth:click",
    });
  }

  return items.sort((a, b) => a.id.localeCompare(b.id));
}

export function createAudioDebugOverlay(
  container: HTMLElement,
  mixer: AudioMixer,
): AudioDebugOverlay {
  const root = document.createElement("aside");
  root.dataset.testid = "audio-debug-overlay";
  root.style.cssText = [
    "position:fixed",
    "top:44px",
    "left:10px",
    "width:430px",
    "max-height:calc(100vh - 60px)",
    "display:flex",
    "flex-direction:column",
    "gap:8px",
    "padding:10px",
    "background:rgba(12,16,22,0.92)",
    "border:1px solid rgba(120,160,210,0.45)",
    "border-radius:6px",
    "color:#e2e8f0",
    "font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace",
    "z-index:90",
    "pointer-events:auto",
    "overflow:hidden",
  ].join(";");

  const header = document.createElement("div");
  header.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;font-weight:700;";
  const title = document.createElement("span");
  title.textContent = "AUDIO DEBUG (Zero Hour Engine)";
  const statusBadge = document.createElement("span");
  statusBadge.dataset.testid = "audio-debug-pack-status";
  statusBadge.style.cssText =
    "font-size:11px;padding:2px 6px;border-radius:4px;background:#1e293b;";
  header.append(title, statusBadge);

  const counters = document.createElement("div");
  counters.dataset.testid = "audio-debug-counters";
  counters.style.cssText = "color:#94a3b8;font-size:11px;";

  const filterInput = document.createElement("input");
  filterInput.type = "search";
  filterInput.placeholder =
    "Filter events (e.g. ua-rifleman, ru-t-72b3, weapon, eva)...";
  filterInput.dataset.testid = "audio-debug-filter";
  filterInput.style.cssText = [
    "width:100%",
    "padding:4px 6px",
    "background:#0f172a",
    "border:1px solid #334155",
    "border-radius:4px",
    "color:#f8fafc",
    "font:inherit",
  ].join(";");

  const eventList = document.createElement("div");
  eventList.dataset.testid = "audio-debug-events";
  eventList.style.cssText = [
    "flex:1 1 220px",
    "overflow-y:auto",
    "border:1px solid #1e293b",
    "border-radius:4px",
    "padding:4px",
    "display:flex",
    "flex-direction:column",
    "gap:3px",
  ].join(";");

  const logHeader = document.createElement("div");
  logHeader.style.cssText =
    "display:flex;justify-content:space-between;align-items:center;font-weight:600;margin-top:2px;";
  const logLabel = document.createElement("span");
  logLabel.textContent = "Admission & Cull Log (canPlayNow)";
  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.textContent = "Clear";
  clearBtn.style.cssText =
    "background:#1e293b;color:#cbd5e1;border:1px solid #334155;border-radius:3px;padding:1px 6px;cursor:pointer;font:inherit;";
  clearBtn.addEventListener("click", () => {
    mixer.director.clearDebugLog();
    refresh();
  });
  logHeader.append(logLabel, clearBtn);

  const logBox = document.createElement("div");
  logBox.dataset.testid = "audio-debug-log";
  logBox.style.cssText = [
    "flex:0 0 130px",
    "overflow-y:auto",
    "border:1px solid #1e293b",
    "border-radius:4px",
    "padding:4px",
    "font-size:11px",
    "background:#090d14",
  ].join(";");

  root.append(header, counters, filterInput, eventList, logHeader, logBox);
  container.appendChild(root);

  const allEvents = collectAllEventIds(mixer);

  function renderEventRows() {
    const query = filterInput.value.trim().toLowerCase();
    eventList.replaceChildren();
    const filtered = query
      ? allEvents.filter(
          (item) =>
            item.id.toLowerCase().includes(query) ||
            (item.zhRef?.toLowerCase().includes(query) ?? false),
        )
      : allEvents;

    for (const item of filtered.slice(0, 120)) {
      const row = document.createElement("div");
      row.dataset.eventId = item.id;
      row.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;gap:4px;padding:2px 4px;background:#111827;border-radius:3px;";

      const label = document.createElement("div");
      label.style.cssText =
        "overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;";
      label.textContent = item.zhRef ? `${item.id} -> ${item.zhRef}` : item.id;
      label.title = label.textContent;

      const actions = document.createElement("div");
      actions.style.cssText = "display:flex;gap:3px;flex-shrink:0;";

      const playBtn = document.createElement("button");
      playBtn.type = "button";
      playBtn.textContent = "Play";
      playBtn.style.cssText =
        "background:#1d4ed8;color:#fff;border:none;border-radius:3px;padding:1px 6px;cursor:pointer;font:inherit;";
      playBtn.addEventListener("click", () => {
        mixer.audition(item.id, false);
        refresh();
      });

      const synthBtn = document.createElement("button");
      synthBtn.type = "button";
      synthBtn.textContent = "Synth";
      synthBtn.style.cssText =
        "background:#334155;color:#e2e8f0;border:none;border-radius:3px;padding:1px 5px;cursor:pointer;font:inherit;";
      synthBtn.addEventListener("click", () => {
        mixer.audition(item.id, true);
        refresh();
      });

      const wavBtn = document.createElement("button");
      wavBtn.type = "button";
      wavBtn.textContent = "WAV";
      wavBtn.style.cssText =
        "background:#065f46;color:#d1fae5;border:none;border-radius:3px;padding:1px 5px;cursor:pointer;font:inherit;";
      wavBtn.addEventListener("click", () => {
        const bytes = mixer.loader.exportSynthWav(item.synthSound);
        const blob = new Blob([bytes.buffer as ArrayBuffer], {
          type: "audio/wav",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${item.id.replace(/[^a-z0-9_-]/gi, "_")}.wav`;
        a.click();
        URL.revokeObjectURL(url);
      });

      actions.append(playBtn, synthBtn, wavBtn);
      row.append(label, actions);
      eventList.appendChild(row);
    }
  }

  filterInput.addEventListener("input", renderEventRows);
  renderEventRows();

  function refresh() {
    const hasPack = mixer.loader.hasReferencePack();
    statusBadge.textContent = hasPack
      ? "ZH Ref Pack: ACTIVE"
      : "Fallback: SYNTH";
    statusBadge.style.color = hasPack ? "#4ade80" : "#facc15";

    const pools = mixer.director.getPoolCounts();
    const limits = mixer.catalog.mix.limits;
    const evaActive = mixer.evaQueue.isPlaying() ? 1 : 0;
    const cacheKb = Math.round(mixer.loader.getCachedBytes() / 1024);
    counters.textContent = `Voices: world ${pools.world}/${limits.worldChannels} | ui ${pools.ui}/${limits.uiChannels} | eva ${evaActive}/1 (q:${mixer.evaQueue.getWaitingCount()}) | loops ${mixer.getActiveLoopCount()} | music ${mixer.getMusicEvent() ?? "none"} | ambient ${mixer.getAmbientEvent() ?? "none"} | cache ${cacheKb} KB`;

    const log = mixer.getDebugLog();
    logBox.replaceChildren();
    for (const entry of log.slice(0, 25)) {
      const line = document.createElement("div");
      line.style.color = entry.admitted ? "#86efac" : "#fca5a5";
      const volPct = Math.round(entry.effectiveVolume * 100);
      const refTag = entry.zhRefName ? ` [${entry.zhRefName}]` : "";
      line.textContent = `${entry.admitted ? "PLAY" : "CULL"} ${entry.eventId}${refTag} (${entry.reason}, vol=${volPct}%, pan=${entry.pan.toFixed(2)})`;
      logBox.appendChild(line);
    }
  }

  refresh();
  const timer = window.setInterval(refresh, 250);

  return {
    element: root,
    refresh,
    destroy() {
      window.clearInterval(timer);
      root.remove();
    },
  };
}
