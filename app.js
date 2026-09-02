'use strict';

/* ---------- State ---------- */

const STORAGE_KEY = 'reading-weather-log-v2';
const LOC_KEY = 'reading-weather-last-loc-v1';
const UNIT_KEY = 'reading-weather-unit-v1';

let unit = localStorage.getItem(UNIT_KEY) || 'F'; // 'F' or 'C'
let currentLocation = null; // {lat, lon, label}
let latestWeather = null;   // last fetched Open-Meteo payload

/* ---------- Elements ---------- */

const el = (id) => document.getElementById(id);
const searchForm = el('searchForm');
const searchInput = el('searchInput');
const searchResults = el('searchResults');
const geoBtn = el('geoBtn');
const statusMsg = el('statusMsg');
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

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`);
    if (!res.ok) throw new Error('reverse geocode failed');
    const data = await res.json();
    const city = data.city || data.locality;
    const region = data.principalSubdivision;
    if (!city && !region) return null;
    if (city && region && region !== city) return `${city}, ${region}`;
    return city || region;
  } catch (e) {
    return null;
  }
}

function useGeolocation() {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported in this browser. Please search for a city instead.');
    return;
  }
  searchResults.classList.add('hidden');
  showStatus('Getting your location…');
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      const { latitude, longitude } = pos.coords;
      const cityLabel = await reverseGeocode(latitude, longitude);
      setLocation({ lat: latitude, lon: longitude, label: cityLabel || 'My Location' });
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
    + '&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm&timezone=auto&forecast_days=7';

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Weather request failed');
    const data = await res.json();
    latestWeather = data;
    renderWeather(data);
    hideStatus();
    mainContent.classList.remove('hidden');
    unitToggle.classList.remove('hidden');
    loadAlerts(lat, lon);
  } catch (e) {
    showStatus('Could not load weather data. Check your connection and try again.');
  }
}

async function loadAlerts(lat, lon) {
  const list = el('severeList');
  const noneMsg = '<div class="severe-empty">No upcoming severe weather alerts.</div>';
  list.innerHTML = noneMsg;
  try {
    const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, {
      headers: { 'Accept': 'application/geo+json' },
    });
    if (!res.ok) return; // likely outside US coverage
    const data = await res.json();
    const severe = (data.features || []).filter((f) => severityRank(f.properties.severity) >= severityRank('Moderate'));
    if (severe.length === 0) return;

    severe.sort((a, b) => severityRank(b.properties.severity) - severityRank(a.properties.severity));
    const now = Date.now();
    list.innerHTML = '';
    severe.forEach((f) => {
      const p = f.properties;
      const sevClass = 'severity-' + (p.severity || 'minor').toLowerCase();
      const onset = p.onset ? new Date(p.onset).getTime() : null;
      const expires = p.expires ? new Date(p.expires).getTime() : null;
      let meta = '';
      if (onset && onset > now) {
        meta = `Upcoming — starts ${fmtDateTime(p.onset)}`;
      } else if (expires) {
        meta = `Active now — until ${fmtDateTime(p.expires)}`;
      } else {
        meta = 'Active now';
      }
      const item = document.createElement('div');
      item.className = 'severe-item ' + sevClass;
      item.innerHTML = `<span class="severe-title">${escapeHtml(p.event)}</span>${escapeHtml(p.headline || '')}<span class="severe-meta">${meta}</span>`;
      list.appendChild(item);
    });
  } catch (e) {
    // NWS unreachable or non-US location — leave the "no alerts" message in place
  }
}
function fmtDateTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
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
  renderWeekPlan(hourly);
  renderReadability(cur, nowHourIdx, hourly);
  applySkyBackground(cur, daily);
}

/* ---------- Sky background ---------- */

const SKY_PALETTES = {
  night: {
    clear: ['#0b1026', '#1b2645', '#2a3a5c'],
    cloudy: ['#131a2b', '#263349'],
    rain: ['#0d1420', '#232f3d'],
    storm: ['#0a0a18', '#1e1b30'],
    snow: ['#1a2438', '#33445c'],
    fog: ['#171d29', '#303a48'],
  },
  dawn: {
    clear: ['#2b2a5e', '#ff9a76', '#ffd59e'],
    cloudy: ['#3a3a5c', '#8d8aa8', '#d8c9c2'],
    rain: ['#34394f', '#6d7488'],
    storm: ['#26263c', '#4a4560'],
    snow: ['#3c4256', '#b9c3d6'],
    fog: ['#3a3f4f', '#9098a4'],
  },
  day: {
    clear: ['#4fa8ea', '#a9dcf7', '#eaf6ff'],
    cloudy: ['#8ea3b8', '#c4d1dd'],
    rain: ['#5c6b78', '#8b98a3'],
    storm: ['#3d4250', '#6b7180'],
    snow: ['#c9d9e8', '#f2f7fb'],
    fog: ['#a9b3ba', '#d8dee2'],
  },
  dusk: {
    clear: ['#202049', '#b3466b', '#ff9d6c'],
    cloudy: ['#2c2c46', '#8a6f7c', '#cbb2a6'],
    rain: ['#262c3c', '#545e6c'],
    storm: ['#1c1a2e', '#423b52'],
    snow: ['#2e3348', '#9aa8bd'],
    fog: ['#2c303c', '#767e88'],
  },
};

function getSkyPeriod(cur, daily) {
  const now = Date.now();
  const sunrise = new Date(daily.sunrise[0]).getTime();
  const sunset = new Date(daily.sunset[0]).getTime();
  const twilightMs = 45 * 60 * 1000;
  if (Math.abs(now - sunrise) < twilightMs) return 'dawn';
  if (Math.abs(now - sunset) < twilightMs) return 'dusk';
  return cur.is_day ? 'day' : 'night';
}

function conditionCategory(code) {
  if ([0, 1].includes(code)) return 'clear';
  if ([2, 3].includes(code)) return 'cloudy';
  if ([45, 48].includes(code)) return 'fog';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([95, 96, 99].includes(code)) return 'storm';
  return 'clear';
}

function gradientCss(colors) {
  if (colors.length === 2) return `linear-gradient(180deg, ${colors[0]} 0%, ${colors[1]} 100%)`;
  return `linear-gradient(180deg, ${colors[0]} 0%, ${colors[1]} 55%, ${colors[2]} 100%)`;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]) {
  const srgb = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function applySkyBackground(cur, daily) {
  const period = getSkyPeriod(cur, daily);
  const condition = conditionCategory(cur.weather_code);
  const colors = (SKY_PALETTES[period] && SKY_PALETTES[period][condition]) || SKY_PALETTES.day.clear;
  document.body.style.background = gradientCss(colors);

  const avgRgb = [0, 1, 2].map((ci) => colors.reduce((sum, c) => sum + hexToRgb(c)[ci], 0) / colors.length);
  const isLight = relativeLuminance(avgRgb) > 0.5;
  const root = document.documentElement.style;
  root.setProperty('--sky-text', isLight ? '#12202e' : '#ffffff');
  root.setProperty('--sky-text-dim', isLight ? 'rgba(18, 32, 46, 0.72)' : 'rgba(255, 255, 255, 0.8)');

  // Frosted glass cards blend the sky color with ~50% white, so compute contrast against that blend.
  const blendedRgb = avgRgb.map((c) => c * 0.5 + 255 * 0.5);
  const isCardLight = relativeLuminance(blendedRgb) > 0.5;
  root.setProperty('--card-text', isCardLight ? '#12202e' : '#ffffff');
  root.setProperty('--card-text-dim', isCardLight ? 'rgba(18, 32, 46, 0.72)' : 'rgba(255, 255, 255, 0.8)');
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

// Generic "comfortable" bounds used per-factor until enough of the user's own
// log entries rate that specific factor as comfortable (min 3 needed).
const GENERIC_BOUNDS = {
  feelsLike: { min: 18, max: 26 },
  humidity: { min: 40, max: 65 },
  wind: { min: 0, max: 20 },
  uv: { min: 0, max: 6 },
};

function buildFactorRanges(log) {
  const rangeFor = (predicate, key) => {
    const vals = log.filter(predicate).map((e) => e[key]).filter((v) => typeof v === 'number');
    if (vals.length < 3) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  };
  return {
    feelsLike: rangeFor((e) => e.tempRating === 'comfortable', 'feelsLike'),
    humidity: rangeFor((e) => e.humidityRating === 'comfortable', 'humidity'),
    wind: rangeFor((e) => e.windRating === 'comfortable', 'wind'),
    uv: rangeFor((e) => e.sunRating === 'comfortable', 'uv'),
  };
}

function computeReadScore(ranges, feelsLikeC, humidity, windKmh, uv, precipPct) {
  let score = 100;
  const penalize = (val, range, generic, weight) => {
    if (val === null || val === undefined || Number.isNaN(val)) return 0;
    const bounds = range || generic;
    if (val >= bounds.min && val <= bounds.max) return 0;
    const dist = val < bounds.min ? bounds.min - val : val - bounds.max;
    return Math.min(weight, dist * (weight / 10));
  };
  score -= penalize(feelsLikeC, ranges.feelsLike, GENERIC_BOUNDS.feelsLike, 40);
  score -= penalize(humidity, ranges.humidity, GENERIC_BOUNDS.humidity, 20);
  score -= penalize(windKmh, ranges.wind, GENERIC_BOUNDS.wind, 20);
  score -= penalize(uv, ranges.uv, GENERIC_BOUNDS.uv, 12);
  if (precipPct >= 50) score -= 40;
  else if (precipPct >= 25) score -= 15;
  return Math.max(0, Math.round(score));
}

function scoreToLabel(score) {
  if (score >= 70) return { tag: 'ideal', text: 'Ideal for reading' };
  if (score >= 45) return { tag: 'ok', text: 'Okay, minor tradeoffs' };
  return { tag: 'poor', text: 'Not great for reading' };
}

/* ---------- Factor chips (why / why not) ---------- */

const GOOD_LABELS = { feelsLike: 'Ideal Temp', humidity: 'Comfortable Humidity', uv: 'Mild Sun' };
const BAD_LABELS = {
  feelsLike: { low: 'Cold', high: 'Hot' },
  humidity: { low: 'Low Humidity', high: 'High Humidity' },
  uv: { low: 'Low UV', high: 'Strong Sun' },
};

function rangeChip(kind, value, bounds) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value >= bounds.min && value <= bounds.max) return { tone: 'good', text: GOOD_LABELS[kind] };
  const dir = value < bounds.min ? 'low' : 'high';
  return { tone: 'bad', text: BAD_LABELS[kind][dir] };
}

function windChip(value, bounds) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (value > bounds.max) return { tone: 'bad', text: 'Windy' };
  return { tone: 'good', text: 'No Wind' };
}

function precipChip(precipPct) {
  if (precipPct >= 50) return { tone: 'bad', text: 'High Precip Risk' };
  if (precipPct >= 25) return { tone: 'bad', text: 'Chance of Rain' };
  if (precipPct <= 5) return { tone: 'good', text: 'Dry' };
  return null;
}

function buildFactorChips(ranges, feelsLikeC, humidity, windKmh, uv, precipPct) {
  const chips = [
    rangeChip('feelsLike', feelsLikeC, ranges.feelsLike || GENERIC_BOUNDS.feelsLike),
    rangeChip('humidity', humidity, ranges.humidity || GENERIC_BOUNDS.humidity),
    windChip(windKmh, ranges.wind || GENERIC_BOUNDS.wind),
    rangeChip('uv', uv, ranges.uv || GENERIC_BOUNDS.uv),
    precipChip(precipPct),
  ].filter(Boolean);
  chips.sort((a, b) => (a.tone === 'bad' ? 0 : 1) - (b.tone === 'bad' ? 0 : 1));
  return chips.slice(0, 3);
}

function chipsHtml(chips) {
  return chips.map((c) => `<span class="factor-chip ${c.tone}">${c.text}</span>`).join('');
}

function renderReadability(cur, nowIdx, hourly) {
  const ranges = buildFactorRanges(loadLog());
  const precipPct = hourly.precipitation_probability[nowIdx];
  const uv = hourly.uv_index ? hourly.uv_index[nowIdx] : 0;
  const score = computeReadScore(ranges, cur.apparent_temperature, cur.relative_humidity_2m, cur.wind_speed_10m, uv, precipPct);
  const { tag, text } = scoreToLabel(score);
  const badge = el('readabilityBadge');
  badge.textContent = `${text} (${score}/100)`;
  badge.className = 'readability-badge ' + tag;
}

function renderBestTime(hourly, nowIdx) {
  const ranges = buildFactorRanges(loadLog());
  const list = el('bestTimeList');
  list.innerHTML = '';
  const end = Math.min(nowIdx + 12, hourly.time.length);
  const rows = [];
  for (let i = nowIdx; i < end; i++) {
    const precipPct = hourly.precipitation_probability[i];
    const uv = hourly.uv_index ? hourly.uv_index[i] : 0;
    const score = computeReadScore(ranges, hourly.apparent_temperature[i], hourly.relative_humidity_2m[i], hourly.wind_speed_10m[i], uv, precipPct);
    const chips = buildFactorChips(ranges, hourly.apparent_temperature[i], hourly.relative_humidity_2m[i], hourly.wind_speed_10m[i], uv, precipPct);
    rows.push({ time: hourly.time[i], score, chips });
  }
  rows.sort((a, b) => b.score - a.score);
  const top = rows.slice(0, 4).sort((a, b) => new Date(a.time) - new Date(b.time));
  const bestScore = Math.max(...top.map((r) => r.score));
  top.forEach((r) => {
    const { tag, text } = scoreToLabel(r.score);
    const row = document.createElement('div');
    row.className = 'best-time-row' + (r.score === bestScore ? ' highlight' : '');
    row.innerHTML = `
      <div class="best-time-top"><span>${fmtHour(r.time)}</span><span class="tag ${tag}">${text} · ${r.score}</span></div>
      <div class="factor-chips">${chipsHtml(r.chips)}</div>`;
    list.appendChild(row);
  });

  const note = el('modelNote');
  const factorLabels = { feelsLike: 'temperature', humidity: 'humidity', wind: 'wind', uv: 'sun/UV' };
  const personalized = Object.keys(ranges).filter((k) => ranges[k]).map((k) => factorLabels[k]);
  if (personalized.length > 0) {
    const remaining = Object.keys(ranges).filter((k) => !ranges[k]).map((k) => factorLabels[k]);
    note.textContent = `Personalized for ${personalized.join(', ')} based on your logged sessions.`
      + (remaining.length ? ` Still using general guidelines for ${remaining.join(', ')}.` : '');
  } else {
    note.textContent = 'Using general comfort guidelines. Rate a few logged sessions as "comfortable" for each factor to start personalizing predictions.';
  }
}

function renderWeekPlan(hourly) {
  const ranges = buildFactorRanges(loadLog());
  const container = el('weekPlanList');
  container.innerHTML = '';

  const days = {};
  hourly.time.forEach((t, i) => {
    const dayKey = t.slice(0, 10);
    (days[dayKey] = days[dayKey] || []).push(i);
  });

  const dayEntries = [];
  Object.keys(days).sort().slice(0, 7).forEach((dayKey, di) => {
    let best = null;
    days[dayKey].forEach((i) => {
      const hour = new Date(hourly.time[i]).getHours();
      if (hour < 7 || hour > 20) return; // typical waking reading hours
      const precipPct = hourly.precipitation_probability[i];
      const uv = hourly.uv_index ? hourly.uv_index[i] : 0;
      const score = computeReadScore(ranges, hourly.apparent_temperature[i], hourly.relative_humidity_2m[i], hourly.wind_speed_10m[i], uv, precipPct);
      if (!best || score > best.score) {
        best = { time: hourly.time[i], score, chips: buildFactorChips(ranges, hourly.apparent_temperature[i], hourly.relative_humidity_2m[i], hourly.wind_speed_10m[i], uv, precipPct) };
      }
    });
    if (best) dayEntries.push({ dayKey, di, best });
  });

  const bestScore = Math.max(...dayEntries.map((d) => d.best.score));
  dayEntries.forEach(({ dayKey, di, best }) => {
    const dayLabel = di === 0 ? 'Today' : new Date(dayKey + 'T12:00:00').toLocaleDateString([], { weekday: 'short', month: 'numeric', day: 'numeric' });
    const { tag } = scoreToLabel(best.score);
    const row = document.createElement('div');
    row.className = 'week-row' + (best.score === bestScore ? ' highlight' : '');
    row.innerHTML = `
      <div class="best-time-top"><span>${dayLabel} · ${fmtHour(best.time)}</span><span class="tag ${tag}">${best.score}</span></div>
      <div class="factor-chips">${chipsHtml(best.chips)}</div>`;
    container.appendChild(row);
  });
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

const TEMP_PHRASES = { too_cold: 'Felt too cold', comfortable: 'Temperature felt comfortable', too_hot: 'Felt too hot' };
const HUMIDITY_PHRASES = { too_dry: 'Air felt too dry', comfortable: 'Humidity felt comfortable', too_humid: 'Felt too humid' };
const WIND_PHRASES = { too_still: 'Air was too still', comfortable: 'Wind felt comfortable', too_windy: 'Too windy' };
const SUN_PHRASES = { too_shaded: 'Too shaded', comfortable: 'Sun felt comfortable', too_bright: 'Too much sun or glare' };

function describeEntry(entry) {
  const phrases = [];
  if (TEMP_PHRASES[entry.tempRating]) phrases.push(TEMP_PHRASES[entry.tempRating]);
  if (HUMIDITY_PHRASES[entry.humidityRating]) phrases.push(HUMIDITY_PHRASES[entry.humidityRating]);
  if (WIND_PHRASES[entry.windRating]) phrases.push(WIND_PHRASES[entry.windRating]);
  if (SUN_PHRASES[entry.sunRating]) phrases.push(SUN_PHRASES[entry.sunRating]);
  if (entry.precip) phrases.push('It rained or drizzled');
  if (entry.bugs) phrases.push('Bugs were bothersome');
  if (entry.airQuality) phrases.push('Air quality was poor');
  return phrases.join(' · ');
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
    const notesHtml = entry.notes ? `<span class="le-notes">"${escapeHtml(entry.notes)}"</span>` : '';
    const tempText = typeof entry.temp === 'number' ? `${fmtTemp(entry.temp)} (feels ${fmtTemp(entry.feelsLike)})` : '';
    row.innerHTML = `
      <div class="le-main">
        <span class="le-time">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${tempText ? ' · ' + tempText : ''}</span>
        <span>${describeEntry(entry)}</span>
        ${notesHtml}
      </div>
      <button class="le-del" data-id="${entry.id}" aria-label="Delete entry">✕</button>`;
    list.appendChild(row);
  });
  list.querySelectorAll('.le-del').forEach((btn) => {
    btn.addEventListener('click', () => deleteLogEntry(btn.dataset.id));
  });
}

function saveEntry(fields) {
  const snap = currentConditionsSnapshot();
  if (!snap) {
    alert('Weather data not loaded yet.');
    return;
  }
  addLogEntry({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    timestamp: new Date().toISOString(),
    ...fields,
    ...snap,
  });
  refreshPredictions();
}

/* ---------- Event wiring ---------- */

async function runSearch(q) {
  if (!q) {
    searchResults.classList.add('hidden');
    return;
  }
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
}

searchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  runSearch(searchInput.value.trim());
});

let searchDebounce = null;
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  clearTimeout(searchDebounce);
  if (q.length < 2) {
    searchResults.classList.add('hidden');
    return;
  }
  searchDebounce = setTimeout(() => runSearch(q), 350);
});

geoBtn.addEventListener('click', useGeolocation);

function selectPlanTab(tab) {
  const isToday = tab === 'today';
  el('tabToday').classList.toggle('active', isToday);
  el('tabWeek').classList.toggle('active', !isToday);
  el('tabToday').setAttribute('aria-selected', String(isToday));
  el('tabWeek').setAttribute('aria-selected', String(!isToday));
  el('panelToday').classList.toggle('hidden', !isToday);
  el('panelWeek').classList.toggle('hidden', isToday);
}
el('tabToday').addEventListener('click', () => selectPlanTab('today'));
el('tabWeek').addEventListener('click', () => selectPlanTab('week'));

unitToggle.addEventListener('click', () => {
  unit = unit === 'F' ? 'C' : 'F';
  localStorage.setItem(UNIT_KEY, unit);
  unitToggle.setAttribute('aria-checked', unit === 'C' ? 'true' : 'false');
  if (latestWeather) renderWeather(latestWeather);
  renderLog();
});

/* Session-form: single-select "pill" behavior for scale/yes-no radio groups */
document.querySelectorAll('.scale-options, .yesno-options').forEach((group) => {
  group.querySelectorAll('input[type=radio]').forEach((input) => {
    input.addEventListener('change', () => {
      group.querySelectorAll('label').forEach((label) => label.classList.remove('selected'));
      input.closest('label').classList.add('selected');
    });
  });
});

function resetSessionForm() {
  const form = el('sessionForm');
  form.querySelectorAll('input[type=radio]').forEach((input) => (input.checked = false));
  form.querySelectorAll('label.selected').forEach((label) => label.classList.remove('selected'));
  el('sessionNotes').value = '';
}

el('addSessionBtn').addEventListener('click', () => {
  const form = el('sessionForm');
  const opening = form.classList.contains('hidden');
  form.classList.toggle('hidden');
  if (opening) form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

el('submitSessionBtn').addEventListener('click', () => {
  const getVal = (name) => document.querySelector(`input[name="${name}"]:checked`)?.value || null;
  const tempRating = getVal('tempRating');
  const humidityRating = getVal('humidityRating');
  const windRating = getVal('windRating');
  const sunRating = getVal('sunRating');
  if (!tempRating || !humidityRating || !windRating || !sunRating) {
    alert('Please answer temperature, humidity, wind, and sun/glare before saving.');
    return;
  }
  saveEntry({
    tempRating,
    humidityRating,
    windRating,
    sunRating,
    precip: getVal('precip') === 'yes',
    bugs: getVal('bugs') === 'yes',
    airQuality: getVal('airQuality') === 'yes',
    notes: el('sessionNotes').value.trim(),
  });
  resetSessionForm();
  el('sessionForm').classList.add('hidden');
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

function refreshPredictions() {
  if (!latestWeather) return;
  const nowIdx = findCurrentHourIndex(latestWeather.hourly.time);
  renderBestTime(latestWeather.hourly, nowIdx);
  renderWeekPlan(latestWeather.hourly);
  renderReadability(latestWeather.current, nowIdx, latestWeather.hourly);
}

function sampleLogEntries() {
  const mk = (daysAgo, hour, fields, notes) => {
    const d = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    d.setHours(hour, 0, 0, 0);
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + daysAgo,
      timestamp: d.toISOString(),
      notes: notes || '',
      ...fields,
    };
  };
  return [
    mk(10, 8, { tempRating: 'comfortable', humidityRating: 'comfortable', windRating: 'comfortable', sunRating: 'comfortable', precip: false, bugs: false, airQuality: false, temp: 22, feelsLike: 24, humidity: 55, wind: 10, uv: 3, precipProb: 5 }, 'Perfect morning at the park.'),
    mk(9, 17, { tempRating: 'too_hot', humidityRating: 'too_humid', windRating: 'comfortable', sunRating: 'too_bright', precip: false, bugs: true, airQuality: false, temp: 31, feelsLike: 33, humidity: 80, wind: 8, uv: 7, precipProb: 10 }, 'Got sweaty and bugs were annoying.'),
    mk(7, 9, { tempRating: 'comfortable', humidityRating: 'comfortable', windRating: 'comfortable', sunRating: 'comfortable', precip: false, bugs: false, airQuality: false, temp: 20, feelsLike: 22, humidity: 50, wind: 12, uv: 2, precipProb: 0 }, 'Cool breeze, ideal reading weather.'),
    mk(6, 14, { tempRating: 'too_cold', humidityRating: 'too_dry', windRating: 'too_windy', sunRating: 'comfortable', precip: false, bugs: false, airQuality: false, temp: 12, feelsLike: 9, humidity: 35, wind: 28, uv: 4, precipProb: 15 }, 'Wind kept flipping pages.'),
    mk(5, 7, { tempRating: 'comfortable', humidityRating: 'comfortable', windRating: 'comfortable', sunRating: 'too_shaded', precip: false, bugs: false, airQuality: false, temp: 19, feelsLike: 21, humidity: 58, wind: 9, uv: 1, precipProb: 0 }, 'A bit overcast but calm.'),
    mk(4, 18, { tempRating: 'too_hot', humidityRating: 'too_humid', windRating: 'comfortable', sunRating: 'too_bright', precip: false, bugs: true, airQuality: false, temp: 30, feelsLike: 32, humidity: 85, wind: 6, uv: 8, precipProb: 20 }, 'Humidity was brutal.'),
    mk(2, 8, { tempRating: 'comfortable', humidityRating: 'comfortable', windRating: 'comfortable', sunRating: 'comfortable', precip: false, bugs: false, airQuality: false, temp: 21, feelsLike: 23, humidity: 52, wind: 11, uv: 3, precipProb: 5 }, 'Great session, no complaints.'),
    mk(1, 16, { tempRating: 'too_cold', humidityRating: 'comfortable', windRating: 'too_windy', sunRating: 'comfortable', precip: true, bugs: false, airQuality: false, temp: 13, feelsLike: 15, humidity: 48, wind: 25, uv: 5, precipProb: 30 }, 'Started drizzling, had to pack up.'),
  ];
}

el('loadSampleBtn').addEventListener('click', () => {
  const existing = loadLog();
  saveLog([...sampleLogEntries(), ...existing]);
  renderLog();
  refreshPredictions();
});

document.addEventListener('click', (e) => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) {
    searchResults.classList.add('hidden');
  }
});

/* ---------- Init ---------- */

unitToggle.setAttribute('aria-checked', unit === 'C' ? 'true' : 'false');
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
