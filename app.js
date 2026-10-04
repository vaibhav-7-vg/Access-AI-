/* AccessAI - main application */
const $ = id => document.getElementById(id);
const cfg = window.APP_CONFIG || {};
const synth = window.speechSynthesis;
let recognition = null;
let listening = false;
let timerId = null;
let newsTimerId = null;
let newsArticles = [];
let newsIndex = 0;
let cameraStream = null;
let mlModel = null;
let detectTimer = null;
let lastSpokenObjects = "";
let detectedObjects = [];

const storageKey = "accessai_contacts";

function speak(text, opts = {}) {
  if (!text) return;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.lang = $("language").value || "en-IN";
  u.rate = Number($("rate").value || .9);
  u.pitch = 1;
  u.volume = 1;
  if (opts.append) u.onend = opts.append;
  synth.speak(u);
  $("response").textContent = text;
}

function stopAll() {
  synth.cancel();
  if (timerId) clearTimeout(timerId);
  if (newsTimerId) clearTimeout(newsTimerId);
  timerId = null;
  newsTimerId = null;
  $("status").textContent = "Ready";
}

function setStatus(text) {
  $("status").textContent = text;
}

function getContacts() {
  try { return JSON.parse(localStorage.getItem(storageKey) || "[]"); }
  catch { return []; }
}

function saveContacts(list) {
  localStorage.setItem(storageKey, JSON.stringify(list));
  renderContacts();
}

function normalizePhone(phone) {
  let p = String(phone).replace(/[^\d+]/g, "");
  if (p.startsWith("0")) p = "+91" + p.slice(1);
  if (!p.startsWith("+")) p = "+91" + p;
  return p;
}

function renderContacts() {
  const list = getContacts();
  $("contactsList").innerHTML = list.length ? list.map((c, i) => `
    <div class="contact">
      <div class="contactInfo">
        <div class="contactName">${escapeHtml(c.name)}</div>
        <div class="contactPhone">${escapeHtml(c.phone)}</div>
      </div>
      <div class="contactActions">
        <button data-call="${i}" aria-label="Call ${escapeHtml(c.name)}"><svg viewBox="0 0 24 24"><path d="M7 4l3 3-2 2a13 13 0 0 0 7 7l2-2 3 3-2 2c-1.2 1.2-3.2 1.3-4.6.7A17 17 0 0 1 4.3 7.6C3.7 6.2 3.8 4.2 5 3z"/></svg></button>
        <button data-wa="${i}" aria-label="WhatsApp ${escapeHtml(c.name)}"><svg viewBox="0 0 24 24"><path d="M20 11.5a8 8 0 0 1-11.8 7L4 20l1.5-4A8 8 0 1 1 20 11.5Z"/><path d="M9 9.2c.5 1.6 1.5 2.7 3.2 3.4l1.1-.8c.3-.2.6-.2.9 0l1.2.6"/></svg></button>
        <button data-del="${i}" aria-label="Delete ${escapeHtml(c.name)}"><svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V4h6v3M8 10v7M12 10v7M16 10v7M6 7l1 14h10l1-14"/></svg></button>
      </div>
    </div>`).join("") : `<div class="contactPhone">No contacts saved yet.</div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[ch]));
}

$("contactForm").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("contactName").value.trim();
  const phone = normalizePhone($("contactPhone").value.trim());
  const list = getContacts();
  list.push({ name, phone });
  saveContacts(list);
  $("contactName").value = "";
  $("contactPhone").value = "";
  speak(`${name} was saved as a contact.`);
});

$("contactsList").addEventListener("click", e => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const list = getContacts();
  if (btn.dataset.call !== undefined) callContact(list[Number(btn.dataset.call)]);
  if (btn.dataset.wa !== undefined) openWhatsApp(list[Number(btn.dataset.wa)]);
  if (btn.dataset.del !== undefined) {
    const c = list.splice(Number(btn.dataset.del), 1)[0];
    saveContacts(list);
    speak(`${c.name} was deleted.`);
  }
});

function callContact(c) {
  if (!c) return;
  speak(`Calling ${c.name}.`);
  setTimeout(() => { window.location.href = `tel:${c.phone}`; }, 500);
}

function openWhatsApp(c, message = "") {
  if (!c) return;
  const url = `https://wa.me/${c.phone.replace("+","")}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
  speak(`Opening WhatsApp for ${c.name}.`);
  setTimeout(() => window.open(url, "_blank"), 500);
}

async function getPosition() {
  if (!navigator.geolocation) throw new Error("Location is not supported on this device.");
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true, timeout: 12000, maximumAge: 0
    });
  });
}

