//! Native headless runner: executes the simulation without a client.

mod save;
mod script;
mod tournament;

use std::process::ExitCode;

fn banner() -> String {
    format!("red-line headless (sim api v{})", sim::api_version())
}

fn hash_file(path: &str) -> Result<String, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("invalid script {path}: {e}"))?;
    let hash = if value.get("map").is_some() {
        let parsed: script::MatchScript =
            serde_json::from_value(value).map_err(|e| format!("invalid script {path}: {e}"))?;
        script::run_match_script(&parsed).map_err(|e| format!("cannot run {path}: {e}"))?
    } else {
        let parsed: script::Script =
            serde_json::from_value(value).map_err(|e| format!("invalid script {path}: {e}"))?;
        script::run_script(&parsed).map_err(|e| format!("cannot run {path}: {e:?}"))?
    };
    Ok(format!("{hash:016x}\n"))
}

fn json_line<T: serde::Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value)
        .map(|text| format!("{text}\n"))
        .map_err(|error| format!("cannot serialize report: {error}"))
}

fn dispatch(args: &[String]) -> Result<String, String> {
    let parts: Vec<&str> = args.iter().map(String::as_str).collect();
    match parts.as_slice() {
        [] => Ok(format!("{}\n", banner())),
        ["hash", path] => hash_file(path),
        ["match", map, seed, max_ticks, ai0, ai1] => {
            let seed = seed
                .parse::<u32>()
                .map_err(|_| format!("invalid seed: {seed}"))?;
            let max_ticks = max_ticks
                .parse::<u32>()
                .map_err(|_| format!("invalid max_ticks: {max_ticks}"))?;
            let report = tournament::run_match(map, seed, max_ticks, ai0, ai1)?;
            json_line(&report)
        }
        ["save", "run", path, ticks] => {
            let ticks = ticks
                .parse::<u32>()
                .map_err(|_| format!("invalid ticks: {ticks}"))?;
            json_line(&save::run(path, ticks)?)
        }
        ["tournament", path] => {
            let text =
                std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
            let config: tournament::TournamentConfig =
                serde_json::from_str(&text).map_err(|e| format!("invalid config {path}: {e}"))?;
            let report = tournament::run_tournament(&config)?;
            json_line(&report)
        }
        _ => Err("usage: headless [hash <script.json>] \
             [match <map> <seed> <max_ticks> <ai0> <ai1>] [tournament <config.json>] \
             [save run <file> <ticks>] [save check <file>]"
            .to_owned()),
    }
}

/// `save check` prints its verdict on stdout: "ok" (exit 0) or the first
/// differing pointer (exit 1); errors exit 2 like every subcommand.
fn check_save(path: &str) -> ExitCode {
    match save::check(path) {
        Ok(save::Check::Same) => {
            println!("ok");
            ExitCode::SUCCESS
        }
        Ok(save::Check::Differs(pointer)) => {
            println!("round trip differs at {pointer}");
            ExitCode::from(1)
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let [save, check, path] = args.as_slice()
        && save == "save"
        && check == "check"
    {
        return check_save(path);
    }
    match dispatch(&args) {
        Ok(out) => {
            print!("{out}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::from(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_reports_the_sim_api_version() {
        assert_eq!(banner(), "red-line headless (sim api v4)");
    }
}
