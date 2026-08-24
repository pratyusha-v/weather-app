'use strict';

/* ---------- State ---------- */

const STORAGE_KEY = 'reading-weather-log-v1';
const LOC_KEY = 'reading-weather-last-loc-v1';
const UNIT_KEY = 'reading-weather-unit-v1';

let unit = localStorage.getItem(UNIT_KEY) || 'F'; // 'F' or 'C'
let currentLocation = null; // {lat, lon, label}
let latestWeather = null;   // last fetched Open-Meteo payload
let pendingReasons = [];

/* ---------- Elements ---------- */

const el = (id) => document.getElementById(id);
const searchForm = el('searchForm');
const searchInput = el('searchInput');
const searchResults = el('searchResults');
const geoBtn = el('geoBtn');
const statusMsg = el('statusMsg');
const alertBanner = el('alertBanner');
const mainContent = el('mainContent');
const unitToggle = el('unitToggle');

/* ---------- Utilities ---------- */

function cToF(c) { return c * 9 / 5 + 32; }
function fmtTemp(celsius) {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return '--°';
  const v = unit === 'F' ? cToF(celsius) : celsius;
  return Math.round(v) + '°' + unit;
}
function fmtWind(kmh) {
  if (kmh === null || kmh === undefined) return '--';
  if (unit === 'F') return Math.round(kmh * 0.621371) + ' mph';
  return Math.round(kmh) + ' km/h';
}
function fmtTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function fmtHour(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleTimeString([], { hour: 'numeric' });
}
function showStatus(msg) {
  statusMsg.textContent = msg;
  statusMsg.classList.remove('hidden');
  mainContent.classList.add('hidden');
}
function hideStatus() {
  statusMsg.classList.add('hidden');
}

function weatherCodeInfo(code) {
  const map = {
    0: ['☀️', 'Clear sky'],
    1: ['🌤️', 'Mainly clear'],
    2: ['⛅', 'Partly cloudy'],
    3: ['☁️', 'Overcast'],
    45: ['🌫️', 'Fog'],
    48: ['🌫️', 'Depositing rime fog'],
    51: ['🌦️', 'Light drizzle'],
    53: ['🌦️', 'Drizzle'],
    55: ['🌧️', 'Dense drizzle'],
    56: ['🌧️', 'Freezing drizzle'],
    57: ['🌧️', 'Freezing drizzle'],
    61: ['🌦️', 'Slight rain'],
    63: ['🌧️', 'Rain'],
    65: ['🌧️', 'Heavy rain'],
    66: ['🌧️', 'Freezing rain'],
    67: ['🌧️', 'Freezing rain'],
    71: ['🌨️', 'Slight snow'],
    73: ['🌨️', 'Snow'],
    75: ['❄️', 'Heavy snow'],
    77: ['❄️', 'Snow grains'],
    80: ['🌦️', 'Rain showers'],
    81: ['🌧️', 'Rain showers'],
    82: ['⛈️', 'Violent rain showers'],
    85: ['🌨️', 'Snow showers'],
    86: ['❄️', 'Heavy snow showers'],
    95: ['⛈️', 'Thunderstorm'],
    96: ['⛈️', 'Thunderstorm with hail'],
    99: ['⛈️', 'Severe thunderstorm with hail'],
  };
  return map[code] || ['🌡️', 'Unknown'];
}

/* ---------- Log storage ---------- */

function loadLog() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch (e) {
    return [];
  }
}
function saveLog(log) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
}
function addLogEntry(entry) {
  const log = loadLog();
  log.unshift(entry);
  saveLog(log);
  renderLog();
}
function deleteLogEntry(id) {
  const log = loadLog().filter((e) => e.id !== id);
  saveLog(log);
  renderLog();
}

/* ---------- Geocoding & geolocation ---------- */

async function searchCity(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const res = await fetch(url);
  const data = await res.json();
  return data.results || [];
}

function useGeolocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported in this browser. Please search for a city instead.');
    return;
  }
  showStatus('Getting your location…');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      let label = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
      try {
        const results = await searchCity('');
      } catch (e) { /* ignore */ }
      setLocation({ lat: latitude, lon: longitude, label: 'My Location' });
    },
    (err) => {
      showStatus('Location access denied or unavailable. Search for a city above.');
    },
    { enableHighAccuracy: false, timeout: 10000 }
  );
}

function setLocation(loc) {
  currentLocation = loc;
  localStorage.setItem(LOC_KEY, JSON.stringify(loc));
  searchResults.classList.add('hidden');
  searchInput.value = '';
  loadWeather();
}

/* ---------- Weather fetch ---------- */

async function loadWeather() {
  if (!currentLocation) return;
  showStatus('Loading weather…');
  const { lat, lon } = currentLocation;
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${lat}&longitude=${lon}`
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day'
    + '&hourly=temperature_2m,apparent_temperature,precipitation_probability,relative_humidity_2m,wind_speed_10m,uv_index,weather_code'
    + '&daily=sunrise,sunset,uv_index_max,precipitation_probability_max'
    + '&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm&timezone=auto&forecast_days=2';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Weather request failed');
    const data = await res.json();
    latestWeather = data;
    renderWeather(data);
    hideStatus();
    mainContent.classList.remove('hidden');
    loadAlerts(lat, lon);
  } catch (e) {
    showStatus('Could not load weather data. Check your connection and try again.');
  }
}

async function loadAlerts(lat, lon) {
  alertBanner.classList.add('hidden');
  try {
    const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, {
      headers: { 'Accept': 'application/geo+json' },
    });
    if (!res.ok) return; // likely outside US coverage
    const data = await res.json();
    const features = data.features || [];
    if (features.length === 0) return;

    features.sort((a, b) => severityRank(b.properties.severity) - severityRank(a.properties.severity));
    const top = features[0].properties;
    const sevClass = 'severity-' + (top.severity || 'minor').toLowerCase();
    alertBanner.className = 'alert-banner ' + sevClass;
    const extra = features.length > 1 ? ` (+${features.length - 1} more alert${features.length > 2 ? 's' : ''})` : '';
    alertBanner.innerHTML = `<span class="alert-title">⚠️ ${escapeHtml(top.event)}${extra}</span>${escapeHtml(top.headline || '')}`;
    alertBanner.classList.remove('hidden');
  } catch (e) {
    // NWS unreachable or non-US location — silently skip, not a fatal error
  }
}
function severityRank(sev) {
  const order = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };
  return order[sev] ?? 0;
}
function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

/* ---------- Rendering ---------- */

function renderWeather(data) {
  const cur = data.current;
  const daily = data.daily;
  const hourly = data.hourly;

  el('locationName').textContent = currentLocation.label;
  el('updatedTime').textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  const [icon, desc] = weatherCodeInfo(cur.weather_code);
  el('currentIcon').textContent = cur.is_day ? icon : icon.replace('☀️', '🌙');
  el('currentTemp').textContent = fmtTemp(cur.temperature_2m);
  el('currentDesc').textContent = desc;

  el('feelsLike').textContent = fmtTemp(cur.apparent_temperature);
  el('humidity').textContent = Math.round(cur.relative_humidity_2m) + '%';
  el('wind').textContent = fmtWind(cur.wind_speed_10m);

  const nowHourIdx = findCurrentHourIndex(hourly.time);
  const uv = hourly.uv_index ? hourly.uv_index[nowHourIdx] : daily.uv_index_max[0];
  el('uvIndex').textContent = uv !== undefined ? uv.toFixed(1) : '--';

  el('sunrise').textContent = fmtTime(daily.sunrise[0]);
  el('sunset').textContent = fmtTime(daily.sunset[0]);

  renderPrecip(hourly, nowHourIdx);
  renderBestTime(hourly, nowHourIdx);
  renderReadability(cur, nowHourIdx, hourly);
}

function findCurrentHourIndex(timeArr) {
  const now = Date.now();
  let idx = 0;
  for (let i = 0; i < timeArr.length; i++) {
    if (new Date(timeArr[i]).getTime() <= now) idx = i;
    else break;
  }
  return idx;
}

function renderPrecip(hourly, nowIdx) {
  const container = el('hourlyPrecip');
  container.innerHTML = '';
  const next = [];
  for (let i = nowIdx; i < Math.min(nowIdx + 8, hourly.time.length); i++) {
    next.push(i);
  }
  let maxChance = 0;
  next.forEach((i) => {
    const pct = hourly.precipitation_probability[i];
    maxChance = Math.max(maxChance, pct);
    const [icon] = weatherCodeInfo(hourly.weather_code[i]);
    const chip = document.createElement('div');
    chip.className = 'hour-chip';
    chip.innerHTML = `<div class="h-time">${fmtHour(hourly.time[i])}</div><div class="h-icon">${icon}</div><div class="h-pct">${pct}%</div>`;
    container.appendChild(chip);
  });

  const verdict = el('umbrellaVerdict');
  if (maxChance >= 30) {
    verdict.textContent = `Yes — ${maxChance}% chance`;
    verdict.className = 'umbrella-verdict yes';
  } else {
    verdict.textContent = `No — ${maxChance}% chance`;
    verdict.className = 'umbrella-verdict no';
  }
}

/* ---------- Reading-comfort model ---------- */

function getComfortProfile() {
  const log = loadLog();
  const liked = log.filter((e) => e.mood === 'good');
  const disliked = log.filter((e) => e.mood === 'bad');

  if (liked.length < 3) return null; // not enough data yet, use generic heuristic

  const stat = (arr, key) => {
    const vals = arr.map((e) => e[key]).filter((v) => typeof v === 'number');
    if (vals.length === 0) return null;
    return { min: Math.min(...vals), max: Math.max(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length };
  };

  return {
    feelsLike: stat(liked, 'feelsLike'),
    humidity: stat(liked, 'humidity'),
    wind: stat(liked, 'wind'),
    uv: stat(liked, 'uv'),
    dislikedCount: disliked.length,
    likedCount: liked.length,
  };
}

// Generic heuristic used until enough personal log data exists.
function genericScore(feelsLikeC, humidity, windKmh, uv, precipPct) {
  let score = 100;
  if (feelsLikeC < 15 || feelsLikeC > 29) score -= 35;
  else if (feelsLikeC < 18 || feelsLikeC > 26) score -= 12;
  if (humidity > 80) score -= 20;
  else if (humidity > 65) score -= 8;
  if (windKmh > 30) score -= 25;
  else if (windKmh > 20) score -= 10;
  if (uv > 8) score -= 15;
  else if (uv > 6) score -= 6;
  if (precipPct >= 50) score -= 40;
  else if (precipPct >= 25) score -= 15;
  return Math.max(0, score);
}

function personalScore(profile, feelsLikeC, humidity, windKmh, uv, precipPct) {
  let score = 100;
  const penalize = (val, range, weight) => {
    if (!range || val === null || val === undefined) return 0;
    if (val >= range.min && val <= range.max) return 0;
    const dist = val < range.min ? range.min - val : val - range.max;
    return Math.min(weight, dist * (weight / 10));
  };
  score -= penalize(feelsLikeC, profile.feelsLike, 40);
  score -= penalize(humidity, profile.humidity, 20);
  score -= penalize(windKmh, profile.wind, 20);
  score -= penalize(uv, profile.uv, 12);
  if (precipPct >= 50) score -= 40;
  else if (precipPct >= 25) score -= 15;
  return Math.max(0, Math.round(score));
}

function scoreToLabel(score) {
  if (score >= 70) return { tag: 'ideal', text: 'Ideal for reading' };
  if (score >= 45) return { tag: 'ok', text: 'Okay, minor tradeoffs' };
  return { tag: 'poor', text: 'Not great for reading' };
}

function renderReadability(cur, nowIdx, hourly) {
  const profile = getComfortProfile();
  const precipPct = hourly.precipitation_probability[nowIdx];
  const uv = hourly.uv_index ? hourly.uv_index[nowIdx] : 0;
  const score = profile
    ? personalScore(profile, cur.temperature_2m, cur.relative_humidity_2m, cur.wind_speed_10m, uv, precipPct)
    : genericScore(cur.apparent_temperature, cur.relative_humidity_2m, cur.wind_speed_10m, uv, precipPct);
  const { tag, text } = scoreToLabel(score);
  const badge = el('readabilityBadge');
  badge.textContent = `${text} (${score}/100)`;
  badge.className = 'readability-badge ' + tag;
}

function renderBestTime(hourly, nowIdx) {
  const profile = getComfortProfile();
  const list = el('bestTimeList');
  list.innerHTML = '';
  const end = Math.min(nowIdx + 12, hourly.time.length);
  const rows = [];
  for (let i = nowIdx; i < end; i++) {
    const precipPct = hourly.precipitation_probability[i];
    const uv = hourly.uv_index ? hourly.uv_index[i] : 0;
    const score = profile
      ? personalScore(profile, hourly.temperature_2m[i], hourly.relative_humidity_2m[i], hourly.wind_speed_10m[i], uv, precipPct)
      : genericScore(hourly.apparent_temperature[i], hourly.relative_humidity_2m[i], hourly.wind_speed_10m[i], uv, precipPct);
    rows.push({ time: hourly.time[i], score });
  }
  rows.sort((a, b) => b.score - a.score);
  rows.slice(0, 4).sort((a, b) => new Date(a.time) - new Date(b.time)).forEach((r) => {
    const { tag, text } = scoreToLabel(r.score);
    const row = document.createElement('div');
    row.className = 'best-time-row';
    row.innerHTML = `<span>${fmtHour(r.time)}</span><span class="tag ${tag}">${text} · ${r.score}</span>`;
    list.appendChild(row);
  });

  const note = el('modelNote');
  if (profile) {
    note.textContent = `Personalized using ${profile.likedCount} liked and ${profile.dislikedCount} disliked log entries.`;
  } else {
    const log = loadLog();
    const liked = log.filter((e) => e.mood === 'good').length;
    note.textContent = `Using general comfort guidelines. Log ${3 - liked} more 👍 reading sessions to personalize predictions.`;
  }
}

/* ---------- Logging UI ---------- */

function currentConditionsSnapshot() {
  if (!latestWeather) return null;
  const cur = latestWeather.current;
  const nowIdx = findCurrentHourIndex(latestWeather.hourly.time);
  const uv = latestWeather.hourly.uv_index ? latestWeather.hourly.uv_index[nowIdx] : null;
  return {
    feelsLike: cur.apparent_temperature,
    temp: cur.temperature_2m,
    humidity: cur.relative_humidity_2m,
    wind: cur.wind_speed_10m,
    uv: uv,
    precipProb: latestWeather.hourly.precipitation_probability[nowIdx],
  };
}

function renderLog() {
  const log = loadLog();
  el('logCount').textContent = log.length;
  const list = el('logList');
  list.innerHTML = '';
  if (log.length === 0) {
    list.innerHTML = '<div class="log-hint">No entries yet.</div>';
    return;
  }
  log.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'log-entry';
    const dt = new Date(entry.timestamp);
    const reasonsText = entry.reasons && entry.reasons.length ? entry.reasons.join(', ') : '';
    row.innerHTML = `
      <div class="le-main">
        <span class="le-time">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <span>${fmtTemp(entry.feelsLike)} feels · ${Math.round(entry.humidity)}% hum · ${fmtWind(entry.wind)}${reasonsText ? ' · ' + reasonsText : ''}</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <span class="le-mood">${entry.mood === 'good' ? '👍' : '👎'}</span>
        <button class="le-del" data-id="${entry.id}" aria-label="Delete entry">✕</button>
      </div>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.le-del').forEach((btn) => {
    btn.addEventListener('click', () => deleteLogEntry(btn.dataset.id));
  });
}

