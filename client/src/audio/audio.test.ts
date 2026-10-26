import { describe, expect, it } from "vitest";
import { typeDef, typeIndex } from "../rules";
import { ENTITY_FLAGS } from "../sim/matchSnapshot";
import { AUDIO_CATALOG } from "./catalog";
import { deriveSnapshotAudio, resolveCommandVoiceEvent } from "./derive";
import { AudioDirector, shouldPlayLocally } from "./director";
import { EvaQueue } from "./eva";
import { AudioLoader, decodeWavPcmChannels, type ZhRefIndex } from "./loader";
import {
  distanceAttenuation,
  distanceLowPassHz,
  pickVariantIndex,
  relative2dMultiplier,
  samplePitchRate,
  sampleVolumeShift,
  screenStereoPan,
  zoomVolumeMultiplier,
} from "./math";
import { encodeWavPcm16, synthesizePcm } from "./synth";
import type { AudioCatalog } from "./types";

function makeTestCatalog(): AudioCatalog {
  return {
    events: {
      "weapon.tank.fire": {
        sounds: ["shot1", "shot2", "shot3"],
        volume: 90,
        volumeShift: -10,
        pitchShift: [-5, 5],
        limit: 2,
        priority: "normal",
        type: ["world", "shrouded", "everyone"],
        control: ["random", "interrupt"],
        minDistance: 4,
        maxDistance: 20,
      },
      "move.tank.start": {
        sounds: ["move1"],
        volume: 60,
        limit: 2,
        priority: "low",
        type: ["world", "shrouded", "everyone"],
        control: ["random"],
        minDistance: 4,
        maxDistance: 16,
      },
      "ui.click": {
        sounds: ["click1"],
        volume: 50,
        limit: 4,
        priority: "high",
        type: ["ui", "player"],
        control: ["random"],
      },
      "explosion.critical": {
        sounds: ["boom1"],
        volume: 100,
        limit: 2,
        priority: "critical",
        type: ["world", "everyone"],
        control: ["random"],
        minDistance: 6,
        maxDistance: 30,
      },
    },
    voices: {
      sets: {
        "ua-rifleman": {
          select: {
            sounds: ["sel1", "sel2", "sel3"],
            volume: 90,
            limit: 1,
            priority: "high",
            type: ["ui", "voice", "player"],
            control: ["random", "interrupt"],
          },
          move: {
            sounds: ["mov1", "mov2"],
            volume: 90,
            limit: 1,
            priority: "high",
            type: ["ui", "voice", "player"],
            control: ["random"],
          },
          underFire: {
            sounds: ["uf1", "uf2"],
            volume: 100,
            limit: 1,
            priority: "normal",
            type: ["world", "voice", "player"],
            control: ["random"],
            minDistance: 4,
            maxDistance: 20,
          },
          die: {
            sounds: ["die1", "die2"],
            volume: 100,
            limit: 3,
            priority: "low",
            type: ["world", "voice", "everyone"],
            control: ["random"],
            minDistance: 4,
            maxDistance: 20,
          },
        },
      },
    },
    eva: {
      events: {
        baseUnderAttack: {
          priority: 7,
          cooldownMs: 30000,
          expireMs: 5000,
          sounds: {
            ukraine: "RangerVoiceBaseAttack",
            russia: "RedGuardVoiceBaseAttack",
          },
        },
        lowPower: {
          priority: 2,
          cooldownMs: 120000,
          expireMs: 5000,
          sounds: { ukraine: "EvaUSA_LowPower", russia: "EvaChina_LowPower" },
        },
        unitLost: {
          priority: 1,
          cooldownMs: 15000,
          expireMs: 5000,
          sounds: { ukraine: "EvaUSA_UnitLost", russia: "EvaChina_UnitLost" },
        },
      },
    },
    mix: {
      buses: {
        master: 100,
        sfx: 80,
        voice: 70,
        eva: 70,
        ui: 80,
        ambient: 60,
        music: 55,
      },
      limits: {
        worldChannels: 3,
        uiChannels: 2,
        streamChannels: 2,
        minSampleVolume: 0.02,
        relative2dVolume: -0.1,
        drawableRetryMs: 1000,
        fadeMs: 2000,
      },
      zoom: { minZoom: 0.6, maxZoom: 3.0, bonus: 0.2 },
      ducking: {
        eva: { musicDb: -9, sfxDb: -4, holdMs: 300, releaseMs: 500 },
        voice: { musicDb: -4, sfxDb: 0, holdMs: 150, releaseMs: 500 },
      },
      underFire: { perUnitCooldownMs: 12000, globalCooldownMs: 3000 },
      music: { fadeMs: 2000, combatHoldMs: 12000 },
    },
    reference: { events: {} },
    recipes: {},
  };
}

