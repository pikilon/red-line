import { type MessageKey, t } from "../i18n";
import {
  CAMPAIGNS,
  type Campaign,
  type CampaignMission,
  type CampaignProgress,
  findCampaignMission,
} from "./campaign";
import { appendDiv } from "./dom";
import type { VolumeSliderChannel } from "./gameMenu";
import { goalText, TUTORIALS, type TutorialMission } from "./tutorial";

/** Callbacks of the main menu buttons (spec 45 §4). */
export interface MainMenuActions {
  /** Leaves the shell battle for a new skirmish. */
  skirmish(): void;
  /** Opens the save manager in load mode (spec 19 §5.5). */
  loadGame(): void;
  /** Starts a tutorial mission (spec 46). */
  tutorial(mission: TutorialMission): void;
  /** Starts a campaign mission (spec 48). */
  campaign(mission: CampaignMission): void;
  /** Missions won per campaign (spec 48 §4). */
  progress: CampaignProgress;
  /** `?campaign=` page to open first: a mission id or `<faction>-ending`. */
  openCampaign?: string | null;
  /** Current volume 0..100 of a bus (owner request 2026-11-04). */
  getVolume(channel: VolumeSliderChannel): number;
  /** Sets a bus volume 0..100. */
  setVolume(channel: VolumeSliderChannel, value: number): void;
}

const VOLUME_ROWS: [VolumeSliderChannel, MessageKey][] = [
  ["audioMaster", "menu.volumeMaster"],
  ["audioSfx", "menu.volumeSfx"],
  ["audioAmbient", "menu.volumeAmbient"],
  ["audioVoice", "menu.volumeVoice"],
  ["audioMusic", "menu.volumeMusic"],
];

function menuButton(id: string, text: string, action: () => void): HTMLElement {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.textContent = text;
  button.addEventListener("click", action);
  return button;
}

/** The `#main-menu` overlay drawn over the AI-vs-AI shell battle (spec 45). */
export function createMainMenu(
  root: HTMLElement,
  actions: MainMenuActions,
): HTMLElement {
  const element = appendDiv(root, "main-menu");
  const panel = document.createElement("nav");
  panel.id = "main-menu-panel";
  const title = document.createElement("h1");
  title.id = "main-menu-title";
  title.textContent = t("mainMenu.title");
  const subtitle = document.createElement("p");
  subtitle.id = "main-menu-subtitle";
  subtitle.textContent = t("mainMenu.subtitle");
  panel.append(title, subtitle);
  const main = document.createElement("div");
  main.className = "main-menu-page";
  const tutorials = document.createElement("div");
  tutorials.className = "main-menu-page";
  tutorials.hidden = true;
  const sound = document.createElement("div");
  sound.className = "main-menu-page";
  sound.hidden = true;
  const campaigns = document.createElement("div");
  campaigns.className = "main-menu-page";
  campaigns.hidden = true;
  const show = (page: HTMLElement): void => {
    main.hidden = page !== main;
    tutorials.hidden = page !== tutorials;
    sound.hidden = page !== sound;
    campaigns.hidden = page !== campaigns;
    panel.hidden = false;
    briefing.hidden = true;
  };
  const briefing = createBriefing(element, () => {
    fillCampaigns(campaigns, actions, openBriefing);
    show(campaigns);
  });
  /** Spec 48 §4: the movie, briefing and objectives of `mission`. */
  function openBriefing(mission: CampaignMission): void {
    panel.hidden = true;
    briefing.mission(mission, () => actions.campaign(mission));
  }
  const buttons: [string, MessageKey, () => void][] = [
    [
      "main-menu-campaign",
      "mainMenu.campaign",
      () => {
        fillCampaigns(campaigns, actions, openBriefing);
        show(campaigns);
      },
    ],
    ["main-menu-skirmish", "mainMenu.skirmish", actions.skirmish],
    ["main-menu-tutorials", "mainMenu.tutorials", () => show(tutorials)],
    ["main-menu-load", "mainMenu.loadGame", actions.loadGame],
    ["main-menu-sound", "menu.sound", () => show(sound)],
  ];
  for (const [id, key, action] of buttons) {
    main.appendChild(menuButton(id, t(key), action));
  }
  // Spec 46 §2: one group of missions per army.
  let faction = "";
  for (const mission of TUTORIALS) {
    if (mission.faction !== faction) {
      faction = mission.faction;
      const heading = document.createElement("h2");
      heading.textContent = t(`faction.${faction}` as MessageKey);
      tutorials.appendChild(heading);
    }
    tutorials.appendChild(
      menuButton(`main-menu-${mission.id}`, t(mission.title), () =>
        actions.tutorial(mission),
      ),
    );
  }
  tutorials.appendChild(
    menuButton("main-menu-back", t("mainMenu.back"), () => show(main)),
  );
  for (const [channel, key] of VOLUME_ROWS) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "100";
    input.id = `main-menu-${channel}`;
    const paint = (value: number): void => {
      label.textContent = t(key, { pct: value });
    };
    input.value = String(actions.getVolume(channel));
    paint(Number(input.value));
    input.addEventListener("input", () => {
      const value = Math.max(0, Math.min(100, Number(input.value) || 0));
      paint(value);
      actions.setVolume(channel, value);
    });
    sound.append(label, input);
  }
  sound.appendChild(
    menuButton("main-menu-sound-back", t("mainMenu.back"), () => show(main)),
  );
  panel.append(main, tutorials, sound, campaigns);
  element.appendChild(panel);
  const open = actions.openCampaign ?? null;
  const target = findCampaignMission(open);
  const ending = CAMPAIGNS.find((c) => open === `${c.faction}-ending`);
  const won = (faction: Campaign["faction"]) => actions.progress.won(faction);
  if (
    target !== null &&
    target.number <= won(target.faction as Campaign["faction"]) + 1
  ) {
    openBriefing(target);
  } else if (
    ending !== undefined &&
    won(ending.faction) >= ending.missions.length
  ) {
    panel.hidden = true;
    briefing.ending(ending);
  }
  return element;
}

