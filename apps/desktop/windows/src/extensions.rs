use crate::app::{string, HeliousApp};
use eframe::egui;
use helious_native::extensions::{Installed, Manifest};
use serde_json::json;

#[derive(Default)]
pub struct ExtensionState {
    pub installed: Vec<Installed>,
    pub input: String,
    pub candidate: Option<Manifest>,
    pub consent: bool,
    pub selected: String,
    pub proposal: Option<(String, String, String)>,
}

impl HeliousApp {
    pub fn extension_manager(&mut self, ui: &mut egui::Ui) {
        ui.label("API 1 runs bounded data-only commands, with no scripts, network, filesystem or secret access. Installation grants access to the editor draft on this device. Commands only propose edits; apply and save separately.");
        if ui
            .add_enabled(
                self.pending.is_none(),
                egui::Button::new("Refresh extensions"),
            )
            .clicked()
        {
            self.request("extensions", json!({"operation":"extensions"}));
        }
        for record in self.extensions.installed.clone() {
            ui.horizontal(|ui| {
                let mut enabled = record.enabled;
                if ui
                    .add_enabled(
                        self.pending.is_none(),
                        egui::Checkbox::new(
                            &mut enabled,
                            format!("{} · {}", record.manifest.name, record.manifest.version),
                        ),
                    )
                    .changed()
                {
                    self.request(
                        "extensions",
                        json!({"operation":"enable_extension","id":record.manifest.id,"enabled":enabled}),
                    );
                }
                if ui
                    .add_enabled(
                        self.pending.is_none(),
                        egui::Button::new(format!("Remove {}", record.manifest.name)),
                    )
                    .clicked()
                {
                    self.extensions.proposal = None;
                    self.request(
                        "extensions",
                        json!({"operation":"remove_extension","id":record.manifest.id}),
                    );
                }
            });
        }
        let manifest_lbl = ui.label("Extension manifest (JSON)");
        if ui
            .add(
                egui::TextEdit::multiline(&mut self.extensions.input)
                    .hint_text("Paste an API 1 extension JSON manifest…")
                    .desired_width(f32::INFINITY)
                    .desired_rows(7)
                    .char_limit(65536),
            )
            .labelled_by(manifest_lbl.id)
            .changed()
        {
            self.extensions.candidate = None;
            self.extensions.consent = false;
        }
        ui.horizontal(|ui| {
            if ui.button("Use example manifest").clicked() {
                self.extensions.input = helious_native::extensions::EXAMPLE.into();
                self.extensions.candidate = None;
                self.extensions.consent = false;
            }
            if ui.button("Review extension permissions").clicked() {
                let candidate = serde_json::from_str(&self.extensions.input)
                    .map_err(|_| "Invalid JSON manifest.".to_string())
                    .and_then(helious_native::extensions::validate);
                self.extensions.consent = false;
                match candidate {
                    Ok(manifest) => self.extensions.candidate = Some(manifest),
                    Err(error) => {
                        self.error = error;
                        self.extensions.candidate = None;
                    }
                }
            }
        });
        if let Some(manifest) = self.extensions.candidate.clone() {
            ui.strong(format!("{} · {}", manifest.name, manifest.version));
            for permission in &manifest.permissions {
                ui.label(if permission == "editor:write" {
                    "• Propose changes to the current editor draft"
                } else {
                    "• Read the current editor draft"
                });
            }
            ui.checkbox(
                &mut self.extensions.consent,
                "I grant these editor permissions on this device.",
            );
            if ui
                .add_enabled(
                    self.extensions.consent && self.pending.is_none(),
                    egui::Button::new("Install reviewed extension"),
                )
                .clicked()
            {
                self.request(
                    "extensions",
                    json!({"operation":"install_extension","manifest":manifest,"consent":true}),
                );
                self.extensions.candidate = None;
                self.extensions.consent = false;
                self.extensions.input.clear();
            }
        }
    }

    pub fn extension_commands_body(&mut self, ui: &mut egui::Ui) {
        ui.strong("Declarative draft commands");
        let commands: Vec<_> = self
            .extensions
            .installed
            .iter()
            .filter(|e| e.enabled)
            .flat_map(|e| {
                e.manifest
                    .commands
                    .iter()
                    .map(move |c| (e.clone(), c.clone(), format!("{}/{}", e.manifest.id, c.id)))
            })
            .collect();
        egui::ComboBox::from_id_salt("extension-command")
            .width(ui.available_width())
            .selected_text(
                commands
                    .iter()
                    .find(|(_, _, id)| id == &self.extensions.selected)
                    .map(|(e, c, _)| format!("{} · {}", e.manifest.name, c.name))
                    .unwrap_or_else(|| "Choose a command".into()),
            )
            .show_ui(ui, |ui| {
                for (record, command, id) in &commands {
                    ui.selectable_value(
                        &mut self.extensions.selected,
                        id.clone(),
                        format!("{} · {}", record.manifest.name, command.name),
                    );
                }
            });
        if ui.button("Preview command").clicked() {
            if let Some((record, command, _)) = commands
                .iter()
                .find(|(_, _, id)| id == &self.extensions.selected)
            {
                match helious_native::extensions::run_now(
                    &record.manifest,
                    &command.id,
                    &record.granted,
                    &self.markdown,
                    string(&self.note, "path"),
                ) {
                    Ok(result) => {
                        self.message = string(&result, "message").into();
                        self.extensions.proposal = Some((
                            string(&self.note, "id").into(),
                            self.markdown.clone(),
                            string(&result, "markdown").into(),
                        ));
                    }
                    Err(error) => self.error = error,
                }
            } else {
                self.error = "Install and enable an extension in Settings first.".into();
            }
        }
        if let Some((id, base, mut proposed)) = self.extensions.proposal.clone() {
            if proposed != base {
                let prop_lbl = ui.label("Proposed Markdown");
                ui.add(
                    egui::TextEdit::multiline(&mut proposed)
                        .hint_text("Proposed Markdown preview")
                        .desired_width(f32::INFINITY)
                        .desired_rows(6)
                        .interactive(false),
                )
                .labelled_by(prop_lbl.id);
                let current = id == string(&self.note, "id") && base == self.markdown;
                if ui
                    .add_enabled(current, egui::Button::new("Apply proposal to draft"))
                    .clicked()
                {
                    self.markdown = proposed;
                    self.extensions.proposal = None;
                    self.message = "Proposal applied. Save explicitly to keep it.".into();
                }
                if !current {
                    ui.weak("Your draft changed. Preview the command again.");
                }
            }
        }
        ui.small("Install, grant permissions, disable or remove extensions in Settings.");
    }
}