function saveEntry(mood, reasons) {
  const snap = currentConditionsSnapshot();
  if (!snap) {
    alert('Weather data not loaded yet.');
    return;
  }
  addLogEntry({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    mood,
    reasons: reasons || [],
    ...snap,
  });
  if (latestWeather) {
    renderBestTime(latestWeather.hourly, findCurrentHourIndex(latestWeather.hourly.time));
    renderReadability(latestWeather.current, findCurrentHourIndex(latestWeather.hourly.time), latestWeather.hourly);
  }
}

/* ---------- Event wiring ---------- */

searchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  searchResults.innerHTML = '<button disabled>Searching…</button>';
  searchResults.classList.remove('hidden');
  try {
    const results = await searchCity(q);
    if (results.length === 0) {
      searchResults.innerHTML = '<button disabled>No results found</button>';
      return;
    }
    searchResults.innerHTML = '';
    results.forEach((r) => {
      const btn = document.createElement('button');
      const region = [r.admin1, r.country].filter(Boolean).join(', ');
      btn.textContent = `${r.name}${region ? ', ' + region : ''}`;
      btn.addEventListener('click', () => {
        setLocation({ lat: r.latitude, lon: r.longitude, label: `${r.name}${r.admin1 ? ', ' + r.admin1 : ''}` });
      });
      searchResults.appendChild(btn);
    });
  } catch (err) {
    searchResults.innerHTML = '<button disabled>Search failed — try again</button>';
  }
});

