//! Helious Windows design system: tokens, typography, accessible controls and layout primitives.
//! Strictly flat surfaces (near-black dark mode, crisp paper light mode) — zero decorative gradients.
use eframe::egui::{
    self, Color32, CornerRadius, FontId, Margin, Rect, Response, RichText, Sense, Stroke,
    StrokeKind, Ui,
};

pub struct Palette {
    pub surface: Color32,
    pub elevated: Color32,
    pub sidebar: Color32,
    pub card: Color32,
    pub editor_bg: Color32,
    pub line: Color32,
    pub strong_line: Color32,
    pub text: Color32,
    pub muted: Color32,
    pub subtle: Color32,
    pub accent: Color32,
    pub brand: Color32,
    pub selected: Color32,
    pub hover: Color32,
    pub success: Color32,
    pub warn: Color32,
    pub danger: Color32,
}

pub fn palette(dark: bool) -> Palette {
    if dark {
        Palette {
            surface: Color32::from_rgb(13, 14, 17),
            elevated: Color32::from_rgb(18, 20, 24),
            sidebar: Color32::from_rgb(17, 18, 22),
            card: Color32::from_rgb(22, 24, 29),
            editor_bg: Color32::from_rgb(11, 12, 15),
            line: Color32::from_rgb(38, 42, 51),
            strong_line: Color32::from_rgb(64, 70, 84),
            text: Color32::from_rgb(236, 238, 242),
            muted: Color32::from_rgb(150, 157, 170),
            subtle: Color32::from_rgb(108, 115, 128),
            accent: Color32::from_rgb(122, 176, 255),
            brand: Color32::from_rgb(47, 111, 235),
            selected: Color32::from_rgb(27, 43, 72),
            hover: Color32::from_rgb(28, 31, 38),
            success: Color32::from_rgb(63, 185, 80),
            warn: Color32::from_rgb(218, 165, 52),
            danger: Color32::from_rgb(240, 108, 108),
        }
    } else {
        Palette {
            surface: Color32::WHITE,
            elevated: Color32::from_rgb(249, 250, 252),
            sidebar: Color32::from_rgb(245, 247, 250),
            card: Color32::from_rgb(250, 251, 253),
            editor_bg: Color32::WHITE,
            line: Color32::from_rgb(225, 229, 236),
            strong_line: Color32::from_rgb(186, 194, 206),
            text: Color32::from_rgb(24, 28, 35),
            muted: Color32::from_rgb(92, 101, 115),
            subtle: Color32::from_rgb(132, 141, 155),
            accent: Color32::from_rgb(27, 100, 218),
            brand: Color32::from_rgb(27, 100, 218),
            selected: Color32::from_rgb(226, 237, 253),
            hover: Color32::from_rgb(236, 240, 246),
            success: Color32::from_rgb(26, 127, 55),
            warn: Color32::from_rgb(154, 103, 0),
            danger: Color32::from_rgb(196, 43, 43),
        }
    }
}

pub fn style(style: &mut egui::Style) {
    let dark = style.visuals.dark_mode;
    let p = palette(dark);
    let v = &mut style.visuals;
    v.panel_fill = p.surface;
    v.window_fill = p.elevated;
    v.faint_bg_color = p.card;
    v.extreme_bg_color = p.editor_bg;
    v.text_edit_bg_color = Some(p.editor_bg);
    v.hyperlink_color = p.accent;
    v.weak_text_color = Some(p.muted);
    v.override_text_color = Some(p.text);
    v.warn_fg_color = p.warn;
    v.error_fg_color = p.danger;
    v.selection.bg_fill = p.selected;
    v.selection.stroke = Stroke::new(1.5, p.accent);
    v.window_stroke = Stroke::new(1.0, p.line);
    v.window_corner_radius = CornerRadius::same(10);
    v.menu_corner_radius = CornerRadius::same(8);

    let control = if dark {
        Color32::from_rgb(26, 29, 36)
    } else {
        Color32::from_rgb(242, 244, 248)
    };
    for (state, fill) in [
        (&mut v.widgets.inactive, control),
        (&mut v.widgets.hovered, p.hover),
        (&mut v.widgets.active, p.selected),
        (&mut v.widgets.open, p.hover),
    ] {
        state.weak_bg_fill = fill;
        state.bg_fill = fill;
        state.corner_radius = CornerRadius::same(6);
    }
    v.widgets.inactive.bg_stroke = Stroke::new(1.0, p.strong_line);
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, p.accent);
    v.widgets.active.bg_stroke = Stroke::new(1.5, p.accent);
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, p.line);
    v.widgets.noninteractive.corner_radius = CornerRadius::same(6);

    style.spacing.item_spacing = egui::vec2(8.0, 8.0);
    style.spacing.button_padding = egui::vec2(10.0, 6.0);
    style.spacing.interact_size.y = 30.0;
    for (text, size) in [
        (egui::TextStyle::Body, 14.5),
        (egui::TextStyle::Button, 13.5),
        (egui::TextStyle::Heading, 22.0),
        (egui::TextStyle::Small, 12.0),
        (egui::TextStyle::Monospace, 13.5),
    ] {
        style.text_styles.insert(text, FontId::proportional(size));
    }
    style
        .text_styles
        .insert(egui::TextStyle::Monospace, FontId::monospace(13.0));
}

