//! Native headless runner: executes the simulation without a client.

fn banner() -> String {
    format!("red-line headless (sim api v{})", sim::api_version())
}

fn main() {
    println!("{}", banner());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn banner_reports_the_sim_api_version() {
        assert_eq!(banner(), "red-line headless (sim api v1)");
    }
}