describe("audio math curves (Zero Hour formulas)", () => {
  it("computes inverse distance attenuation MinRange / dist and 0 at MaxRange", () => {
    expect(distanceAttenuation(2, 4, 20)).toBe(1);
    expect(distanceAttenuation(4, 4, 20)).toBe(1);
    expect(distanceAttenuation(8, 4, 20)).toBeCloseTo(0.5, 5);
    expect(distanceAttenuation(16, 4, 20)).toBeCloseTo(0.25, 5);
    expect(distanceAttenuation(20, 4, 20)).toBe(0);
    expect(distanceAttenuation(25, 4, 20)).toBe(0);
  });

  it("clamps stereo pan to [-0.85, 0.85] and scales linearly within screen", () => {
    expect(screenStereoPan(0)).toBe(0);
    expect(screenStereoPan(1)).toBeCloseTo(0.85, 5);
    expect(screenStereoPan(-1)).toBeCloseTo(-0.85, 5);
    expect(screenStereoPan(2.5)).toBeCloseTo(0.85, 5);
    expect(screenStereoPan(-3)).toBeCloseTo(-0.85, 5);
  });

  it("computes camera zoom volume boost (+20% when zoomed in)", () => {
    expect(zoomVolumeMultiplier(0.6, 0.6, 3.0, 0.2)).toBeCloseTo(0.8, 5);
    expect(zoomVolumeMultiplier(1.8, 0.6, 3.0, 0.2)).toBeCloseTo(0.9, 5);
    expect(zoomVolumeMultiplier(3.0, 0.6, 3.0, 0.2)).toBeCloseTo(1.0, 5);
  });

  it("applies 2D relative volume and non-repeating random variant selection", () => {
    expect(relative2dMultiplier(-0.1)).toBeCloseTo(0.9, 5);
    expect(samplePitchRate([-5, 5], () => 0)).toBeCloseTo(0.95, 5);
    expect(samplePitchRate([-5, 5], () => 1)).toBeCloseTo(1.05, 5);
    expect(sampleVolumeShift(-20, () => 0)).toBeCloseTo(0.8, 5);
    expect(distanceLowPassHz(12, 4, 20, 50)).toBeLessThan(18000);

    // Avoids repeating lastIndex when rng picks the same index
    const next = pickVariantIndex(4, true, 1, () => 0.3); // floor(0.3 * 4) === 1
    expect(next).not.toBe(1);
  });
});

