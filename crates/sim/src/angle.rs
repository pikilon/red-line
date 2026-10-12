//! Fixed-point binary angles and integer trigonometry (spec 11 section 3).

use crate::fixed::{Fx, FxVec2};

/// Binary angle: 65536 units per turn, wrapping.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Angle(pub u16);

pub const TURN: i32 = 65536;

impl Angle {
    pub fn delta(self, _to: Angle) -> i32 {
        unimplemented!("spec 11 section 3")
    }
    pub fn turn_towards(self, _to: Angle, _step: i32) -> Angle {
        unimplemented!("spec 11 section 3")
    }
    pub fn dir(self) -> FxVec2 {
        unimplemented!("spec 11 section 3")
    }
}

pub fn atan2(_dx: Fx, _dy: Fx) -> Angle {
    unimplemented!("spec 11 section 3")
}

pub fn deg_per_second_to_step(_deg: u32) -> i32 {
    unimplemented!("spec 11 section 3")
}

pub fn deg_to_units(_deg: u32) -> i32 {
    unimplemented!("spec 11 section 3")
}
