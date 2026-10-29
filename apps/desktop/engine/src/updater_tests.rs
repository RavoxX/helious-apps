use crate::updater::*;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signer, SigningKey};
use serde_json::json;
#[test]
fn accepts_the_node_release_signer_format_and_exact_newline_bytes() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../tests/fixtures/node-update.json")).unwrap();
    let body = fixture["body"].as_str().unwrap();
    let signature = fixture["signature"].as_str().unwrap();
    let key = fixture["publicKey"].as_str().unwrap();
    assert_eq!(
        verify_manifest(body.as_bytes(), signature, key, "0.8.1")
            .unwrap()
            .version,
        "0.8.2"
    );
    assert!(verify_manifest(body.trim_end().as_bytes(), signature, key, "0.8.1").is_err());
}
fn signed(version: &str) -> (Vec<u8>, String, String) {
    let key = SigningKey::from_bytes(&[7; 32]);
    let asset = |name: &str| json!({"url":format!("https://github.com/{}/releases/download/v{}/Helious_{}_{}",REPOSITORY,version,version,name),"sha256":"a".repeat(64),"size":123});
    let body=serde_json::to_vec(&json!({"schema":1,"version":version,"notes":"Release notes","windows":asset("x64-setup.exe"),"macos":asset("universal.zip")})).unwrap();
    let signature = STANDARD.encode(
        key.sign(&[b"helious-update-v1\n".as_slice(), &body].concat())
            .to_bytes(),
    );
    (
        body,
        signature,
        STANDARD.encode(key.verifying_key().to_bytes()),
    )
}
#[test]
fn verifies_signed_metadata_and_refuses_corruption_wrong_keys_and_downgrades() {
    let (mut body, signature, key) = signed("0.8.2");
    assert_eq!(
        verify_manifest(&body, &signature, &key, "0.8.1")
            .unwrap()
            .version,
        "0.8.2"
    );
    assert!(verify_manifest(&body, &signature, &key, "0.8.2").is_err());
    assert!(verify_manifest(&body, &signature, &key, "0.9.0").is_err());
    assert!(verify_manifest(&body, &signature, &STANDARD.encode([9; 32]), "0.8.1").is_err());
    body.push(b' ');
    assert!(verify_manifest(&body, &signature, &key, "0.8.1").is_err());
}
#[test]
fn refuses_even_signed_assets_outside_the_expected_release_repository() {
    let (body, _, key) = signed("0.8.2");
    let keypair = SigningKey::from_bytes(&[7; 32]);
    let mut value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    value["windows"]["url"] = json!("https://attacker.example/setup.exe");
    let body = serde_json::to_vec(&value).unwrap();
    let signature = STANDARD.encode(
        keypair
            .sign(&[b"helious-update-v1\n".as_slice(), &body].concat())
            .to_bytes(),
    );
    assert!(verify_manifest(&body, &signature, &key, "0.8.1").is_err());
}