describe("AudioDirector admission (SoundManager::canPlayNow)", () => {
  it("filters by audience (shouldPlayLocally) and shroud visibility", () => {
    expect(shouldPlayLocally(["ui", "player"], "self")).toBe(true);
    expect(shouldPlayLocally(["ui", "player"], "enemy")).toBe(false);
    expect(shouldPlayLocally(["world", "everyone"], "enemy")).toBe(true);

    let now = 1000;
    const director = new AudioDirector({
      catalog: makeTestCatalog(),
      nowMs: () => now,
      rng: () => 0.5,
    });
    const listener = { tileX: 10, tileY: 10, zoom: 1.5 };

    // Enemy shot in shroud is culled
    const shrouded = director.admit(
      {
        eventId: "weapon.tank.fire",
        relation: "enemy",
        tileX: 12,
        tileY: 10,
        tileVisible: false,
      },
      listener,
    );
    expect(shrouded.decision.admitted).toBe(false);
    expect(shrouded.decision.reason).toBe("culled_shroud");

    // Own shot even if tileVisible=false is admitted
    now += 10;
    const own = director.admit(
      {
        eventId: "weapon.tank.fire",
        relation: "self",
        tileX: 12,
        tileY: 10,
        tileVisible: false,
      },
      listener,
    );
    expect(own.decision.admitted).toBe(true);
  });

  it("enforces the voice rule (violatesVoice): blocks non-interrupting voice on same unit, allows interrupt", () => {
    const director = new AudioDirector({
      catalog: makeTestCatalog(),
      nowMs: () => 1000,
      rng: () => 0.2,
    });
    const listener = { tileX: 10, tileY: 10, zoom: 1 };

    // First select voice on entity 42 plays
    const first = director.admit(
      { eventId: "voice.ua-rifleman.select", entityId: 42, relation: "self" },
      listener,
    );
    expect(first.decision.admitted).toBe(true);

    // Non-interrupting move voice on same entity 42 is refused while select is active
    const second = director.admit(
      { eventId: "voice.ua-rifleman.move", entityId: 42, relation: "self" },
      listener,
    );
    expect(second.decision.admitted).toBe(false);
    expect(second.decision.reason).toBe("culled_voice_rule");

    // Interrupting select voice on entity 42 kills the previous handle and plays
    const third = director.admit(
      { eventId: "voice.ua-rifleman.select", entityId: 42, relation: "self" },
      listener,
    );
    expect(third.decision.admitted).toBe(true);
    expect(third.decision.killedHandles).toEqual([first.handle]);
  });

  it("enforces per-event limits and steals lower-priority channels when pool is full", () => {
    let now = 1000;
    const director = new AudioDirector({
      catalog: makeTestCatalog(),
      nowMs: () => now,
      rng: () => 0.5,
    });
    const listener = { tileX: 10, tileY: 10, zoom: 1 };

    // move.tank.start has limit: 2 and control: [random] (no interrupt)
    const m1 = director.admit(
      { eventId: "move.tank.start", tileX: 11, tileY: 10 },
      listener,
    );
    now += 10;
    const m2 = director.admit(
      { eventId: "move.tank.start", tileX: 11, tileY: 10 },
      listener,
    );
    now += 10;
    const m3 = director.admit(
      { eventId: "move.tank.start", tileX: 11, tileY: 10 },
      listener,
    );
    expect(m1.decision.admitted).toBe(true);
    expect(m2.decision.admitted).toBe(true);
    expect(m3.decision.admitted).toBe(false);
    expect(m3.decision.reason).toBe("culled_limit");

    // Fill the 3rd world channel with weapon.tank.fire (priority: normal)
    now += 10;
    const w1 = director.admit(
      { eventId: "weapon.tank.fire", tileX: 11, tileY: 10 },
      listener,
    );
    expect(w1.decision.admitted).toBe(true);
    expect(director.getPoolCounts().world).toBe(3);

    // World pool is now full (3/3). A critical explosion steals the oldest low-priority channel (m1)
    now += 10;
    const crit = director.admit(
      { eventId: "explosion.critical", tileX: 12, tileY: 10 },
      listener,
    );
    expect(crit.decision.admitted).toBe(true);
    expect(crit.decision.killedHandles).toEqual([m1.handle]);
    expect(director.getPoolCounts().world).toBe(3);
  });

  it("throttles underFire voices by onScreen, per-unit cooldown (12s) and global budget (3s)", () => {
    let now = 5000;
    const director = new AudioDirector({
      catalog: makeTestCatalog(),
      nowMs: () => now,
      rng: () => 0.5,
    });
    const listener = { tileX: 10, tileY: 10, zoom: 1 };

    // Off-screen underFire is culled
    const offscreen = director.admit(
      {
        eventId: "voice.ua-rifleman.underFire",
        entityId: 1,
        isUnderFire: true,
        onScreen: false,
        tileX: 11,
        tileY: 10,
      },
      listener,
    );
    expect(offscreen.decision.admitted).toBe(false);
    expect(offscreen.decision.reason).toBe("culled_offscreen");

    // On-screen underFire for unit 1 plays
    const uf1 = director.admit(
      {
        eventId: "voice.ua-rifleman.underFire",
        entityId: 1,
        isUnderFire: true,
        onScreen: true,
        tileX: 11,
        tileY: 10,
      },
      listener,
    );
    expect(uf1.decision.admitted).toBe(true);
    if (uf1.handle !== null) director.releaseChannel(uf1.handle);

    // 1 second later, unit 2 is blocked by the 3s global budget
    now += 1000;
    const uf2Blocked = director.admit(
      {
        eventId: "voice.ua-rifleman.underFire",
        entityId: 2,
        isUnderFire: true,
        onScreen: true,
        tileX: 11,
        tileY: 10,
      },
      listener,
    );
    expect(uf2Blocked.decision.admitted).toBe(false);
    expect(uf2Blocked.decision.reason).toBe("culled_under_fire_budget");

    // 3.5 seconds after first, unit 1 is still blocked by 12s per-unit cooldown, but unit 2 is allowed
    now += 2500;
    const uf1Cooldown = director.admit(
      {
        eventId: "voice.ua-rifleman.underFire",
        entityId: 1,
        isUnderFire: true,
        onScreen: true,
        tileX: 11,
        tileY: 10,
      },
      listener,
    );
    expect(uf1Cooldown.decision.admitted).toBe(false);
    expect(uf1Cooldown.decision.reason).toBe("culled_under_fire_cooldown");

    const uf2Allowed = director.admit(
      {
        eventId: "voice.ua-rifleman.underFire",
        entityId: 2,
        isUnderFire: true,
        onScreen: true,
        tileX: 11,
        tileY: 10,
      },
      listener,
    );
    expect(uf2Allowed.decision.admitted).toBe(true);
  });
});