async function locationCommand() {
  try {
    setStatus("Getting your current location…");
    const pos = await getPosition();
    const { latitude, longitude } = pos.coords;
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`;
    const r = await fetch(url);
    const data = await r.json();
    const parts = [data.locality, data.city, data.principalSubdivision, data.countryName].filter(Boolean);
    const place = [...new Set(parts)].join(", ");
    const text = place
      ? `Your current location is ${place}.`
      : `Your coordinates are latitude ${latitude.toFixed(5)}, longitude ${longitude.toFixed(5)}.`;
    setStatus("Ready");
    speak(text);
  } catch (err) {
    setStatus("Ready");
    speak("I could not get your location. Please allow location permission and try again.");
  }
}

function dateCommand() {
  const now = new Date();
  speak(`Today is ${now.toLocaleDateString("en-IN", { weekday:"long", day:"numeric", month:"long", year:"numeric" })}.`);
}
function timeCommand() {
  speak(`The current time is ${new Date().toLocaleTimeString("en-IN", { hour:"numeric", minute:"2-digit" })}.`);
}

async function weatherCommand() {
  try {
    setStatus("Checking weather…");
    const pos = await getPosition();
    const { latitude, longitude } = pos.coords;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto`;
    const r = await fetch(url);
    const d = await r.json();
    const c = d.current;
    const desc = weatherDescription(c.weather_code);
    speak(`Current weather: ${desc}. Temperature ${Math.round(c.temperature_2m)} degrees Celsius. Feels like ${Math.round(c.apparent_temperature)} degrees. Humidity ${c.relative_humidity_2m} percent. Wind speed ${Math.round(c.wind_speed_10m)} kilometers per hour.`);
    setStatus("Ready");
  } catch {
    setStatus("Ready");
    speak("I could not get the weather. Please allow location permission and try again.");
  }
}
function weatherDescription(code) {
  const map = {
    0:"clear sky",1:"mainly clear",2:"partly cloudy",3:"overcast",
    45:"foggy",48:"foggy",51:"light drizzle",53:"drizzle",55:"heavy drizzle",
    61:"light rain",63:"rain",65:"heavy rain",71:"light snow",73:"snow",75:"heavy snow",
    80:"light rain showers",81:"rain showers",82:"heavy rain showers",
    95:"thunderstorm",96:"thunderstorm with hail",99:"thunderstorm with heavy hail"
  };
  return map[code] || "unknown conditions";
}

async function fetchNews(category = "general") {
  if (!cfg.NEWS_API_KEY) {
    speak("Live news is not configured yet. Add your NewsAPI key in config.js.");
    return [];
  }
  const url = `https://newsapi.org/v2/top-headlines?country=${encodeURIComponent(cfg.NEWS_COUNTRY || "in")}&category=${encodeURIComponent(category)}&pageSize=10`;
  const r = await fetch(url, { headers: { "X-Api-Key": cfg.NEWS_API_KEY } });
  const d = await r.json();
  if (!r.ok || d.status !== "ok") throw new Error(d.message || "News request failed");
  return (d.articles || []).filter(a => a.title && a.title !== "[Removed]");
}

async function newsCommand(category = "general", minutes = 0) {
  try {
    setStatus("Loading latest news…");
    newsArticles = await fetchNews(category);
    newsIndex = 0;
    setStatus("Ready");
    if (!newsArticles.length) { speak("I could not find current headlines."); return; }

    const intro = `Here are the latest ${category} news headlines.`;
    speak(intro);
    speakNewsUntil(minutes > 0 ? minutes : 1);
  } catch (err) {
    setStatus("Ready");
    speak(`I could not load the latest news. ${err.message || "Please check your internet connection."}`);
  }
}

function speakNewsUntil(minutes) {
  const end = Date.now() + minutes * 60000;
  if (newsTimerId) clearTimeout(newsTimerId);
  const next = () => {
    if (Date.now() >= end || newsIndex >= newsArticles.length) {
      newsTimerId = null;
      speak("News playback finished.");
      return;
    }
    const a = newsArticles[newsIndex++];
    const source = a.source?.name ? ` from ${a.source.name}` : "";
    const text = `${a.title}${source}.`;
    speak(text, { append: () => {
      newsTimerId = setTimeout(next, 700);
    }});
  };
  next();
}

function parseMinutes(text) {
  const m = text.match(/(\d+)\s*(?:minute|minutes|min)/i);
  return m ? Number(m[1]) : 0;
}

function findContact(nameText) {
  const list = getContacts();
  const q = nameText.toLowerCase().trim();
  return list.find(c => q.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(q));
}

