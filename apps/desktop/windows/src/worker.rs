use helious_native::{vault::Result, Engine};
use serde_json::Value;
use std::{
    path::PathBuf,
    sync::mpsc::{self, Receiver, Sender},
};
pub struct Worker {
    pub send: Sender<(String, Value)>,
    pub receive: Receiver<(String, Result<Value>)>,
}
impl Worker {
    pub fn new(folder: PathBuf, context: eframe::egui::Context) -> Self {
        let (send, requests) = mpsc::channel::<(String, Value)>();
        let (reply, receive) = mpsc::channel();
        std::thread::spawn(move || {
            let mut engine = Engine::new(folder);
            while let Ok((tag, value)) = requests.recv() {
                let result = match &mut engine {
                    Ok(engine) => engine.execute(value),
                    Err(error) => Err(error.clone()),
                };
                if reply.send((tag, result)).is_err() {
                    break;
                }
                context.request_repaint();
            }
        });
        Self { send, receive }
    }
}
