//! AC-03-10: footprint geometry and navigation-grid helpers.

use sim::fixed::FxVec2;
use sim::map::{Cell, MapGrid};
use sim::nav::{approach_cell, exit_cell, footprint_cells, footprint_center, footprint_distance};
use sim::rules::fx_centi;

#[test]
fn ac_03_10_footprint_geometry() {
    // footprint_center((10, 10), [3, 2]) == raw (753664, 720896).
    let center = footprint_center(Cell { x: 10, y: 10 }, [3, 2]);
    assert_eq!(center.x.raw(), 753664);
    assert_eq!(center.y.raw(), 720896);

    // footprint_distance((9.5, 6.5), (10, 6), [2, 2]) == raw 32768.
    let distance = |point: (u32, u32), origin: Cell, fp: [u16; 2]| {
        footprint_distance(
            FxVec2::new(fx_centi(point.0), fx_centi(point.1)),
            origin,
            fp,
        )
    };
    assert_eq!(
        distance((950, 650), Cell { x: 10, y: 6 }, [2, 2]).raw(),
        32768
    );
    // at (13.0, 9.0) raw 92681; at (11.0, 7.0) 0.
    assert_eq!(
        distance((1300, 900), Cell { x: 10, y: 6 }, [2, 2]).raw(),
        92681
    );
    assert_eq!(distance((1100, 700), Cell { x: 10, y: 6 }, [2, 2]).raw(), 0);

    // footprint_cells((4, 4), [2, 2]) == (4,4),(5,4),(4,5),(5,5).
    assert_eq!(
        footprint_cells(Cell { x: 4, y: 4 }, [2, 2]),
        [
            Cell { x: 4, y: 4 },
            Cell { x: 5, y: 4 },
            Cell { x: 4, y: 5 },
            Cell { x: 5, y: 5 },
        ]
    );

    // MapGrid open(16, 16) cells x4..=5, y4..=5 blocked.
    let nav = {
        let mut grid = MapGrid::open(16, 16);
        for y in 4..=5 {
            for x in 4..=5 {
                grid.set_blocked(Cell { x, y }, true);
            }
        }
        grid
    };
    assert_eq!(
        approach_cell(&nav, Cell { x: 4, y: 4 }, [2, 2]),
        Some(Cell { x: 6, y: 4 })
    );
    assert_eq!(
        exit_cell(&nav, Cell { x: 4, y: 4 }, [2, 2]),
        Some(Cell { x: 5, y: 6 })
    );

    // open(32, 32) cells x10..=12, y10..=11 blocked.
    let nav = {
        let mut grid = MapGrid::open(32, 32);
        for y in 10..=11 {
            for x in 10..=12 {
                grid.set_blocked(Cell { x, y }, true);
            }
        }
        grid
    };
    assert_eq!(
        approach_cell(&nav, Cell { x: 10, y: 10 }, [3, 2]),
        Some(Cell { x: 10, y: 12 })
    );
}