geoBtn.addEventListener('click', useGeolocation);

unitToggle.addEventListener('click', () => {
  unit = unit === 'F' ? 'C' : 'F';
  localStorage.setItem(UNIT_KEY, unit);
  unitToggle.textContent = '°' + unit;
  if (latestWeather) renderWeather(latestWeather);
  renderLog();
});

el('logGoodBtn').addEventListener('click', () => {
  el('reasonPanel').classList.add('hidden');
  saveEntry('good', []);
});

el('logBadBtn').addEventListener('click', () => {
  el('reasonPanel').classList.remove('hidden');
  el('reasonOptions').querySelectorAll('input[type=checkbox]').forEach((cb) => (cb.checked = false));
});

el('submitReasonBtn').addEventListener('click', () => {
  const reasons = Array.from(el('reasonOptions').querySelectorAll('input:checked')).map((cb) => cb.value);
  saveEntry('bad', reasons);
  el('reasonPanel').classList.add('hidden');
});

el('exportLogBtn').addEventListener('click', () => {
  const data = JSON.stringify(loadLog(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reading-weather-log.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

el('importLogInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      const existing = loadLog();
      const merged = [...imported, ...existing].filter(
        (entry, idx, arr) => arr.findIndex((x) => x.id === entry.id) === idx
      );
      saveLog(merged);
      renderLog();
      alert(`Imported ${imported.length} entries.`);
    } catch (err) {
      alert('Could not import file — invalid JSON log format.');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});

el('clearLogBtn').addEventListener('click', () => {
  if (confirm('Delete all reading log entries? This cannot be undone.')) {
    saveLog([]);
    renderLog();
  }
});

document.addEventListener('click', (e) => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    searchResults.classList.add('hidden');
  }
});

/* ---------- Init ---------- */

unitToggle.textContent = '°' + unit;
renderLog();

const savedLoc = localStorage.getItem(LOC_KEY);
if (savedLoc) {
  try {
    currentLocation = JSON.parse(savedLoc);
    loadWeather();
  } catch (e) {
    showStatus('Search for a city or tap 📍 to use your location.');
  }
} else {
  showStatus('Search for a city or tap 📍 to use your location.');
}