describe("EvaQueue (Eva::processPlayingMessages)", () => {
  it("plays highest priority waiting message, enforces cooldown, and drops expired messages", () => {
    let now = 1000;
    const eva = new EvaQueue(makeTestCatalog().eva.events, () => now);

    // Queue unitLost (priority 1) and baseUnderAttack (priority 7) before processing
    expect(eva.trigger("unitLost", "ukraine")).toBe(true);
    expect(eva.trigger("baseUnderAttack", "ukraine")).toBe(true);
    // Duplicate trigger while waiting is ignored
    expect(eva.trigger("baseUnderAttack", "ukraine")).toBe(false);

    // process() picks baseUnderAttack first (priority 7 > priority 1)
    const first = eva.process(2000);
    expect(first?.eventId).toBe("baseUnderAttack");
    expect(first?.soundRef).toBe("RangerVoiceBaseAttack");

    // While baseUnderAttack is playing (2000ms), process() returns null
    now += 1000;
    expect(eva.process()).toBeNull();

    // Re-triggering baseUnderAttack during its 30s cooldown is rejected
    now += 1500;
    expect(eva.trigger("baseUnderAttack", "ukraine")).toBe(false);

    // Stream is now free (2500ms elapsed > 2000ms duration), unitLost (still within 5000ms expiry) plays
    const second = eva.process(1000);
    expect(second?.eventId).toBe("unitLost");

    // Queue lowPower while unitLost is playing, then advance past lowPower's 5000ms expiry
    expect(eva.trigger("lowPower", "russia")).toBe(true);
    now += 6000;
    expect(eva.process()).toBeNull();
  });
});

