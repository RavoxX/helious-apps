#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod app;
mod graph;
mod screens;
#[cfg(test)]
mod ui_tests;
mod worker;
fn main() -> eframe::Result {
    let icon = image::load_from_memory(include_bytes!("../../assets/icons/128x128.png"))
        .expect("Bundled icon")
        .into_rgba8();
    let options = eframe::NativeOptions {
        viewport: eframe::egui::ViewportBuilder::default()
            .with_title("Helious")
            .with_inner_size([1440.0, 940.0])
            .with_min_inner_size([900.0, 600.0])
            .with_icon(eframe::egui::IconData {
                width: icon.width(),
                height: icon.height(),
                rgba: icon.into_raw(),
            }),
        renderer: eframe::Renderer::Wgpu,
        ..Default::default()
    };
    eframe::run_native(
        "com.helious.desktop",
        options,
        Box::new(|cc| Ok(Box::new(app::HeliousApp::new(cc)))),
    )
}
