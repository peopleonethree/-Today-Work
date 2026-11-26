import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const script = fileURLToPath(new URL("./Test-RelayImageText.ps1", import.meta.url));

export async function modalContains(sky, window, expected) {
  const view = await sky.get_window_state({ window, include_text: false, include_screenshot: true });
  // Capture only the separate dialog, never OCR the chat list.
  const modals = view.screenshots.slice(1).filter(image => image.width > 250 && image.height > 120);
  if (modals.length !== 1 || !/^data:image\/(?:png|jpeg);base64,/.test(modals[0].url)) return false;
  const dir = await mkdtemp(join(tmpdir(), "todaytodo-relay-ocr-"));
  try {
    const path = join(dir, "dialog.png");
    await writeFile(path, Buffer.from(modals[0].url.split(",")[1], "base64"));
    const result = await run("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-File", script, "-ImagePath", path, "-Needle", expected,
    ], { windowsHide: true, timeout: 8000 });
    return JSON.parse(result.stdout.trim()).matches === true;
  } finally {
    await rm(dir, { recursive: true });
  }
}
