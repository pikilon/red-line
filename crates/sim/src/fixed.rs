//! Q16.16 fixed-point math. Stubs: behavior is missing on purpose (RED).

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Fx(i32);

impl Fx {
    pub const FRAC_BITS: u32 = 16;
    pub const ZERO: Fx = Fx(0);
    pub const ONE: Fx = Fx(65536);
    pub const HALF: Fx = Fx(32768);
    pub const fn from_raw(raw: i32) -> Fx {
        Fx(raw)
    }
    pub const fn raw(self) -> i32 {
        self.0
    }
    pub const fn from_int(n: i32) -> Fx {
        Fx(n << 16)
    }
    pub const fn floor_to_int(self) -> i32 {
        self.0 >> 16
    }
    pub fn mul(self, _rhs: Fx) -> Fx {
        todo!()
    }
    pub fn div(self, _rhs: Fx) -> Fx {
        todo!()
    }
    pub fn sqrt(self) -> Fx {
        todo!()
    }
}

impl core::ops::Add for Fx {
    type Output = Fx;
    fn add(self, rhs: Fx) -> Fx {
        Fx(self.0 + rhs.0)
    }
}
impl core::ops::Sub for Fx {
    type Output = Fx;
    fn sub(self, rhs: Fx) -> Fx {
        Fx(self.0 - rhs.0)
    }
}
impl core::ops::Neg for Fx {
    type Output = Fx;
    fn neg(self) -> Fx {
        Fx(-self.0)
    }
}

pub fn isqrt_u64(_n: u64) -> u64 {
    todo!()
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct FxVec2 {
    pub x: Fx,
    pub y: Fx,
}

impl FxVec2 {
    pub const ZERO: FxVec2 = FxVec2 {
        x: Fx::ZERO,
        y: Fx::ZERO,
    };
    pub const fn new(x: Fx, y: Fx) -> FxVec2 {
        FxVec2 { x, y }
    }
    pub fn length(self) -> Fx {
        todo!()
    }
    pub fn normalize(self) -> FxVec2 {
        todo!()
    }
    pub fn scale(self, _s: Fx) -> FxVec2 {
        todo!()
    }
}

impl core::ops::Add for FxVec2 {
    type Output = FxVec2;
    fn add(self, rhs: FxVec2) -> FxVec2 {
        FxVec2::new(self.x + rhs.x, self.y + rhs.y)
    }
}
impl core::ops::Sub for FxVec2 {
    type Output = FxVec2;
    fn sub(self, rhs: FxVec2) -> FxVec2 {
        FxVec2::new(self.x - rhs.x, self.y - rhs.y)
    }
}
