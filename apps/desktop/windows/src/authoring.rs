use crate::app::{string, HeliousApp};
use eframe::egui;
use serde_json::{json, Value};
pub struct AuthoringState {
    pub day: String,
    pub space: String,
    pub template: String,
    pub path: String,
    pub property: String,
    pub kind: String,
    pub value: String,
    pub properties: Value,
    pub base: String,
}
impl Default for AuthoringState {
    fn default() -> Self {
        Self {
            day: helious_native::authoring::today(),
            space: String::new(),
            template: String::new(),
            path: String::new(),
            property: String::new(),
            kind: "string".into(),
            value: String::new(),
            properties: json!({}),
            base: String::new(),
        }
    }
}
impl HeliousApp {
    pub fn authoring_tools(&mut self, ui: &mut egui::Ui) {
        egui::CollapsingHeader::new("Daily notes & templates").show(ui,|ui|{
            if self.authoring.space.is_empty(){self.authoring.space=self.spaces.iter().find(|s|s["kind"]=="personal").map(|s|string(s,"id").to_string()).unwrap_or_default();}
            ui.label("Create in Space");
            egui::ComboBox::from_id_salt("authoring-space").selected_text(self.spaces.iter().find(|s|s["id"]==self.authoring.space).map(|s|string(s,"name")).unwrap_or("Choose Space")).show_ui(ui,|ui|{for s in &self.spaces{ui.selectable_value(&mut self.authoring.space,string(s,"id").into(),string(s,"name"));}});
            ui.label("Template");
            egui::ComboBox::from_id_salt("authoring-template").selected_text(self.notes.iter().find(|n|n["id"]==self.authoring.template).map(|n|string(n,"path")).unwrap_or("Built-in blank / daily")).show_ui(ui,|ui|{ui.selectable_value(&mut self.authoring.template,String::new(),"Built-in blank / daily");for n in &self.notes{if n["spaceId"]==self.authoring.space&&string(n,"path").starts_with("Templates/"){ui.selectable_value(&mut self.authoring.template,string(n,"id").into(),string(n,"path"));}}});
            ui.label("Daily note date");ui.add(egui::TextEdit::singleline(&mut self.authoring.day).hint_text("YYYY-MM-DD"));
            if ui.add_enabled(self.pending.is_none(),egui::Button::new("Open daily note")).clicked(){self.authoring_create(true);}
            ui.label("New note from template");ui.add(egui::TextEdit::singleline(&mut self.authoring.path).hint_text("Projects/Meeting.md"));
            if ui.add_enabled(self.pending.is_none()&&!self.authoring.path.trim().is_empty(),egui::Button::new("Create from template")).clicked(){self.authoring_create(false);}
            ui.small("Save a Markdown note in Templates/ to make a template. Variables: {{title}}, {{date}}, {{time}}, {{datetime}}, {{cursor}}.");
        });
    }
    fn authoring_create(&mut self, daily: bool) {
        if self.dirty() {
            self.error = "Save or discard your draft before opening another note.".into();
            return;
        }
        let mut req = self.scope(if daily {
            "open_daily"
        } else {
            "new_from_template"
        });
        req["spaceId"] = json!(self.authoring.space);
        req["day"] = json!(self.authoring.day);
        req["path"] = json!(self.authoring.path);
        req["templateId"] = json!(self.authoring.template);
        self.request("create_note", req);
    }
    pub fn properties_panel(&mut self, ui: &mut egui::Ui) {
        egui::CollapsingHeader::new("Properties").show(ui, |ui| {
            if ui
                .add_enabled(
                    self.pending.is_none(),
                    egui::Button::new("Read current properties"),
                )
                .clicked()
            {
                self.authoring.base = self.markdown.clone();
                self.request(
                    "properties",
                    json!({"operation":"properties","markdown":self.markdown}),
                );
            }
            if let Some(values) = self.authoring.properties.as_object() {
                for (name, value) in values.clone() {
                    if ui.small_button(format!("{name}: {value}")).clicked() {
                        self.authoring.property = name;
                        self.authoring.kind = if value.is_string() {
                            "string"
                        } else if value.is_boolean() {
                            "boolean"
                        } else if value.is_number() {
                            "number"
                        } else if value.is_null() {
                            "null"
                        } else {
                            "json"
                        }
                        .into();
                        self.authoring.value = value
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| value.to_string());
                    }
                }
            }
            ui.horizontal_wrapped(|ui| {
                ui.label("Property name");
                ui.text_edit_singleline(&mut self.authoring.property);
                egui::ComboBox::from_id_salt("property-type")
                    .selected_text(&self.authoring.kind)
                    .show_ui(ui, |ui| {
                        for kind in ["string", "number", "boolean", "json", "null"] {
                            ui.selectable_value(&mut self.authoring.kind, kind.into(), kind);
                        }
                    });
            });
            ui.horizontal_wrapped(|ui| {
                ui.label("Property value");
                ui.text_edit_singleline(&mut self.authoring.value);
                if ui
                    .add_enabled(
                        self.pending.is_none() && !self.authoring.property.trim().is_empty(),
                        egui::Button::new("Apply property to draft"),
                    )
                    .clicked()
                {
                    self.edit_property(false);
                }
                if ui
                    .add_enabled(
                        self.pending.is_none() && !self.authoring.property.trim().is_empty(),
                        egui::Button::new("Remove property"),
                    )
                    .clicked()
                {
                    self.edit_property(true);
                }
            });
            ui.small("Lists and objects use JSON. Changes stay in your draft until Save.");
        });
    }
    fn edit_property(&mut self, remove: bool) {
        let value = match self.authoring.kind.as_str() {
            "string" => Ok(json!(self.authoring.value)),
            "null" => Ok(Value::Null),
            _ => serde_json::from_str::<Value>(&self.authoring.value)
                .map_err(|_| "Use a valid number, boolean or JSON value."),
        };
        match value {
            Ok(value) => {
                if !remove
                    && ((self.authoring.kind == "number" && !value.is_number())
                        || (self.authoring.kind == "boolean" && !value.is_boolean()))
                {
                    self.error = "The value does not match the property type.".into();
                    return;
                }
                self.authoring.base = self.markdown.clone();
                self.request("edit_property",json!({"operation":"edit_property","markdown":self.markdown,"name":self.authoring.property,"value":value,"remove":remove}));
            }
            Err(e) => self.error = e.into(),
        }
    }
}
