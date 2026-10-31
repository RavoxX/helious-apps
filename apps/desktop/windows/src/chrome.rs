//! Shared look of the Windows shell: palette, egui style and a few reusable widgets.
use eframe::egui::{
    self, Color32, CornerRadius, FontId, Margin, Rect, Response, RichText, Sense, Stroke,
    StrokeKind, Ui,
};

/// Colours shared with the browser workspace so both apps read as one product.
pub struct Palette {
    pub surface: Color32,
    pub sidebar: Color32,
    pub card: Color32,
    pub line: Color32,
    pub text: Color32,
    pub muted: Color32,
    pub accent: Color32,
    pub brand: Color32,
    pub selected: Color32,
    pub hover: Color32,
    pub danger: Color32,
}

pub fn palette(dark: bool) -> Palette {
    if dark {
        Palette {
            surface: Color32::from_rgb(16, 16, 16),
            sidebar: Color32::from_rgb(22, 22, 22),
            card: Color32::from_rgb(24, 24, 24),
            line: Color32::from_gray(48),
            text: Color32::from_gray(232),
            muted: Color32::from_gray(164),
            accent: Color32::from_rgb(138, 184, 245),
            brand: Color32::from_rgb(52, 108, 232),
            selected: Color32::from_rgb(31, 45, 70),
            hover: Color32::from_gray(32),
            danger: Color32::from_rgb(235, 125, 125),
        }
    } else {
        Palette {
            surface: Color32::WHITE,
            sidebar: Color32::from_rgb(247, 249, 251),
            card: Color32::from_rgb(250, 251, 252),
            line: Color32::from_rgb(224, 228, 234),
            text: Color32::from_rgb(28, 33, 41),
            muted: Color32::from_rgb(98, 107, 120),
            accent: Color32::from_rgb(31, 99, 214),
            brand: Color32::from_rgb(31, 99, 214),
            selected: Color32::from_rgb(224, 235, 252),
            hover: Color32::from_rgb(237, 240, 244),
            danger: Color32::from_rgb(190, 50, 50),
        }
    }
}

pub fn style(style: &mut egui::Style) {
    let dark = style.visuals.dark_mode;
    let p = palette(dark);
    let v = &mut style.visuals;
    v.panel_fill = p.surface;
    v.window_fill = p.surface;
    v.faint_bg_color = p.card;
    v.extreme_bg_color = if dark {
        Color32::from_rgb(10, 10, 10)
    } else {
        Color32::WHITE
    };
    v.text_edit_bg_color = Some(v.extreme_bg_color);
    v.hyperlink_color = p.accent;
    v.weak_text_color = Some(p.muted);
    v.override_text_color = Some(p.text);
    v.selection.bg_fill = p.selected;
    v.selection.stroke = Stroke::new(1.5, p.accent);
    v.window_stroke = Stroke::new(1.0, p.line);
    v.window_corner_radius = CornerRadius::same(10);
    v.menu_corner_radius = CornerRadius::same(8);
    let control = if dark {
        Color32::from_gray(30)
    } else {
        Color32::from_rgb(242, 244, 247)
    };
    for (state, fill) in [
        (&mut v.widgets.inactive, control),
        (&mut v.widgets.hovered, p.hover),
        (&mut v.widgets.active, p.selected),
        (&mut v.widgets.open, p.hover),
    ] {
        state.weak_bg_fill = fill;
        state.bg_fill = fill;
        state.corner_radius = CornerRadius::same(7);
    }
    // Controls need a stronger outline than dividers so empty checkboxes stay visible.
    let control_line = if dark {
        Color32::from_gray(70)
    } else {
        Color32::from_rgb(190, 197, 207)
    };
    v.widgets.inactive.bg_stroke = Stroke::new(1.0, control_line);
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, p.accent);
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, p.line);
    v.widgets.noninteractive.corner_radius = CornerRadius::same(7);
    style.spacing.item_spacing = egui::vec2(10.0, 10.0);
    style.spacing.button_padding = egui::vec2(12.0, 7.0);
    style.spacing.interact_size.y = 32.0;
    for (text, size) in [
        (egui::TextStyle::Body, 15.0),
        (egui::TextStyle::Button, 14.0),
        (egui::TextStyle::Heading, 24.0),
        (egui::TextStyle::Small, 12.0),
    ] {
        style.text_styles.insert(text, FontId::proportional(size));
    }
}

/// Full-width, left-aligned navigation row with a clear selected marker.
pub fn nav_item(ui: &mut Ui, selected: bool, label: &str) -> Response {
    let p = palette(ui.visuals().dark_mode);
    let (rect, response) =
        ui.allocate_exact_size(egui::vec2(ui.available_width(), 34.0), Sense::click());
    response.widget_info(|| {
        egui::WidgetInfo::selected(egui::Role::Button, ui.is_enabled(), selected, label)
    });
    if ui.is_rect_visible(rect) {
        let fill = if selected {
            p.selected
        } else if response.hovered() {
            p.hover
        } else {
            Color32::TRANSPARENT
        };
        let painter = ui.painter();
        painter.rect_filled(rect, 7, fill);
        if selected {
            let bar = Rect::from_min_size(rect.min, egui::vec2(3.0, rect.height()));
            painter.rect_filled(
                bar,
                CornerRadius {
                    nw: 7,
                    sw: 7,
                    ne: 0,
                    se: 0,
                },
                p.accent,
            );
        }
        if response.has_focus() {
            painter.rect_stroke(rect, 7, Stroke::new(1.5, p.accent), StrokeKind::Inside);
        }
        let mut job = egui::text::LayoutJob::simple_singleline(
            label.to_owned(),
            FontId::proportional(14.0),
            if selected { p.text } else { p.muted },
        );
        job.wrap = egui::text::TextWrapping {
            max_width: rect.width() - 26.0,
            max_rows: 1,
            break_anywhere: true,
            overflow_character: Some('…'),
        };
        let galley = painter.layout_job(job);
        let y = rect.center().y - galley.size().y / 2.0;
        painter.galley(egui::pos2(rect.left() + 14.0, y), galley, p.text);
    }
    response
}

pub fn section_label(ui: &mut Ui, text: &str) {
    ui.add_space(14.0);
    ui.horizontal(|ui| {
        ui.add_space(12.0);
        ui.label(
            RichText::new(text)
                .size(11.0)
                .strong()
                .color(palette(ui.visuals().dark_mode).muted),
        );
    });
    ui.add_space(2.0);
}

/// A titled, bordered section used on Account, Sync and Settings.
pub fn card<R>(ui: &mut Ui, title: &str, add: impl FnOnce(&mut Ui) -> R) -> R {
    let p = palette(ui.visuals().dark_mode);
    egui::Frame::new()
        .fill(p.card)
        .stroke(Stroke::new(1.0, p.line))
        .corner_radius(10)
        .inner_margin(Margin::same(18))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            ui.label(RichText::new(title).size(17.0).strong());
            ui.add_space(4.0);
            add(ui)
        })
        .inner
}

pub fn primary_button(text: &str, dark: bool) -> egui::Button<'static> {
    egui::Button::new(
        RichText::new(text.to_owned())
            .color(Color32::WHITE)
            .strong(),
    )
    .fill(palette(dark).brand)
    .stroke(Stroke::NONE)
}

pub fn danger_button(text: &str, dark: bool) -> egui::Button<'static> {
    egui::Button::new(RichText::new(text.to_owned()).color(palette(dark).danger))
}