function calculatorCommand(text) {
  let expr = text
    .toLowerCase()
    .replace(/what is|calculate|calculator|compute|please|equals?/g, "")
    .replace(/plus/g, "+").replace(/minus/g, "-")
    .replace(/times|multiplied by/g, "*")
    .replace(/divided by|divide by/g, "/")
    .replace(/[^0-9+\-*/().%\s]/g, "").trim();
  if (!expr || !/^[0-9+\-*/().%\s]+$/.test(expr)) {
    speak("Please say a simple calculation, for example, twenty five plus ten.");
    return;
  }
  try {
    // Safe after strict character filtering.
    const result = Function(`"use strict"; return (${expr})`)();
    if (!Number.isFinite(result)) throw new Error();
    speak(`The answer is ${result}.`);
  } catch { speak("I could not calculate that."); }
}

function sendWhatsAppCommand(text) {
  const lower = text.toLowerCase();
  const marker = lower.match(/(?:send|message)\s+(?:a\s+)?(?:whatsapp\s+)?message\s+to\s+(.+?)(?:\s+saying\s+|\s+that\s+|\s*:\s*)(.+)$/i);
  if (!marker) {
    speak("Say: send WhatsApp message to Rahul saying I will reach in ten minutes.");
    return;
  }
  const contact = findContact(marker[1]);
  if (!contact) { speak(`I could not find ${marker[1]} in your saved contacts.`); return; }
  openWhatsApp(contact, marker[2]);
}

function openObjectScanner() {
  $("scannerPanel").classList.remove("hidden");
  $("scannerPanel").scrollIntoView({ behavior:"smooth" });
  startScanner();
}

async function startScanner() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $("mlStatus").textContent = "Camera access is not supported in this browser.";
    speak("Camera access is not supported in this browser.");
    return;
  }
  try {
    $("mlStatus").textContent = "Opening camera…";
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal:"environment" } }, audio:false });
    $("camera").srcObject = cameraStream;
    await $("camera").play();
    $("mlStatus").textContent = "Loading real ML object detection model…";
    if (!mlModel) mlModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
    $("mlStatus").textContent = "ML scanner is ready.";
    runDetection();
  } catch (e) {
    $("mlStatus").textContent = "Camera/model could not start. Allow camera permission and use HTTPS.";
    speak("I could not start the object scanner. Please allow camera permission.");
  }
}

function runDetection() {
  if (detectTimer) clearTimeout(detectTimer);
  const video = $("camera");
  if (!mlModel || video.readyState < 2) {
    detectTimer = setTimeout(runDetection, 700);
    return;
  }
  mlModel.detect(video, 8, 0.55).then(preds => {
    detectedObjects = preds;
    drawPredictions(preds);
    const names = [...new Set(preds.map(p => `${p.class} (${Math.round(p.score*100)} percent confidence)`))];
    $("objects").textContent = names.length ? `Detected: ${names.join(", ")}` : "No known object detected.";
    if (names.length) {
      const simple = [...new Set(preds.map(p => p.class))].join(", ");
      if (simple !== lastSpokenObjects) {
        lastSpokenObjects = simple;
        speak(`I can see ${simple}.`);
      }
    }
    detectTimer = setTimeout(runDetection, 1600);
  }).catch(() => detectTimer = setTimeout(runDetection, 1800));
}

function drawPredictions(preds) {
  const video = $("camera"), canvas = $("overlay");
  if (!video.videoWidth) return;
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.lineWidth = 3; ctx.font = "18px sans-serif";
  preds.forEach(p => {
    const [x,y,w,h] = p.bbox;
    ctx.strokeRect(x,y,w,h);
    const label = `${p.class} ${Math.round(p.score*100)}%`;
    const tw = ctx.measureText(label).width + 12;
    ctx.fillRect(x, Math.max(0,y-25), tw, 25);
    ctx.fillStyle = "#fff"; ctx.fillText(label, x+6, Math.max(18,y-7));
    ctx.strokeStyle = "#55d6ff"; ctx.fillStyle = "#55d6ff";
  });
}

function closeScanner() {
  if (detectTimer) clearTimeout(detectTimer);
  detectTimer = null;
  if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
  cameraStream = null;
  $("camera").srcObject = null;
  $("scannerPanel").classList.add("hidden");
}

function setupSpeechRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    setStatus("Voice recognition unavailable");
    $("speakBtn").disabled = true;
    speak("Voice recognition is not supported in this browser. Use a recent Chrome browser on Android.");
    return;
  }
  recognition = new SR();
  recognition.lang = $("language").value;
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    listening = true; $("speakBtn").classList.add("listening");
    $("speakLabel").textContent = "Listening…"; setStatus("Speak now");
  };
  recognition.onresult = e => {
    const text = e.results[0][0].transcript.trim();
    $("transcript").textContent = `You said: “${text}”`;
    handleCommand(text);
  };
  recognition.onerror = e => {
    setStatus(e.error === "not-allowed" ? "Microphone permission denied" : "Try again");
  };
  recognition.onend = () => {
    listening = false; $("speakBtn").classList.remove("listening");
    $("speakLabel").textContent = "Tap to Speak"; if ($("status").textContent === "Speak now") setStatus("Ready");
  };
}

$("speakBtn").addEventListener("click", () => {
  if (!recognition) setupSpeechRecognition();
  if (!recognition) return;
  if (listening) recognition.stop();
  else {
    recognition.lang = $("language").value;
    try { recognition.start(); } catch {}
  }
});

$("language").addEventListener("change", () => { if (recognition) recognition.lang = $("language").value; });
$("stopBtn").addEventListener("click", stopAll);
$("closeScanner").addEventListener("click", closeScanner);
$("speakObjects").addEventListener("click", () => {
  const names = [...new Set(detectedObjects.map(p => p.class))];
  speak(names.length ? `I can see ${names.join(", ")}.` : "No known object is detected right now.");
});

$("helpBtn").addEventListener("click", () => {
  speak("You can say: News. Play technology news for five minutes. What is my location? What time is it? What is today's date? What is the weather? Open object scanner. Call Rahul. Send WhatsApp message to Rahul saying hello. Calculate twenty plus ten. Open YouTube. Open Google.");
});

document.querySelectorAll("[data-command]").forEach(btn => {
  btn.addEventListener("click", () => {
    const cmd = btn.dataset.command;
    const map = {
      news: () => newsCommand(),
      location: locationCommand,
      time: timeCommand,
      date: dateCommand,
      weather: weatherCommand,
      scanner: openObjectScanner,
      contacts: () => $("contactName").focus(),
      calculator: () => speak("Say a calculation, for example, calculate twenty five plus ten.")
    };
    map[cmd]?.();
  });
});

async function handleCommand(raw) {
  const text = raw.trim();
  const t = text.toLowerCase();

  if (/^(stop|cancel|quiet|stop speaking)/i.test(t)) { stopAll(); speak("Stopped."); return; }
  if (/object scanner|open scanner|scan object|what.*front|what.*in front/i.test(t)) { openObjectScanner(); return; }
  if (/^(news|latest news|today.*news)/i.test(t)) { newsCommand("general", parseMinutes(t)); return; }

  const cat = ["technology","sports","business","science","health","entertainment"].find(x => t.includes(x));
  if ((t.includes("news") || t.includes("headlines")) && cat) { newsCommand(cat, parseMinutes(t)); return; }

  if (/location|where am i|where are we|current place/i.test(t)) { locationCommand(); return; }
  if (/weather|temperature|rain today/i.test(t)) { weatherCommand(); return; }
  if (/what time|current time|time now|time is it/i.test(t)) { timeCommand(); return; }
  if (/date today|today.*date|what.*date/i.test(t)) { dateCommand(); return; }

  if (/whatsapp|message/i.test(t) && /(?:send|message).*to/i.test(t)) { sendWhatsAppCommand(text); return; }

  const callMatch = t.match(/(?:call|phone|dial)\s+(.+)/i);
  if (callMatch) {
    const c = findContact(callMatch[1]);
    if (!c) speak(`I could not find ${callMatch[1]} in your saved contacts.`);
    else callContact(c);
    return;
  }

  if (/open youtube/i.test(t)) { speak("Opening YouTube."); setTimeout(() => window.open("https://www.youtube.com","_blank"),500); return; }
  if (/open google|search google/i.test(t)) { speak("Opening Google."); setTimeout(() => window.open("https://www.google.com","_blank"),500); return; }
  if (/calculator|calculate|what is \d/i.test(t)) { calculatorCommand(text); return; }

  const min = parseMinutes(t);
  if (min && (t.includes("play") || t.includes("listen"))) {
    if (t.includes("news")) newsCommand(cat || "general", min);
    else speak(`I can play supported content for ${min} minutes when a content source is selected.`);
    return;
  }

  if (/help|what can you do|commands/i.test(t)) {
    $("helpBtn").click(); return;
  }

  speak("I did not understand that command. Tap the question mark for examples.");
}

renderContacts();
setupSpeechRecognition();
window.addEventListener("beforeunload", closeScanner);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
