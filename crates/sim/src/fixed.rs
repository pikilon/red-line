//! Q16.16 fixed-point math. Integer only, deterministic.

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Fx(i32);

// The spec fixes inherent `mul`/`div` methods (not the std operator traits).
#[allow(clippy::should_implement_trait)]
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
    pub fn mul(self, rhs: Fx) -> Fx {
        Fx(((i64::from(self.0) * i64::from(rhs.0)) >> 16) as i32)
    }
    pub fn div(self, rhs: Fx) -> Fx {
        Fx(((i64::from(self.0) << 16) / i64::from(rhs.0)) as i32)
    }
    pub fn sqrt(self) -> Fx {
        if self.0 < 0 {
            return Fx::ZERO;
        }
        Fx(isqrt_u64((self.0 as u64) << 16) as i32)
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

/// floor(sqrt(n)), exact for all u64 (bitwise method, no floats).
pub fn isqrt_u64(n: u64) -> u64 {
    let mut rem = n;
    let mut root = 0u64;
    let mut bit = 1u64 << 62;
    while bit > n {
        bit >>= 2;
    }
    while bit != 0 {
        if rem >= root + bit {
            rem -= root + bit;
            root = (root >> 1) + bit;
        } else {
            root >>= 1;
        }
        bit >>= 2;
    }
    root
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
        let x = i64::from(self.x.raw());
        let y = i64::from(self.y.raw());
        Fx::from_raw(isqrt_u64((x * x + y * y) as u64) as i32)
    }
    pub fn normalize(self) -> FxVec2 {
        let len = self.length();
        if len == Fx::ZERO {
            return FxVec2::ZERO;
        }
        FxVec2::new(self.x.div(len), self.y.div(len))
    }
    pub fn scale(self, s: Fx) -> FxVec2 {
        FxVec2::new(self.x.mul(s), self.y.mul(s))
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
