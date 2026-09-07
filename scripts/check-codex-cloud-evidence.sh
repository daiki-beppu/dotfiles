#!/usr/bin/env bash
# setup 後の独立シェルでも実行する。外部へのアップロードはしない。
set -euo pipefail
for tool in gh node playwright-cli ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "ERROR: $tool is unavailable" >&2; exit 1; }
done
gh --version
gh pr edit --help | grep -q -- '--attach'
playwright-cli --version
record_dir="$(mktemp -d)"
session="cloud-evidence-$$"
cleanup() {
  playwright-cli -s="$session" close >/dev/null 2>&1 || true
  rm -rf "$record_dir"
}
trap cleanup EXIT
# CLI の snapshot も一時ディレクトリに隔離する。
cd "$record_dir"
cat > "$record_dir/run.mjs" <<EOF_JS
async page => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.setContent('<button>Record</button><p id="result">Ready</p>');
  await page.screencast.start({ path: "$record_dir/evidence.webm", size: { width: 640, height: 480 } });
  await page.getByRole('button', { name: 'Record' }).click();
  await page.locator('#result').evaluate(el => el.textContent = 'Recording verified');
  await page.getByText('Recording verified').waitFor();
  await page.waitForTimeout(1000);
  await page.screencast.stop();
}
EOF_JS
playwright-cli -s="$session" open --config="$HOME/.config/dotfiles/evidence-browser.json"
playwright-cli -s="$session" run-code --filename="$record_dir/run.mjs" > "$record_dir/record.log" 2>&1
cat "$record_dir/record.log"
# CLI がエラー表示だけで exit 0 となる場合も失敗にする。
if grep -qE 'Error|FAILED' "$record_dir/record.log"; then exit 1; fi
test -s "$record_dir/evidence.webm"
ffmpeg -v error -y -i "$record_dir/evidence.webm" -movflags +faststart -pix_fmt yuv420p "$record_dir/evidence.mp4"
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of json "$record_dir/evidence.mp4"
test -s "$record_dir/evidence.mp4"
echo '[check-codex-cloud-evidence] recording and MP4 conversion passed; upload not tested'