/// Full-width, left-aligned navigation row with a crisp active indicator bar.
pub fn nav_item(ui: &mut Ui, selected: bool, label: &str) -> Response {
    nav_item_indented(ui, selected, label, 0.0, None)
}

/// Indented tree or navigation row with an optional right-aligned count or shortcut hint.
pub fn nav_item_indented(
    ui: &mut Ui,
    selected: bool,
    label: &str,
    indent: f32,
    trailing: Option<&str>,
) -> Response {
    let p = palette(ui.visuals().dark_mode);
    let width = ui.available_width().max(48.0);
    let (rect, response) = ui.allocate_exact_size(egui::vec2(width, 30.0), Sense::click());
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
        painter.rect_filled(rect, 6, fill);
        if selected {
            let bar = Rect::from_min_size(rect.min, egui::vec2(3.0, rect.height()));
            painter.rect_filled(
                bar,
                CornerRadius {
                    nw: 6,
                    sw: 6,
                    ne: 0,
                    se: 0,
                },
                p.accent,
            );
        }
        if response.has_focus() {
            painter.rect_stroke(rect, 6, Stroke::new(1.5, p.accent), StrokeKind::Inside);
        }
        let trailing_width = if let Some(hint) = trailing {
            let hint_galley =
                painter.layout_no_wrap(hint.to_owned(), FontId::proportional(11.5), p.subtle);
            let hw = hint_galley.size().x;
            let hy = rect.center().y - hint_galley.size().y / 2.0;
            painter.galley(
                egui::pos2((rect.right() - hw - 10.0).max(rect.left() + 20.0), hy),
                hint_galley,
                p.subtle,
            );
            hw + 16.0
        } else {
            0.0
        };
        let left_pad = 12.0 + indent;
        let max_text_width = (rect.width() - left_pad - trailing_width - 10.0).max(24.0);
        let mut job = egui::text::LayoutJob::simple_singleline(
            label.to_owned(),
            FontId::proportional(13.5),
            if selected { p.text } else { p.muted },
        );
        job.wrap = egui::text::TextWrapping {
            max_width: max_text_width,
            max_rows: 1,
            break_anywhere: true,
            overflow_character: Some('…'),
        };
        let galley = painter.layout_job(job);
        let y = rect.center().y - galley.size().y / 2.0;
        painter.galley(egui::pos2(rect.left() + left_pad, y), galley, p.text);
    }
    response
}

