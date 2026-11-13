"use strict";

const { execFile } = require("node:child_process");
const { promises: fs } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);

async function checkBin(bin) {
  try {
    await execFileAsync(bin, ["-version"], { timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

function parseMultipart(buffer, contentType) {
  const m = /boundary=([^\s;]+)/i.exec(contentType || "");
  if (!m) return null;
  const boundary = m[1].replace(/^"|"$/g, "");
  const sep = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(sep);
  while (start !== -1) {
    const next = buffer.indexOf(sep, start + sep.length);
    if (next === -1) break;
    const chunk = buffer.subarray(start + sep.length + 2, next - 2);
    const headerEnd = chunk.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerStr = chunk.subarray(0, headerEnd).toString("utf8");
      const body = chunk.subarray(headerEnd + 4);
      const nameM = /name="([^"]+)"/i.exec(headerStr);
      const fileM = /filename="([^"]*)"/i.exec(headerStr);
      if (nameM) {
        parts.push({
          name: nameM[1],
          filename: fileM ? fileM[1] : undefined,
          data: body,
        });
      }
    }
    start = next;
  }
  return parts;
}

async function handleSidecarRoute(req, res, { readBody, sendJson, corsHeaders }) {
  const pathname = new URL(req.url || "/", "http://127.0.0.1").pathname;
  if (!["/health", "/probe", "/cut", "/frames", "/compose"].includes(pathname)) {
    return false;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders);
    res.end();
    return true;
  }

  if (pathname === "/health" && req.method === "GET") {
    const [ffmpeg, ffprobe] = await Promise.all([checkBin("ffmpeg"), checkBin("ffprobe")]);
    sendJson(res, 200, { ok: true, ffmpeg, ffprobe });
    return true;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hemosi-sidecar-"));
  try {
    const raw = await readBody(req);
    const parts = parseMultipart(raw, req.headers["content-type"]);

    if (pathname === "/probe" && req.method === "POST") {
      const filePart = parts?.find((p) => p.filename);
      if (!filePart) {
        sendJson(res, 400, { error: "缺少媒体文件" });
        return true;
      }
      const inPath = path.join(tmpDir, "input.mp4");
      await fs.writeFile(inPath, filePart.data);
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", inPath,
      ]);
      sendJson(res, 200, JSON.parse(stdout));
      return true;
    }

    if (pathname === "/cut" && req.method === "POST") {
      const filePart = parts?.find((p) => p.filename);
      if (!filePart) {
        sendJson(res, 400, { error: "缺少视频文件" });
        return true;
      }
      const inPath = path.join(tmpDir, "input.mp4");
      await fs.writeFile(inPath, filePart.data);
      const { stderr } = await execFileAsync("ffmpeg", [
        "-i", inPath,
        "-filter:v", "select='gt(scene,0.3)',showinfo",
        "-f", "null", "-",
      ]);
      const times = [0];
      const regex = /pts_time:([0-9.]+)/g;
      let match;
      while ((match = regex.exec(stderr)) !== null) {
        const t = Number(Number(match[1]).toFixed(2));
        if (t - times[times.length - 1] >= 0.8) times.push(t);
      }
      sendJson(res, 200, { cuts: times });
      return true;
    }

    if (pathname === "/frames" && req.method === "POST") {
      const filePart = parts?.find((p) => p.filename);
      const timesPart = parts?.find((p) => p.name === "times");
      if (!filePart) {
        sendJson(res, 400, { error: "缺少视频文件" });
        return true;
      }
      const inPath = path.join(tmpDir, "input.mp4");
      await fs.writeFile(inPath, filePart.data);
      const times = timesPart ? JSON.parse(timesPart.data.toString("utf8")) : [0];
      const frames = [];
      for (let i = 0; i < Math.min(times.length, 24); i++) {
        const outPath = path.join(tmpDir, `frame_${i}.jpg`);
        await execFileAsync("ffmpeg", [
          "-y", "-ss", String(times[i]), "-i", inPath, "-frames:v", "1", "-q:v", "4", outPath,
        ]);
        const buf = await fs.readFile(outPath);
        frames.push({ time: times[i], dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}` });
      }
      sendJson(res, 200, { frames });
      return true;
    }

    if (pathname === "/compose" && req.method === "POST") {
      const manifestPart = parts?.find((p) => p.name === "manifest");
      if (!manifestPart) {
        sendJson(res, 400, { error: "缺少 manifest" });
        return true;
      }
      const manifest = JSON.parse(manifestPart.data.toString("utf8"));
      const clipFiles = [];
      for (const item of manifest) {
        const vPart = parts.find((p) => p.name === `video_${item.index}`);
        if (!vPart) continue;
        const vPath = path.join(tmpDir, `v_${item.index}.mp4`);
        await fs.writeFile(vPath, vPart.data);
        const aPart = parts.find((p) => p.name === `audio_${item.index}`);
        if (aPart) {
          const aPath = path.join(tmpDir, `a_${item.index}.wav`);
          const mergedPath = path.join(tmpDir, `m_${item.index}.mp4`);
          await fs.writeFile(aPath, aPart.data);
          await execFileAsync("ffmpeg", [
            "-y", "-i", vPath, "-i", aPath,
            "-c:v", "copy", "-c:a", "aac", "-shortest", mergedPath,
          ]);
          clipFiles.push(mergedPath);
        } else {
          clipFiles.push(vPath);
        }
      }
      if (clipFiles.length === 0) {
        sendJson(res, 400, { error: "没有可合成的视频片段" });
        return true;
      }
      const listPath = path.join(tmpDir, "concat.txt");
      await fs.writeFile(listPath, clipFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
      const outPath = path.join(tmpDir, "output.mp4");
      await execFileAsync("ffmpeg", [
        "-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath,
      ]);
      const outBuf = await fs.readFile(outPath);
      res.writeHead(200, { ...corsHeaders, "content-type": "video/mp4", "content-length": outBuf.length });
      res.end(outBuf);
      return true;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    return true;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { handleSidecarRoute };
