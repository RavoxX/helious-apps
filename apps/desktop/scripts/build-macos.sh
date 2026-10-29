#!/usr/bin/env bash
set -euo pipefail
desktop_root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(node -p "JSON.parse(require('fs').readFileSync(process.argv[1])).version" "$desktop_root/package.json")"
public_key="$(tr -d '\r\n' < "$desktop_root/update-public-key.txt")"
bundle="$desktop_root/target/installers"
mkdir -p "$bundle" "$desktop_root/target/macos"
for arch in aarch64 x86_64; do
  cargo build --locked --release --manifest-path "$desktop_root/Cargo.toml" -p helious-native --target "$arch-apple-darwin"
  swift_arch="$arch"
  if [ "$arch" = aarch64 ]; then swift_arch=arm64; fi
  HELIOUS_CORE_LIB="$desktop_root/target/$arch-apple-darwin/release" swift build --package-path "$desktop_root/macos" --configuration release --arch "$swift_arch"
  binary_path="$(HELIOUS_CORE_LIB="$desktop_root/target/$arch-apple-darwin/release" swift build --package-path "$desktop_root/macos" --configuration release --arch "$swift_arch" --show-bin-path)"
  cp "$binary_path/Helious" "$desktop_root/target/macos/Helious-$arch"
done
app="$desktop_root/target/macos/Helious.app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources" "$app/Contents/Frameworks"
lipo -create "$desktop_root/target/macos/Helious-aarch64" "$desktop_root/target/macos/Helious-x86_64" -output "$app/Contents/MacOS/Helious"
sparkle="$(find "$desktop_root/macos/.build/artifacts" -type d -name Sparkle.framework | head -n 1)"
if [ -z "$sparkle" ]; then echo 'Sparkle framework missing from SwiftPM artifacts' >&2; exit 1; fi
ditto "$sparkle" "$app/Contents/Frameworks/Sparkle.framework"
cp "$desktop_root/assets/icons/icon.icns" "$app/Contents/Resources/Helious.icns"
node "$desktop_root/scripts/notices.mjs" aarch64-apple-darwin
cp "$desktop_root/target/THIRD-PARTY-NOTICES.txt" "$app/Contents/Resources/THIRD-PARTY-NOTICES.txt"
cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.helious.desktop</string>
<key>CFBundleName</key><string>Helious</string>
<key>CFBundleDisplayName</key><string>Helious</string>
<key>CFBundleExecutable</key><string>Helious</string>
<key>CFBundleIconFile</key><string>Helious.icns</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>$version</string>
<key>CFBundleVersion</key><string>$version</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>SUPublicEDKey</key><string>$public_key</string>
<key>SUFeedURL</key><string>https://github.com/RavoxX/helious-apps/releases/latest/download/appcast.xml</string>
<key>SUEnableAutomaticChecks</key><true/>
<key>SUAutomaticallyUpdate</key><false/>
<key>SUVerifyUpdateBeforeExtraction</key><true/>
</dict></plist>
EOF
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
ditto -c -k --sequesterRsrc --keepParent "$app" "$bundle/Helious_${version}_universal.zip"
dmg_source="$desktop_root/target/macos/dmg-content"
mkdir -p "$dmg_source"
ditto "$app" "$dmg_source/Helious.app"
ln -sfn /Applications "$dmg_source/Applications"
hdiutil create -volname Helious -srcfolder "$dmg_source" -ov -format UDZO "$bundle/Helious_${version}_universal.dmg"