/// Collapsible folder tree row with a crisp vector chevron and right-aligned note count.
pub fn folder_item(
    ui: &mut Ui,
    collapsed: bool,
    label: &str,
    indent: f32,
    count: &str,
) -> Response {
    let p = palette(ui.visuals().dark_mode);
    let width = ui.available_width().max(48.0);
    let (rect, response) = ui.allocate_exact_size(egui::vec2(width, 28.0), Sense::click());
    response.widget_info(|| {
        egui::WidgetInfo::selected(egui::Role::Button, ui.is_enabled(), !collapsed, label)
    });
    if ui.is_rect_visible(rect) {
        let painter = ui.painter();
        if response.hovered() {
            painter.rect_filled(rect, 6, p.hover);
        }
        if response.has_focus() {
            painter.rect_stroke(rect, 6, Stroke::new(1.5, p.accent), StrokeKind::Inside);
        }
        let cx = rect.left() + 14.0 + indent;
        let cy = rect.center().y;
        let chev_stroke = Stroke::new(1.5, p.muted);
        if collapsed {
            painter.line_segment(
                [egui::pos2(cx - 2.0, cy - 4.0), egui::pos2(cx + 2.5, cy)],
                chev_stroke,
            );
            painter.line_segment(
                [egui::pos2(cx + 2.5, cy), egui::pos2(cx - 2.0, cy + 4.0)],
                chev_stroke,
            );
        } else {
            painter.line_segment(
                [egui::pos2(cx - 4.0, cy - 2.0), egui::pos2(cx, cy + 2.5)],
                chev_stroke,
            );
            painter.line_segment(
                [egui::pos2(cx, cy + 2.5), egui::pos2(cx + 4.0, cy - 2.0)],
                chev_stroke,
            );
        }
        let hint_galley =
            painter.layout_no_wrap(count.to_owned(), FontId::proportional(11.5), p.subtle);
        let hw = hint_galley.size().x;
        painter.galley(
            egui::pos2(
                (rect.right() - hw - 10.0).max(rect.left() + 24.0),
                cy - hint_galley.size().y / 2.0,
            ),
            hint_galley,
            p.subtle,
        );
        let left_pad = 24.0 + indent;
        let max_w = (rect.width() - left_pad - hw - 24.0).max(24.0);
        let mut job = egui::text::LayoutJob::simple_singleline(
            label.to_owned(),
            FontId::proportional(13.0),
            p.text,
        );
        job.wrap = egui::text::TextWrapping {
            max_width: max_w,
            max_rows: 1,
            break_anywhere: true,
            overflow_character: Some('…'),
        };
        let galley = painter.layout_job(job);
        painter.galley(
            egui::pos2(rect.left() + left_pad, cy - galley.size().y / 2.0),
            galley,
            p.text,
        );
    }
    response
}

pub fn section_label(ui: &mut Ui, text: &str) {
    ui.add_space(10.0);
    ui.horizontal(|ui| {
        ui.add_space(10.0);
        ui.label(
            RichText::new(text)
                .size(11.0)
                .strong()
                .color(palette(ui.visuals().dark_mode).subtle),
        );
    });
    ui.add_space(2.0);
}

/// Titled bordered card surface used across Welcome, Account, Sync, Settings and Inspector.
pub fn card<R>(ui: &mut Ui, title: &str, add: impl FnOnce(&mut Ui) -> R) -> R {
    let p = palette(ui.visuals().dark_mode);
    egui::Frame::new()
        .fill(p.card)
        .stroke(Stroke::new(1.0, p.line))
        .corner_radius(8)
        .inner_margin(Margin::same(16))
        .show(ui, |ui| {
            ui.set_width(ui.available_width());
            if !title.is_empty() {
                ui.label(RichText::new(title).size(16.0).strong());
                ui.add_space(4.0);
            }
            add(ui)
        })
        .inner
}

/// Subtle pill badge for Space kind, note status, or tags.
pub fn badge_pill(ui: &mut Ui, text: &str, accent: Color32) {
    let dark = ui.visuals().dark_mode;
    let bg = Color32::from_rgba_unmultiplied(
        accent.r(),
        accent.g(),
        accent.b(),
        if dark { 34 } else { 24 },
    );
    let border = Color32::from_rgba_unmultiplied(
        accent.r(),
        accent.g(),
        accent.b(),
        if dark { 90 } else { 70 },
    );
    egui::Frame::new()
        .fill(bg)
        .stroke(Stroke::new(1.0, border))
        .corner_radius(99)
        .inner_margin(Margin::symmetric(8, 2))
        .show(ui, |ui| {
            ui.label(RichText::new(text).size(11.5).color(accent).strong());
        });
}

/// Keycap shortcut badge (non-interactive visual hint).
pub fn kbd_badge(ui: &mut Ui, keys: &str) {
    let p = palette(ui.visuals().dark_mode);
    egui::Frame::new()
        .fill(p.elevated)
        .stroke(Stroke::new(1.0, p.line))
        .corner_radius(4)
        .inner_margin(Margin::symmetric(6, 2))
        .show(ui, |ui| {
            ui.label(RichText::new(keys).monospace().size(11.0).color(p.muted));
        });
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
    let p = palette(dark);
    egui::Button::new(RichText::new(text.to_owned()).color(p.danger))
        .stroke(Stroke::new(1.0, p.danger.gamma_multiply(0.45)))
}
