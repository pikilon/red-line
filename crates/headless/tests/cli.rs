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
