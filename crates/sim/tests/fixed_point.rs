use sim::fixed::{Fx, FxVec2, isqrt_u64};

#[test]
fn ac_02_01_fixed_arithmetic_rounding() {
    assert_eq!(Fx::from_int(3).mul(Fx::HALF).raw(), 98304);
    assert_eq!(Fx::from_raw(-1).mul(Fx::HALF).raw(), -1);
    assert_eq!(Fx::from_int(1).div(Fx::from_int(3)).raw(), 21845);
    assert_eq!(Fx::from_int(-1).div(Fx::from_int(3)).raw(), -21845);
    assert_eq!(Fx::from_raw(-98304).floor_to_int(), -2);
    assert_eq!((Fx::from_int(2) + Fx::HALF).raw(), 163840);
}

#[test]
fn ac_02_02_square_root() {
    assert_eq!(Fx::from_int(4).sqrt(), Fx::from_int(2));
    assert_eq!(Fx::from_int(2).sqrt().raw(), 92681);
    assert_eq!(Fx::from_int(-1).sqrt(), Fx::ZERO);
    assert_eq!(isqrt_u64(u64::MAX), 4294967295);
    assert_eq!(isqrt_u64(15), 3);
    assert_eq!(isqrt_u64(16), 4);
}

#[test]
fn ac_02_03_vector_length_and_normalize() {
    let v = FxVec2::new(Fx::from_int(3), Fx::from_int(4));
    assert_eq!(v.length(), Fx::from_int(5));
    let n = v.normalize();
    assert_eq!((n.x.raw(), n.y.raw()), (39321, 52428));
    assert_eq!(FxVec2::ZERO.normalize(), FxVec2::ZERO);
    let big = FxVec2::new(Fx::from_int(100), Fx::from_int(100));
    assert_eq!(big.length().raw(), 9268190);
}