describe("Procedural synth and WAV encoder", () => {
  it("synthesizes deterministic non-zero PCM and encodes valid RIFF/WAVE header", () => {
    const pcm = synthesizePcm({
      kind: "burst",
      durationMs: 100,
      freqStartHz: 300,
      freqEndHz: 100,
      filterType: "lowpass",
      filterHz: 1000,
      noiseMix: 0.5,
      attackMs: 5,
      decayMs: 90,
      gain: 0.7,
    });
    expect(pcm.length).toBeGreaterThan(1000);
    expect(pcm.some((v) => Math.abs(v) > 0.05)).toBe(true);

    const wav = encodeWavPcm16(pcm);
    const header = String.fromCharCode(...wav.slice(0, 4));
    const format = String.fromCharCode(...wav.slice(8, 12));
    expect(header).toBe("RIFF");
    expect(format).toBe("WAVE");
    expect(wav.byteLength).toBe(44 + pcm.length * 2);
  });
});

describe("AUDIO_CATALOG and snapshot derivation (Ukraine -> USA, Russia -> China)", () => {
  it("maps Ukrainian voices/EVA to USA and Russian voices/EVA to China in reference.yaml", () => {
    expect(AUDIO_CATALOG.reference.events["voice.ua-rifleman.select"]).toBe(
      "RangerVoiceSelect",
    );
    expect(AUDIO_CATALOG.reference.events["voice.ua-leopard-2a4.attack"]).toBe(
      "CrusaderTankVoiceAttack",
    );
    expect(AUDIO_CATALOG.reference.events["voice.ru-rifleman.select"]).toBe(
      "RedGuardVoiceSelect",
    );
    expect(AUDIO_CATALOG.reference.events["voice.ru-t-72b3.attack"]).toBe(
      "BattleMasterTankVoiceAttack",
    );
    expect(AUDIO_CATALOG.eva.events.lowPower?.sounds.ukraine).toBe(
      "EvaUSA_LowPower",
    );
    expect(AUDIO_CATALOG.eva.events.lowPower?.sounds.russia).toBe(
      "EvaChina_LowPower",
    );
  });

  it("derives weapon fire, impact, underFire, death, and command leader voices from snapshots", () => {
    const unit0 = {
      id: 1,
      owner: 0,
      kind: typeIndex("ua-rifleman"),
      x: 10,
      y: 10,
      hp: 100,
      flags: 0,
      progress: 0,
      target: null,
      heading: 0,
      turretAngle: 0,
    };
    const prev = {
      tick: 10,
      viewer: 0,
      credits: 1000,
      powerProduced: 10,
      powerConsumed: 5,
      outcome: "ongoing" as const,
      winner: null,
      entities: [unit0],
      queues: [],
    };
    const next = {
      ...prev,
      tick: 11,
      powerProduced: 5,
      powerConsumed: 10, // drops into low power
      entities: [
        {
          ...unit0,
          hp: 80,
          flags: 1, // moving
        },
      ],
    };
    const combat = {
      projectiles: [
        {
          id: 99,
          owner: 1,
          weapon: 0,
          shooter: 2,
          target: 1,
          originX: 14,
          originY: 10,
          impactX: 10,
          impactY: 10,
          launchTick: 11,
          impactTick: 12,
        },
      ],
      events: [
        {
          kind: "detonate" as const,
          projectile: 98,
          owner: 1,
          weapon: 0,
          hit: 1,
          x: 10,
          y: 10,
        },
      ],
    };

    const batch = deriveSnapshotAudio(
      prev,
      next,
      combat,
      0,
      {
        projectTile: () => ({ screenX: 0, onScreen: true }),
        isTileVisible: () => true,
      },
      AUDIO_CATALOG,
    );

    const eventIds = batch.requests.map((r) => r.request.eventId);
    expect(eventIds.some((id) => id.startsWith("weapon."))).toBe(true);
    expect(eventIds.some((id) => id.startsWith("impact."))).toBe(true);
    expect(eventIds).toContain("voice.ua-rifleman.underFire");
    expect(batch.evaEvents).toContain("lowPower");

    const cmdVoice = resolveCommandVoiceEvent([1], next.entities, 0, "select");
    expect(cmdVoice?.eventId).toContain(".select");
  });

  it("derives construction site loops and heavy building damage", () => {
    const hq = typeIndex("ua-hq");
    const def = typeDef(hq);
    const prevEntity = {
      id: 10,
      owner: 0,
      kind: hq,
      x: 20,
      y: 20,
      hp: def.hp,
      flags: ENTITY_FLAGS.underConstruction,
      progress: 500,
      target: null,
      heading: 0,
      turretAngle: 0,
    };
    const prev = {
      tick: 1,
      viewer: 0,
      credits: 1000,
      powerProduced: 0,
      powerConsumed: 0,
      outcome: "ongoing" as const,
      winner: null,
      entities: [prevEntity],
      queues: [],
    };
    const next = {
      ...prev,
      tick: 2,
      entities: [
        {
          ...prevEntity,
          hp: Math.floor(def.hp * 0.4),
        },
      ],
    };
    const batch = deriveSnapshotAudio(
      prev,
      next,
      { projectiles: [], events: [] },
      0,
      {
        projectTile: () => ({ screenX: 0, onScreen: true }),
        isTileVisible: () => true,
      },
      AUDIO_CATALOG,
    );

    expect(batch.constructionLoops.map((loop) => loop.entityId)).toEqual([10]);
    expect(batch.requests.map((entry) => entry.request.eventId)).toContain(
      "building.damage.heavy",
    );

    const critical = deriveSnapshotAudio(
      prev,
      {
        ...next,
        tick: 3,
        entities: [
          {
            ...prevEntity,
            hp: Math.floor(def.hp * 0.2),
          },
        ],
      },
      { projectiles: [], events: [] },
      0,
      {
        projectTile: () => ({ screenX: 0, onScreen: true }),
        isTileVisible: () => true,
      },
      AUDIO_CATALOG,
    );
    expect(critical.requests.map((entry) => entry.request.eventId)).toContain(
      "building.damage.critical",
    );

    const tank = typeIndex("ua-bradley");
    const tankDef = typeDef(tank);
    const tankPrevEntity = {
      ...prevEntity,
      kind: tank,
      hp: tankDef.hp,
      flags: 0,
    };
    const tankPrev = {
      ...prev,
      entities: [tankPrevEntity],
    };
    const tankNext = {
      ...tankPrev,
      tick: 2,
      entities: [{ ...tankPrevEntity, hp: Math.floor(tankDef.hp * 0.4) }],
    };
    const tankBatch = deriveSnapshotAudio(
      tankPrev,
      tankNext,
      { projectiles: [], events: [] },
      0,
      {
        projectTile: () => ({ screenX: 0, onScreen: true }),
        isTileVisible: () => true,
      },
      AUDIO_CATALOG,
    );
    expect(tankBatch.requests.map((entry) => entry.request.eventId)).toContain(
      "vehicle.damage",
    );
  });
});

