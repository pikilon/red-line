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
