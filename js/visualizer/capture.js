// Pictures and videos of the stage, to send to a director or keep with the
// paperwork. Both go to the Downloads folder.
//
//   📷 Picture   the 3D view as it is now, full quality (beams, haze, bloom)
//   ⏺ Record     the 3D view until Stop, as a video (MP4 where it can, so
//                it plays in QuickTime and on phones). Each frame is copied
//                to a canvas of its own as it's drawn (the 3D canvas isn't
//                kept between frames, so it can't be recorded directly).
export function createCapture({ renderer, renderNow, mainRect, keepDrawing, say }) {
  const stamp = () => {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
  };
  const save = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // Drawn and read in the same moment (the canvas isn't kept between frames).
  function picture() {
    renderNow();
    const source = renderer.domElement, m = mainRect(), pr = renderer.getPixelRatio();
    const out = document.createElement("canvas");
    out.width = Math.round(m.w * pr); out.height = Math.round(m.h * pr);
    out.getContext("2d").drawImage(source, Math.round(m.x * pr), Math.round(m.y * pr), out.width, out.height, 0, 0, out.width, out.height);
    const name = `Light Spark ${stamp()}.png`;
    out.toBlob(blob => { if (!blob) { say("Couldn't take the picture"); return; } save(blob, name); say(`${name} saved to your Downloads folder`); }, "image/png");
    return name;
  }

  let recorder = null, chunks = [], started = 0, timer = null, tape = null, track = null, frames = 0;
  // Called after every frame the visualiser draws.
  function afterRender() {
    if (!recorder || !tape) return;
    const m = mainRect(), pr = renderer.getPixelRatio();
    const w = Math.round(m.w * pr) & ~1, h = Math.round(m.h * pr) & ~1;
    tape.getContext("2d").drawImage(renderer.domElement, Math.round(m.x * pr), Math.round(m.y * pr), w, h, 0, 0, tape.width, tape.height);
    frames++;
    // Each drawn frame goes into the video as it's drawn, however fast or
    // slow the visualiser is running.
    track?.requestFrame?.();
  }
  const TYPES = ["video/mp4;codecs=avc1.640028", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  function start() {
    if (recorder) return;
    const type = TYPES.find(t => window.MediaRecorder?.isTypeSupported?.(t));
    if (!type) { say("This computer can't record video here"); return; }
    const m = mainRect(), pr = renderer.getPixelRatio();
    tape = document.createElement("canvas");
    tape.width = Math.round(m.w * pr) & ~1; tape.height = Math.round(m.h * pr) & ~1; // even sizes for the encoder
    // In the page and on screen (shown tiny and all but invisible): a canvas
    // that isn't, or is far off screen, gives the recorder no frames.
    tape.style.cssText = "position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:1";
    document.body.appendChild(tape);
    renderNow();
    afterRender();
    const stream = tape.captureStream(0);
    track = stream.getVideoTracks()[0];
    recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 12_000_000 });
    chunks = [];
    recorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const ext = type.startsWith("video/mp4") ? "mp4" : "webm";
      const name = `Light Spark ${stamp()}.${ext}`;
      save(new Blob(chunks, { type: type.split(";")[0] }), name);
      say(`${name} saved to your Downloads folder`);
      chunks = [];
    };
    keepDrawing(true);
    recorder.start(1000);
    started = performance.now();
    show();
    timer = setInterval(show, 500);
  }
  function stop() {
    if (!recorder) return;
    clearInterval(timer); timer = null;
    recorder.stop();
    recorder = null;
    tape?.remove();
    tape = null;
    track = null;
    keepDrawing(false);
    show();
  }
  function show() {
    const b = document.getElementById("recordButton");
    if (!b) return;
    const s = Math.floor((performance.now() - started) / 1000);
    b.textContent = recorder ? `⏹ Stop ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "⏺ Record";
    b.classList.toggle("recording", Boolean(recorder));
  }

  document.getElementById("pictureButton")?.addEventListener("click", picture);
  document.getElementById("recordButton")?.addEventListener("click", () => (recorder ? stop() : start()));
  return { picture, start, stop, afterRender, recording: () => Boolean(recorder), stats: () => ({ frames, chunks: chunks.length, bytes: chunks.reduce((n, c) => n + c.size, 0), state: recorder?.state }) };
}