describe("Zero Hour WAV decoding", () => {
  function makeMonoImaWav(): ArrayBuffer {
    const buffer = new ArrayBuffer(60);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    view.setUint32(4, 52, true);
    bytes.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
    bytes.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
    view.setUint32(16, 20, true);
    view.setUint16(20, 0x0011, true); // IMA ADPCM
    view.setUint16(22, 1, true); // mono
    view.setUint32(24, 22050, true);
    view.setUint32(28, 11100, true);
    view.setUint16(32, 8, true); // blockAlign
    view.setUint16(34, 4, true);
    view.setUint16(36, 2, true);
    view.setUint16(38, 9, true); // samplesPerBlock
    bytes.set([0x64, 0x61, 0x74, 0x61], 40); // data
    view.setUint32(44, 8, true);
    view.setInt16(48, 4096, true); // initial predictor
    view.setInt8(50, 20); // step index
    bytes.set([0x74, 0x12, 0xf5, 0x83], 52);
    return buffer;
  }

  function makeStereoImaWav(): ArrayBuffer {
    const buffer = new ArrayBuffer(76);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    view.setUint32(4, 68, true);
    bytes.set([0x57, 0x41, 0x56, 0x45], 8);
    bytes.set([0x66, 0x6d, 0x74, 0x20], 12);
    view.setUint32(16, 20, true);
    view.setUint16(20, 0x0011, true);
    view.setUint16(22, 2, true);
    view.setUint32(24, 22050, true);
    view.setUint32(28, 39200, true);
    view.setUint16(32, 16, true); // blockAlign: 8 header + 8 data
    view.setUint16(34, 4, true);
    view.setUint16(36, 2, true);
    view.setUint16(38, 9, true);
    bytes.set([0x66, 0x61, 0x63, 0x74], 40); // fact
    view.setUint32(44, 4, true);
    view.setUint32(48, 9, true); // frames
    bytes.set([0x64, 0x61, 0x74, 0x61], 52); // data
    view.setUint32(56, 16, true);
    view.setInt16(60, 1000, true); // ch0 predictor
    view.setInt8(62, 0);
    view.setInt16(64, -1000, true); // ch1 predictor
    view.setInt8(66, 0);
    // Eight nibbles of zero for each channel: the predictor stays constant.
    bytes.set(new Uint8Array(8), 68);
    return buffer;
  }

  it("decodes Zero Hour 4-bit IMA ADPCM mono and stereo blocks", () => {
    const mono = decodeWavPcmChannels(makeMonoImaWav());
    expect(mono?.sampleRate).toBe(22050);
    expect(mono?.frames).toBe(9);
    expect(mono?.channels).toHaveLength(1);
    expect(mono?.channels[0]?.[0]).toBeCloseTo(4096 / 32768, 4);

    const stereo = decodeWavPcmChannels(makeStereoImaWav());
    expect(stereo?.frames).toBe(9);
    expect(stereo?.channels).toHaveLength(2);
    expect(stereo?.channels[0]?.[8]).toBeCloseTo(1000 / 32768, 4);
    expect(stereo?.channels[1]?.[8]).toBeCloseTo(-1000 / 32768, 4);
  });

  it("decodes 16-bit PCM WAV through the same path", () => {
    const pcm = encodeWavPcm16(new Float32Array([0, 0.5, -0.5, 0.25]), 22050);
    const decoded = decodeWavPcmChannels(pcm.buffer as ArrayBuffer);
    expect(decoded?.frames).toBe(4);
    expect(decoded?.sampleRate).toBe(22050);
    expect(decoded?.channels[0]?.[1]).toBeCloseTo(0.5, 2);
  });

  it("returns null for unsupported or malformed data", () => {
    expect(decodeWavPcmChannels(new ArrayBuffer(4))).toBeNull();
    expect(decodeWavPcmChannels(new ArrayBuffer(44))).toBeNull();
  });
});

