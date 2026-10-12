//! AC-11-01: fixed-point angles (spec 11 section 3).

use sim::angle::{Angle, TURN, atan2, deg_per_second_to_step, deg_to_units};
use sim::fixed::Fx;

fn fx(n: i32) -> Fx {
    Fx::from_int(n)
}

#[test]
fn ac_11_01_fixed_point_angles() {
    for a in (0..TURN).step_by(64) {
        let d = Angle(a as u16).dir();
        let back = atan2(d.x, d.y);
        let err = Angle(a as u16).delta(back).abs();
        assert!(err <= 8, "angle {a}: round trip {} off by {err}", back.0);
    }

    assert_eq!(atan2(fx(0), fx(1)), Angle(0));
    assert_eq!(atan2(fx(1), fx(0)), Angle(16384));
    assert_eq!(atan2(fx(0), fx(-1)), Angle(32768));
    assert_eq!(atan2(fx(-1), fx(0)), Angle(49152));
    assert_eq!(atan2(fx(0), fx(0)), Angle(0));

    assert_eq!(Angle(65000).delta(Angle(100)), 636);

    // Snap when the remaining difference is within one step.
    assert_eq!(Angle(0).turn_towards(Angle(100), 100), Angle(100));
    assert_eq!(Angle(0).turn_towards(Angle(100), 40), Angle(40));
    assert_eq!(Angle(0).turn_towards(Angle(65500), 10), Angle(65526));
    assert_eq!(Angle(0).turn_towards(Angle(12345), 0), Angle(12345));

    assert_eq!(deg_per_second_to_step(220), 2669);
    assert_eq!(deg_per_second_to_step(1), 12);
    assert_eq!(deg_per_second_to_step(0), 0);
    assert_eq!(deg_to_units(45), 8192);
}
