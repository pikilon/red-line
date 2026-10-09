//! Native headless runner: executes the simulation without a client.

mod script;

use std::process::ExitCode;

fn banner() -> String {
    format!("red-line headless (sim api v{})", sim::api_version())
}

fn hash_file(path: &str) -> Result<String, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("cannot read {path}: {e}"))?;
    let parsed: script::Script =
        serde_json::from_str(&text).map_err(|e| format!("invalid script {path}: {e}"))?;
    let hash = script::run_script(&parsed).map_err(|e| format!("cannot run {path}: {e:?}"))?;
    Ok(format!("{hash:016x}\n"))
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let result = match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        [] => Ok(format!("{}\n", banner())),
        ["hash", path] => hash_file(path),
        _ => Err("usage: headless [hash <script.json>]".to_owned()),
    };
    match result {
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
        assert_eq!(banner(), "red-line headless (sim api v2)");
    }
}