/** `#main-menu-campaigns`: one group per army, its aim and its missions in
 *  order; a mission opens once the one before it is won (spec 48 §4). */
function fillCampaigns(
  page: HTMLElement,
  actions: MainMenuActions,
  open: (mission: CampaignMission) => void,
): void {
  page.replaceChildren();
  page.id = "main-menu-campaigns";
  for (const campaign of CAMPAIGNS) {
    const heading = document.createElement("h2");
    heading.textContent = t(`faction.${campaign.faction}` as MessageKey);
    const aim = document.createElement("p");
    aim.className = "main-menu-aim";
    aim.textContent = t(campaign.aim);
    page.append(heading, aim);
    const won = actions.progress.won(campaign.faction);
    for (const mission of campaign.missions) {
      const locked = mission.number > won + 1;
      const mark = mission.number <= won ? "✓ " : locked ? "🔒 " : "";
      const button = menuButton(
        `main-menu-${mission.id}`,
        `${mark}${mission.number}. ${t(mission.title)}`,
        () => open(mission),
      );
      if (locked) {
        (button as HTMLButtonElement).disabled = true;
        button.title = t("campaign.locked");
      }
      page.appendChild(button);
    }
    if (won >= campaign.missions.length) {
      page.appendChild(
        menuButton(
          `main-menu-${campaign.faction}-ending`,
          t("campaign.epilogue"),
          () => window.location.assign(`?campaign=${campaign.faction}-ending`),
        ),
      );
    }
  }
  page.appendChild(
    menuButton("main-menu-campaign-back", t("mainMenu.back"), () =>
      window.location.assign(window.location.pathname),
    ),
  );
}

/** `#campaign-briefing`: the pre-mission screen of spec 48 §4, or the
 *  epilogue of a campaign. */
function createBriefing(
  root: HTMLElement,
  back: () => void,
): {
  hidden: boolean;
  mission(mission: CampaignMission, start: () => void): void;
  ending(campaign: Campaign): void;
} {
  const element = document.createElement("section");
  element.id = "campaign-briefing";
  element.hidden = true;
  root.appendChild(element);
  const section = (title: MessageKey, text: string, className: string) => {
    const heading = document.createElement("h3");
    heading.textContent = t(title);
    const body = document.createElement("p");
    body.className = className;
    body.textContent = text;
    element.append(heading, body);
  };
  const buttons = (rows: [string, MessageKey, () => void][]) => {
    const bar = document.createElement("div");
    bar.className = "campaign-briefing-buttons";
    for (const [id, key, action] of rows) {
      bar.appendChild(menuButton(id, t(key), action));
    }
    element.appendChild(bar);
  };
  const header = (faction: string, title: string, when: string) => {
    const army = document.createElement("p");
    army.className = "campaign-briefing-army";
    army.textContent = t(`faction.${faction}` as MessageKey);
    const heading = document.createElement("h2");
    heading.textContent = title;
    const date = document.createElement("p");
    date.className = "campaign-briefing-when";
    date.textContent = when;
    element.append(army, heading, date);
  };
  return {
    get hidden() {
      return element.hidden === true;
    },
    set hidden(value: boolean) {
      element.hidden = value;
    },
    mission(mission, start) {
      element.replaceChildren();
      const title = t("campaign.missionTitle", {
        number: mission.number,
        title: t(mission.title),
      });
      header(mission.faction, title, t(mission.when));
      section("campaign.video", t(mission.video), "campaign-briefing-video");
      section(
        "campaign.briefing",
        t(mission.briefing),
        "campaign-briefing-text",
      );
      const heading = document.createElement("h3");
      heading.textContent = t("campaign.objectives");
      const list = document.createElement("ol");
      for (const goal of mission.goals) {
        const item = document.createElement("li");
        item.textContent = goalText(goal);
        list.appendChild(item);
      }
      element.append(heading, list);
      buttons([
        ["campaign-briefing-start", "campaign.start", start],
        ["campaign-briefing-back", "mainMenu.back", back],
      ]);
      element.hidden = false;
      element.scrollTop = 0;
    },
    ending(campaign) {
      element.replaceChildren();
      header(campaign.faction, t("campaign.epilogue"), "");
      section("campaign.video", t(campaign.ending), "campaign-briefing-video");
      buttons([["campaign-briefing-back", "mainMenu.back", back]]);
      element.hidden = false;
    },
  };
}