describe("Zero Hour reference resolution and faction mapping", () => {
  const USA_PREFIXES = [
    "Ranger",
    "MissileDefender",
    "Humvee",
    "PaladinTank",
    "CrusaderTank",
    "Tomahawk",
    "DozerUSA",
    "Chinook",
    "CommandCenterUSA",
    "BarracksUSA",
    "WarFactoryUSA",
    "EvaUSA_",
  ];
  const CHINA_PREFIXES = [
    "RedGuard",
    "TankHunter",
    "GattlingTank",
    "TroopCrawler",
    "BattleMasterTank",
    "InfernoCannon",
    "DozerChina",
    "SupplyTruck",
    "CommandCenterChina",
    "BarracksChina",
    "WarFactoryChina",
    "EvaChina_",
  ];

  const usesPrefix = (target: string, prefixes: readonly string[]): boolean =>
    target === "Explosion" ||
    prefixes.some((prefix) => target.startsWith(prefix));

  it("assigns USA voices to Ukraine and China voices to Russia", () => {
    const violations: string[] = [];
    for (const [eventId, target] of Object.entries(
      AUDIO_CATALOG.reference.events,
    )) {
      if (
        (eventId.startsWith("voice.ua-") ||
          eventId.startsWith("eva.ukraine.")) &&
        !usesPrefix(target, USA_PREFIXES)
      ) {
        violations.push(`${eventId} -> ${target}`);
      }
      if (
        (eventId.startsWith("voice.ru-") ||
          eventId.startsWith("eva.russia.")) &&
        !usesPrefix(target, CHINA_PREFIXES)
      ) {
        violations.push(`${eventId} -> ${target}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it("maps every voice set action to a reference event", () => {
    const missing: string[] = [];
    for (const [setId, set] of Object.entries(AUDIO_CATALOG.voices.sets)) {
      for (const action of Object.keys(set)) {
        if (!AUDIO_CATALOG.reference.events[`voice.${setId}.${action}`]) {
          missing.push(`voice.${setId}.${action}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("maps every event id to a reference name or a deliberate NoSound", () => {
    const missing = Object.keys(AUDIO_CATALOG.events).filter(
      (eventId) => AUDIO_CATALOG.reference.events[eventId] === undefined,
    );
    expect(missing).toEqual([]);
  });

  it("resolves reference URLs, honours NoSound, and falls back to synth on demand", () => {
    const loader = new AudioLoader(AUDIO_CATALOG);
    (
      loader as unknown as { zhIndex: ZhRefIndex | null; zhProbed: boolean }
    ).zhIndex = {
      events: {
        RangerWeapon: { sounds: ["iranweaa"] },
        UnderConstructionLoop: {
          sounds: ["gconlo2a"],
          attackSounds: ["gconlo1a"],
          decaySounds: ["gconlo3a"],
        },
      },
      dialogs: { EvaUSA_LowPower: { filename: "eupower.wav" } },
      files: {
        iranweaa: "files/iranweaa.wav",
        gconlo2a: "files/gconlo2a.wav",
        gconlo1a: "files/gconlo1a.wav",
        gconlo3a: "files/gconlo3a.wav",
        "eupower.wav": "files/eupower.wav",
      },
    };
    (
      loader as unknown as { zhIndex: ZhRefIndex | null; zhProbed: boolean }
    ).zhProbed = true;

    expect(
      loader.resolveEventSounds("weapon.ua-rifle.fire", ["synth:muzzle"]),
    ).toEqual(["/audio-ref/files/iranweaa.wav"]);
    expect(loader.resolveEventSounds("move.foot", ["synth:footstep"])).toEqual(
      [],
    );
    expect(
      loader.resolveEventSounds("weapon.ua-rifle.fire", ["synth:muzzle"], true),
    ).toEqual(["synth:muzzle"]);
    expect(loader.resolveZhUrls("EvaUSA_LowPower")).toEqual([
      "/audio-ref/files/eupower.wav",
    ]);
    expect(
      loader.resolveLoopParts("building.construct", ["synth:construction"]),
    ).toEqual({
      loop: ["/audio-ref/files/gconlo2a.wav"],
      attack: ["/audio-ref/files/gconlo1a.wav"],
      decay: ["/audio-ref/files/gconlo3a.wav"],
    });
  });

  it("does not muffle events that have no lowPass setting", () => {
    expect(distanceLowPassHz(20, 4, 20)).toBe(18000);
    expect(distanceLowPassHz(20, 4, 20, 50)).toBeLessThan(12000);
  });

  it("shares one reference probe across concurrent callers", async () => {
    const loader = new AudioLoader(AUDIO_CATALOG);
    const originalFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(JSON.stringify({ files: {} }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      const results = await Promise.all([
        loader.initReferencePack(),
        loader.initReferencePack(),
      ]);
      expect(results).toEqual([true, true]);
      expect(requests).toBe(1);
      expect(loader.isProbeDone()).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
