const WIDGET_MIN_VISIBLE_WIDTH: i64 = 32;
const WIDGET_MIN_VISIBLE_HEIGHT: i64 = 18;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct PhysicalRect {
    pub x: i64,
    pub y: i64,
    pub width: i64,
    pub height: i64,
}

impl PhysicalRect {
    fn right(self) -> i64 {
        self.x + self.width
    }

    fn bottom(self) -> i64 {
        self.y + self.height
    }

    fn center(self) -> (i64, i64) {
        (self.x + self.width / 2, self.y + self.height / 2)
    }
}

fn visible_intersection(window: PhysicalRect, monitor: PhysicalRect) -> (i64, i64) {
    let width = window.right().min(monitor.right()) - window.x.max(monitor.x);
    let height = window.bottom().min(monitor.bottom()) - window.y.max(monitor.y);
    (width.max(0), height.max(0))
}

pub(crate) fn recover_offscreen_position(
    window: PhysicalRect,
    monitor_work_areas: &[PhysicalRect],
) -> Option<(i32, i32)> {
    let required_width = window.width.min(WIDGET_MIN_VISIBLE_WIDTH);
    let required_height = window.height.min(WIDGET_MIN_VISIBLE_HEIGHT);
    if monitor_work_areas.iter().any(|monitor| {
        let (visible_width, visible_height) = visible_intersection(window, *monitor);
        visible_width >= required_width && visible_height >= required_height
    }) {
        return None;
    }

    let (window_center_x, window_center_y) = window.center();
    let monitor = monitor_work_areas.iter().min_by_key(|monitor| {
        let (monitor_center_x, monitor_center_y) = monitor.center();
        let dx = window_center_x - monitor_center_x;
        let dy = window_center_y - monitor_center_y;
        dx.saturating_mul(dx).saturating_add(dy.saturating_mul(dy))
    })?;

    let maximum_x = (monitor.right() - window.width).max(monitor.x);
    let maximum_y = (monitor.bottom() - window.height).max(monitor.y);
    let x = window.x.clamp(monitor.x, maximum_x);
    let y = window.y.clamp(monitor.y, maximum_y);
    Some((x as i32, y as i32))
}

#[cfg(test)]
mod tests {
    use super::{recover_offscreen_position, PhysicalRect};

    #[test]
    fn widget_position_stays_unchanged_when_enough_of_it_is_visible() {
        let monitor = PhysicalRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let widget = PhysicalRect {
            x: -90,
            y: 500,
            width: 129,
            height: 54,
        };

        assert_eq!(recover_offscreen_position(widget, &[monitor]), None);
    }

    #[test]
    fn widget_position_recovers_after_a_monitor_is_disconnected() {
        let monitor = PhysicalRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let widget = PhysicalRect {
            x: 2400,
            y: 400,
            width: 129,
            height: 54,
        };

        assert_eq!(
            recover_offscreen_position(widget, &[monitor]),
            Some((1791, 400))
        );
    }

    #[test]
    fn widget_position_recovers_when_only_an_unusable_sliver_is_visible() {
        let monitor = PhysicalRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let widget = PhysicalRect {
            x: 1910,
            y: 1035,
            width: 129,
            height: 54,
        };

        assert_eq!(
            recover_offscreen_position(widget, &[monitor]),
            Some((1791, 986))
        );
    }
}
