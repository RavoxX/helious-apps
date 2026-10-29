use crate::vault::Result;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{io::Write, path::PathBuf};
pub const REPOSITORY: &str = "RavoxX/helious-apps";
pub const PUBLIC_KEY: &str = include_str!("../../update-public-key.txt");
const VERSION: &str = env!("CARGO_PKG_VERSION");
const LIMIT: u64 = 300 * 1024 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Asset {
    pub url: String,
    pub sha256: String,
    pub size: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema: u8,
    pub version: String,
    pub notes: String,
    pub windows: Asset,
    pub macos: Asset,
}
pub struct PreparedUpdate {
    pub folder: tempfile::TempDir,
    pub installer: PathBuf,
    pub manifest: Manifest,
}
fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("Helious-Updater/0.8.1")
        .timeout(std::time::Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 5 {
                return attempt.error("Too many update redirects");
            }
            let host = attempt.url().host_str().unwrap_or("");
            if attempt.url().scheme() != "https"
                || !(host == "github.com"
                    || host == "api.github.com"
                    || host.ends_with(".githubusercontent.com"))
            {
                attempt.error("Untrusted update redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| "Cannot initialize the update client.".into())
}
async fn bounded(client: &reqwest::Client, url: &str, max: usize) -> Result<Vec<u8>> {
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|_| "Cannot reach GitHub updates. Check your connection and try again.")?;
    if !response.status().is_success() {
        return Err(format!(
            "GitHub update request failed ({}).",
            response.status().as_u16()
        ));
    }
    if response.content_length().is_some_and(|n| n > max as u64) {
        return Err("Update metadata is too large.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Update download was interrupted.")?
    {
        if bytes.len() + chunk.len() > max {
            return Err("Update metadata exceeded its limit.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
pub fn verify_manifest(
    bytes: &[u8],
    signature: &str,
    public_key: &str,
    current: &str,
) -> Result<Manifest> {
    let key: [u8; 32] = STANDARD
        .decode(public_key.trim())
        .map_err(|_| "Invalid embedded update key.")?
        .try_into()
        .map_err(|_| "Invalid embedded update key length.")?;
    let signature = Signature::from_slice(
        &STANDARD
            .decode(signature.trim())
            .map_err(|_| "Invalid update signature encoding.")?,
    )
    .map_err(|_| "Invalid update signature.")?;
    let payload = [b"helious-update-v1\n".as_slice(), bytes].concat();
    VerifyingKey::from_bytes(&key)
        .map_err(|_| "Invalid update verification key.")?
        .verify(&payload, &signature)
        .map_err(|_| "Update signature verification failed. Nothing was installed.")?;
    let manifest: Manifest =
        serde_json::from_slice(bytes).map_err(|_| "Invalid update manifest.")?;
    let version =
        semver::Version::parse(&manifest.version).map_err(|_| "Invalid update version.")?;
    if manifest.schema != 1
        || version <= semver::Version::parse(current).map_err(|_| "Invalid installed version.")?
        || !version.build.is_empty()
    {
        return Err("This update is not newer than the installed version.".into());
    }
    for (asset, name) in [
        (
            &manifest.windows,
            format!("Helious_{}_x64-setup.exe", version),
        ),
        (
            &manifest.macos,
            format!("Helious_{}_universal.zip", version),
        ),
    ] {
        let expected = format!(
            "https://github.com/{}/releases/download/v{}/{}",
            REPOSITORY, version, name
        );
        if asset.url != expected
            || asset.sha256.len() != 64
            || !asset.sha256.bytes().all(|b| b.is_ascii_hexdigit())
            || asset.size == 0
            || asset.size > LIMIT
        {
            return Err("Update asset is outside the expected repository or limits.".into());
        }
    }
    Ok(manifest)
}
async fn discover() -> Result<Option<Manifest>> {
    let client = client()?;
    let bytes = bounded(
        &client,
        &format!(
            "https://api.github.com/repos/{}/releases?per_page=30",
            REPOSITORY
        ),
        1024 * 1024,
    )
    .await?;
    let releases: Vec<Value> =
        serde_json::from_slice(&bytes).map_err(|_| "Invalid GitHub release response.")?;
    let current = semver::Version::parse(VERSION).map_err(|_| "Invalid installed version.")?;
    let mut candidates: Vec<_> = releases
        .iter()
        .filter(|r| r["draft"] != true)
        .filter_map(|r| {
            let tag = r["tag_name"].as_str()?;
            let version = semver::Version::parse(tag.strip_prefix('v')?).ok()?;
            if version <= current || (!current.pre.is_empty() && version.major < current.major) {
                return None;
            }
            if current.major > 0 && r["prerelease"] == true {
                return None;
            }
            let assets = r["assets"].as_array()?;
            if !["update.json", "update.json.sig"]
                .iter()
                .all(|name| assets.iter().any(|a| a["name"] == *name))
            {
                return None;
            }
            Some((version, tag.to_string()))
        })
        .collect();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    let Some((_, tag)) = candidates.first() else {
        return Ok(None);
    };
    let base = format!(
        "https://github.com/{}/releases/download/{}",
        REPOSITORY, tag
    );
    let metadata = bounded(&client, &format!("{}/update.json", base), 65536).await?;
    let signature = bounded(&client, &format!("{}/update.json.sig", base), 1024).await?;
    let manifest = verify_manifest(
        &metadata,
        std::str::from_utf8(&signature).map_err(|_| "Invalid update signature.")?,
        PUBLIC_KEY,
        VERSION,
    )?;
    if format!("v{}", manifest.version) != *tag {
        return Err("Signed update version does not match its release.".into());
    }
    Ok(Some(manifest))
}
pub async fn check() -> Result<Value> {
    Ok(match discover().await? {
        Some(manifest) => {
            json!({"available":true,"version":manifest.version,"notes":manifest.notes})
        }
        None => json!({"available":false,"version":VERSION}),
    })
}
pub async fn prepare() -> Result<PreparedUpdate> {
    let manifest = discover()
        .await?
        .ok_or("No newer signed update is available.")?;
    let client = client()?;
    let folder = tempfile::Builder::new()
        .prefix("helious-update-")
        .tempdir()
        .map_err(|_| "Cannot create update download folder.")?;
    let installer = folder.path().join("Helious-setup.exe");
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&installer)
        .map_err(|_| "Cannot stage the update.")?;
    let mut response = client
        .get(&manifest.windows.url)
        .send()
        .await
        .map_err(|_| "Cannot download the update.")?;
    if !response.status().is_success() {
        return Err("GitHub refused the installer download.".into());
    }
    let mut hash = Sha256::new();
    let mut length = 0u64;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Installer download was interrupted.")?
    {
        length += chunk.len() as u64;
        if length > manifest.windows.size || length > LIMIT {
            return Err("Installer exceeded its signed size.".into());
        }
        hash.update(&chunk);
        file.write_all(&chunk)
            .map_err(|_| "Cannot save downloaded update.")?;
    }
    file.sync_all()
        .map_err(|_| "Cannot flush the downloaded update.")?;
    drop(file);
    if length != manifest.windows.size
        || format!("{:x}", hash.finalize()) != manifest.windows.sha256
    {
        return Err("Installer checksum verification failed. Nothing was installed.".into());
    }
    Ok(PreparedUpdate {
        folder,
        installer,
        manifest,
    })
}
#[cfg(windows)]
pub fn install(prepared: PreparedUpdate) -> Result<()> {
    use std::os::windows::process::CommandExt;
    let bytes = std::fs::read(&prepared.installer)
        .map_err(|_| "Verified installer is no longer available.")?;
    if crate::vault::hash(&bytes) != prepared.manifest.windows.sha256 {
        return Err("Installer changed after verification. Nothing was installed.".into());
    }
    let path = prepared.installer.to_string_lossy().replace('\'', "''");
    let folder = prepared.folder.path().to_string_lossy().replace('\'', "''");
    let script=format!("$ErrorActionPreference='Stop'; Wait-Process -Id {} -ErrorAction SilentlyContinue; $p=Start-Process -FilePath '{}' -ArgumentList '/S' -PassThru -Wait; if($p.ExitCode -eq 0){{$dir=(Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Helious').InstallLocation; Start-Process -FilePath (Join-Path $dir 'Helious.exe')}}; Remove-Item -LiteralPath '{}'; Remove-Item -LiteralPath '{}'",std::process::id(),path,path,folder);
    std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|_| "Cannot start the verified installer.")?;
    let _ = prepared.folder.keep();
    Ok(())
}
#[cfg(not(windows))]
pub fn install(_: PreparedUpdate) -> Result<()> {
    Err("macOS updates are installed by Sparkle.".into())
}
