use std::path::PathBuf;
use std::process::{Command, Output};

fn run(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_headless"))
        .args(args)
        .output()
        .expect("headless binary runs")
}

fn fixture() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../sim/tests/fixtures/tech-slice-script.json");
    path.to_str().expect("utf-8 path").to_owned()
}

fn match_fixture() -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../sim/tests/fixtures/skirmish-script.json");
    path.to_str().expect("utf-8 path").to_owned()
}

fn is_hash_line(text: &str) -> bool {
    text.len() == 17
        && text.ends_with('\n')
        && text[..16]
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[test]
fn ac_02_23_hash_cli() {
    let path = fixture();
    let first = run(&["hash", &path]);
    let second = run(&["hash", &path]);
    assert_eq!(first.status.code(), Some(0));
    assert_eq!(second.status.code(), Some(0));
    let first_out = String::from_utf8(first.stdout).expect("utf-8 stdout");
    let second_out = String::from_utf8(second.stdout).expect("utf-8 stdout");
    assert!(is_hash_line(&first_out), "unexpected output: {first_out:?}");
    assert_eq!(first_out, second_out);

    let missing = run(&["hash", "does-not-exist.json"]);
    assert_eq!(missing.status.code(), Some(2));
    assert!(!missing.stderr.is_empty());
}

#[test]
fn ac_03_40_match_script_cli() {
    let path = match_fixture();
    let first = run(&["hash", &path]);
    let second = run(&["hash", &path]);
    assert_eq!(first.status.code(), Some(0));
    assert_eq!(second.status.code(), Some(0));
    let first_out = String::from_utf8(first.stdout).expect("utf-8 stdout");
    let second_out = String::from_utf8(second.stdout).expect("utf-8 stdout");
    assert!(is_hash_line(&first_out), "unexpected output: {first_out:?}");
    assert_eq!(first_out, second_out);

    // The Phase 1 fixture still prints its hash (unchanged CLI behaviour).
    let legacy = fixture();
    let legacy_out = run(&["hash", &legacy]);
    assert_eq!(legacy_out.status.code(), Some(0));
    let legacy_text = String::from_utf8(legacy_out.stdout).expect("utf-8 stdout");
    assert!(
        is_hash_line(&legacy_text),
        "unexpected output: {legacy_text:?}"
    );
}

fn is_hash(text: &str) -> bool {
    text.len() == 16
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[test]
fn ac_05_18_match_subcommand() {
    let output = run(&[
        "match",
        "first-line",
        "1",
        "27000",
        "ukraine-balanced",
        "none",
    ]);
    assert_eq!(
        output.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).expect("utf-8 stdout");
    let value: serde_json::Value =
        serde_json::from_str(text.trim()).expect("match prints one JSON object");
    assert_eq!(value["winner"], serde_json::json!(0));
    let ticks = value["ticks"].as_u64().expect("ticks is a number");
    assert!(ticks < 27000, "ticks: {ticks}");
    assert_eq!(value["lost"].as_array().map(Vec::len), Some(2));
    let hash = value["hash"].as_str().expect("hash is a string");
    assert!(is_hash(hash), "unexpected hash: {hash:?}");

    let unknown = run(&["match", "first-line", "1", "27000", "bogus-ai", "none"]);
    assert_eq!(unknown.status.code(), Some(2));
    assert!(!unknown.stderr.is_empty());
}

#[test]
fn ac_05_19_tournament_subcommand() {
    let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"));
    std::fs::create_dir_all(&dir).expect("target tmp dir");
    let config = dir.join("ac-05-19-tournament.json");
    std::fs::write(
        &config,
        r#"{"map":"first-line","maxTicks":27000,"seeds":[1],"ai0":["ukraine-rush"],"ai1":["russia-rush"]}"#,
    )
    .expect("config written");
    let output = run(&["tournament", config.to_str().expect("utf-8 path")]);
    assert_eq!(
        output.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).expect("utf-8 stdout");
    let value: serde_json::Value =
        serde_json::from_str(text.trim()).expect("tournament prints one JSON object");
    let matches = value["matches"].as_array().expect("matches array");
    assert_eq!(matches.len(), 1);
    let summary = value["summary"].as_array().expect("summary array");
    assert_eq!(summary.len(), 1);
    assert_eq!(summary[0]["games"], serde_json::json!(1));
    let wins0 = summary[0]["wins0"].as_u64().expect("wins0");
    let wins1 = summary[0]["wins1"].as_u64().expect("wins1");
    let draws = summary[0]["draws"].as_u64().expect("draws");
    assert_eq!(wins0 + wins1 + draws, 1);
}

// AC-19-08: `headless save run` and `headless save check` (spec 19 §6.1).

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("redline-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

/// A world-form save of a first-line skirmish with an AI, 120 ticks in.
fn world_save() -> (serde_json::Value, sim::world::World, Vec<sim::ai::Ai>) {
    let mut world =
        sim::world::World::skirmish(sim::rules::Ruleset::builtin(), "first-line", 1).unwrap();
    let mut ais = vec![sim::ai::Ai::new(&world, 1, "russia-balanced", 1).unwrap()];
    for _ in 0..120 {
        sim::ai::step_with_ai(&mut world, &mut ais);
    }
    let state = sim::save::save_state(&world, 1, &ais).unwrap();
    let file = serde_json::json!({
        "format": "redline-save", "version": 1, "name": "cli", "savedAt": "2026-10-15T10:00:00.000Z",
        "tick": world.tick(),
        "match": { "mapId": "first-line", "seed": "1", "debug": false, "speed": 1 },
        "client": { "controlled": 0, "revealed": false, "gore": true, "generatedTextures": true,
                    "fpsPanel": false, "camera": { "x": 14, "y": 62, "zoom": 1 },
                    "cameraMemory": {}, "selected": [] },
        "world": state,
    });
    (file, world, ais)
}

#[test]
fn ac_19_08_save_commands() {
    let dir = temp_dir("ac-19-08");
    let (file, mut world, mut ais) = world_save();
    let world_path = dir.join("world.json");
    std::fs::write(&world_path, file.to_string()).unwrap();
    let setup_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../data/generated/saves/armor-duel.json");

    // `save run` prints one JSON line; its hash equals the native run.
    let output = run(&["save", "run", world_path.to_str().unwrap(), "900"]);
    assert_eq!(
        output.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert_eq!(text.lines().count(), 1, "one line: {text}");
    let report: serde_json::Value = serde_json::from_str(text.trim()).unwrap();
    for _ in 0..900 {
        sim::ai::step_with_ai(&mut world, &mut ais);
    }
    assert_eq!(report["tick"], serde_json::json!(world.tick()));
    assert_eq!(report["outcome"], serde_json::json!("ongoing"));
    assert_eq!(
        report["hash"],
        serde_json::json!(format!("{:016x}", sim::hash::state_hash(&world)))
    );
    let players = report["players"].as_array().expect("players");
    assert_eq!(players.len(), 2);
    for (id, player) in players.iter().enumerate() {
        assert_eq!(player["id"], serde_json::json!(id));
        assert_eq!(
            player["credits"],
            serde_json::json!(world.players()[id].credits)
        );
        assert!(player["units"].is_u64() && player["buildings"].is_u64());
        assert_eq!(player["power"].as_array().map(Vec::len), Some(2));
    }

    let setup = run(&["save", "run", setup_path.to_str().unwrap(), "300"]);
    assert_eq!(setup.status.code(), Some(0));
    let setup_report: serde_json::Value =
        serde_json::from_str(String::from_utf8(setup.stdout).unwrap().trim()).unwrap();
    assert_eq!(setup_report["tick"], serde_json::json!(300));
    assert!(is_hash(setup_report["hash"].as_str().unwrap()));

    // `save check` accepts both forms.
    for path in [&world_path, &setup_path] {
        let check = run(&["save", "check", path.to_str().unwrap()]);
        assert_eq!(check.status.code(), Some(0), "{}", path.display());
        assert_eq!(String::from_utf8(check.stdout).unwrap(), "ok\n");
    }

    // A world whose explored runs are not canonical does not survive a load.
    let mut odd = file.clone();
    odd["world"]["players"][0]["explored"] = serde_json::json!([128 * 128, 0]);
    let odd_path = dir.join("odd.json");
    std::fs::write(&odd_path, odd.to_string()).unwrap();
    let check = run(&["save", "check", odd_path.to_str().unwrap()]);
    assert_eq!(check.status.code(), Some(1));
    assert_eq!(
        String::from_utf8(check.stdout).unwrap(),
        "round trip differs at /players/0/explored\n"
    );

    // Errors go to stderr with exit code 2, like the other subcommands.
    let missing = run(&["save", "run", "does-not-exist.json", "10"]);
    assert_eq!(missing.status.code(), Some(2));
    assert!(!missing.stderr.is_empty());
    std::fs::remove_dir_all(dir).ok();
}
