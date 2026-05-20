const state = { readings: [], assignments: [], devices: [], query: '', view: 'command', selectedEcgId: null };

const els = {
  viewTitle: document.getElementById('viewTitle'),
  viewSubtitle: document.getElementById('viewSubtitle'),
  navItems: Array.from(document.querySelectorAll('.nav-item')),
  views: Array.from(document.querySelectorAll('.view')),
  activePatients: document.getElementById('activePatients'),
  openAlerts: document.getElementById('openAlerts'),
  ecgCaptured: document.getElementById('ecgCaptured'),
  connectedDevices: document.getElementById('connectedDevices'),
  patientList: document.getElementById('patientList'),
  alertList: document.getElementById('alertList'),
  patientsTable: document.getElementById('patientsTable'),
  ecgQueue: document.getElementById('ecgQueue'),
  ecgViewerSubtitle: document.getElementById('ecgViewerSubtitle'),
  ecgViewerMeta: document.getElementById('ecgViewerMeta'),
  ecgViewerCanvas: document.getElementById('ecgViewerCanvas'),
  ecgViewerStats: document.getElementById('ecgViewerStats'),
  devicesTable: document.getElementById('devicesTable'),
  assignmentsTable: document.getElementById('assignmentsTable'),
  assignmentForm: document.getElementById('assignmentForm'),
  assignmentStatus: document.getElementById('assignmentStatus'),
  assignDeviceId: document.getElementById('assignDeviceId'),
  assignPatientId: document.getElementById('assignPatientId'),
  assignPatientName: document.getElementById('assignPatientName'),
  assignRoom: document.getElementById('assignRoom'),
  assignBed: document.getElementById('assignBed'),
  refreshBtn: document.getElementById('refreshBtn'),
  demoBtn: document.getElementById('demoBtn'),
  searchInput: document.getElementById('searchInput')
};

const viewCopy = {
  command: ['Clinician Command Center', 'Live watch vitals, ECG snapshots, and patient alerts.'],
  patients: ['Patients', 'Search and review latest patient watch readings.'],
  ecg: ['ECG Review', 'Review captured ECG strips and signal metadata.'],
  devices: ['Devices', 'Monitor watch IDs, last upload time, and sync source.'],
  assignments: ['Assign Watches', 'Assign a watch/device to a patient, room, and bed from the Command Center.'],
  settings: ['Settings', 'Dashboard endpoint details and display configuration.']
};

async function fetchReadings() {
  const [readingRes, assignmentRes] = await Promise.all([
    fetch('/api/readings'),
    fetch('/api/assignments')
  ]);
  const readingData = await readingRes.json();
  const assignmentData = await assignmentRes.json();
  state.readings = readingData.readings || [];
  state.assignments = assignmentData.assignments || [];
  state.devices = assignmentData.devices || [];
  if (!state.selectedEcgId && state.readings.length) {
    const firstEcg = state.readings.find(hasEcgValues);
    if (firstEcg) state.selectedEcgId = firstEcg.id;
  }
  render();
}

async function addDemoReading() {
  await fetch('/api/demo-reading', { method: 'POST' });
  await fetchReadings();
}

async function saveAssignment(e) {
  e.preventDefault();
  const payload = {
    deviceId: els.assignDeviceId.value.trim(),
    patientId: els.assignPatientId.value.trim(),
    patientName: els.assignPatientName.value.trim(),
    room: els.assignRoom.value.trim(),
    bed: els.assignBed.value.trim()
  };
  if (!payload.deviceId || !payload.patientId) return;
  const res = await fetch('/api/assignments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (res.ok) {
    els.assignmentStatus.textContent = `Saved assignment for ${payload.deviceId}. New readings from that watch will appear under ${payload.patientId}.`;
    els.assignmentForm.reset();
    await fetchReadings();
  } else {
    els.assignmentStatus.textContent = 'Could not save assignment.';
  }
}

async function unassignDevice(deviceId) {
  await fetch(`/api/assignments/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
  await fetchReadings();
}

function setView(view) {
  state.view = view;
  els.navItems.forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  els.views.forEach(panel => panel.classList.toggle('active', panel.id === `view-${view}`));
  const [title, subtitle] = viewCopy[view] || viewCopy.command;
  els.viewTitle.textContent = title;
  els.viewSubtitle.textContent = subtitle;
  render();
}

function latestByPatient(readings) {
  const map = new Map();
  for (const r of readings) if (!map.has(r.patientId)) map.set(r.patientId, r);
  return Array.from(map.values());
}

function render() {
  const latest = latestByPatient(state.readings);
  const filtered = latest.filter(r => {
    const q = state.query.toLowerCase().trim();
    if (!q) return true;
    return [r.patientId, r.patientName, r.room, r.deviceId].join(' ').toLowerCase().includes(q);
  });
  const alertReadings = latest.filter(r => (r.alerts || []).length > 0);
  const ecgReadings = state.readings.filter(hasEcgValues);

  els.activePatients.textContent = latest.length;
  els.openAlerts.textContent = alertReadings.reduce((n, r) => n + r.alerts.length, 0);
  els.ecgCaptured.textContent = ecgReadings.length;
  els.connectedDevices.textContent = new Set(state.devices.map(d => d.deviceId)).size || new Set(latest.map(r => r.deviceId || r.watchId || r.watchModel)).size;

  els.patientList.innerHTML = filtered.length ? filtered.map(patientCard).join('') : `<div class="empty">No patient readings found.</div>`;
  els.alertList.innerHTML = alertReadings.length ? alertReadings.flatMap(r => r.alerts.map(a => alertCard(r, a))).join('') : `<div class="empty">No open alerts.</div>`;
  els.patientsTable.innerHTML = latest.length ? latest.map(patientRow).join('') : `<div class="empty">No patients yet.</div>`;
  els.ecgQueue.innerHTML = ecgReadings.length ? ecgReadings.map(ecgQueueItem).join('') : `<div class="empty">No ECG readings captured yet.</div>`;
  els.devicesTable.innerHTML = state.devices.length ? state.devices.map(deviceRow).join('') : `<div class="empty">No devices reporting yet.</div>`;
  if (els.assignmentsTable) els.assignmentsTable.innerHTML = state.devices.length ? state.devices.map(assignmentRow).join('') : `<div class="empty">No devices yet. Take a watch reading or save an assignment.</div>`;

  requestAnimationFrame(() => { drawAllEcg(); renderEcgViewer(); });
}

function patientCard(r) {
  const alertLevel = (r.alerts || []).length ? 'danger' : r.ecgStatus === 'Pending' ? 'warn' : '';
  const badgeText = (r.alerts || []).length ? `${r.alerts.length} Alert${r.alerts.length > 1 ? 's' : ''}` : 'Stable';
  return `<article class="patient-card" data-id="${escapeHtml(r.id)}">
      <div class="patient-main"><strong>${escapeHtml(r.patientName)}</strong><span>${escapeHtml(r.patientId)} • ${escapeHtml(r.room)}</span><br /><span>${timeAgo(r.capturedAtEpochMs)} • ${escapeHtml(r.deviceId || r.watchModel || 'Galaxy Watch')}</span></div>
      <div class="vitals"><div class="vital"><span>Est. BP</span><strong>${r.systolic}/${r.diastolic}</strong></div><div class="vital"><span>HR</span><strong>${r.heartRateBpm}</strong></div></div>
      <canvas class="ecg" data-ecg='${JSON.stringify(ecgValues(r))}'></canvas>
      <div><span class="badge ${alertLevel}">${badgeText}</span><div class="subtle" style="margin-top:8px">${escapeHtml(r.confidenceLabel || 'Estimate only')}</div><div class="subtle">ECG: ${escapeHtml(r.ecgStatus || 'Captured')}</div></div>
    </article>`;
}

function patientRow(r) {
  return `<div class="table-row"><div><strong>${escapeHtml(r.patientName)}</strong><span>${escapeHtml(r.patientId)} • ${escapeHtml(r.room)}</span></div><div>${r.systolic}/${r.diastolic}</div><div>HR ${r.heartRateBpm}</div><div>${timeAgo(r.capturedAtEpochMs)}</div><button class="mini-btn" data-go-ecg="${escapeHtml(r.id)}">ECG</button></div>`;
}

function deviceRow(d) {
  const a = d.assignment;
  const latest = d.latestReading;
  return `<div class="table-row device-row"><div><strong>${escapeHtml(d.deviceId)}</strong><span>${a ? `${escapeHtml(a.patientId)} • ${escapeHtml(a.room || 'Unassigned')} ${escapeHtml(a.bed || '')}` : 'Unassigned'}</span></div><div>${latest ? `${latest.systolic}/${latest.diastolic}` : '--/--'}</div><div>${latest ? `HR ${latest.heartRateBpm}` : 'No reading'}</div><div>${latest ? timeAgo(latest.capturedAtEpochMs) : 'Never'}</div><button class="mini-btn" data-prefill-device="${escapeHtml(d.deviceId)}">Assign</button></div>`;
}

function assignmentRow(d) {
  const a = d.assignment;
  return `<div class="table-row assignment-row"><div><strong>${escapeHtml(d.deviceId)}</strong><span>${a ? 'Assigned' : 'Unassigned'}</span></div><div>${escapeHtml(a?.patientId || '—')}</div><div>${escapeHtml(a?.patientName || '—')}</div><div>${escapeHtml([a?.room, a?.bed].filter(Boolean).join(' • ') || '—')}</div><button class="mini-btn" data-prefill-device="${escapeHtml(d.deviceId)}">Edit</button></div>`;
}

function ecgQueueItem(r) {
  const active = r.id === state.selectedEcgId ? 'active' : '';
  return `<button class="ecg-item ${active}" data-ecg-id="${escapeHtml(r.id)}"><strong>${escapeHtml(r.patientName)}</strong><span>${escapeHtml(r.patientId)} • ${timeAgo(r.capturedAtEpochMs)}</span><small>${escapeHtml(r.ecg?.rhythmLabel || r.ecgRhythm || 'Captured')}</small></button>`;
}

function alertCard(r, alert) {
  return `<article class="alert-card"><strong>${escapeHtml(alert)}</strong><div>${escapeHtml(r.patientName)} • ${escapeHtml(r.room)}</div><div class="subtle">${r.systolic}/${r.diastolic} • HR ${r.heartRateBpm} • ${timeAgo(r.capturedAtEpochMs)}</div></article>`;
}

function renderEcgViewer() {
  const r = state.readings.find(x => x.id === state.selectedEcgId) || state.readings.find(hasEcgValues);
  const canvas = els.ecgViewerCanvas;
  if (!r) { els.ecgViewerSubtitle.textContent = 'Choose a captured ECG'; els.ecgViewerMeta.textContent = 'No ECG selected.'; els.ecgViewerStats.innerHTML = ''; drawEcg(canvas, []); return; }
  const values = ecgValues(r);
  els.ecgViewerSubtitle.textContent = `${r.patientName} • ${r.patientId}`;
  els.ecgViewerMeta.innerHTML = `<strong>${escapeHtml(r.ecg?.rhythmLabel || r.ecgRhythm || 'ECG captured')}</strong><span>${escapeHtml(r.room || 'Unassigned')} • ${new Date(r.capturedAtEpochMs).toLocaleString()}</span>`;
  els.ecgViewerStats.innerHTML = `<span>Samples: ${values.length}</span><span>HR: ${r.heartRateBpm}</span><span>BP: ${r.systolic}/${r.diastolic}</span><span>Device: ${escapeHtml(r.deviceId || r.watchModel || 'Watch')}</span>`;
  drawEcg(canvas, values, { large: true });
}

function drawAllEcg() { document.querySelectorAll('canvas.ecg').forEach(canvas => drawEcg(canvas, JSON.parse(canvas.dataset.ecg || '[]'))); }
function drawEcg(canvas, values, opts = {}) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, rect.width * dpr); canvas.height = Math.max(1, rect.height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = 'rgba(142, 209, 255, 0.16)'; ctx.lineWidth = 1;
  const gx = opts.large ? 24 : 16; const gy = opts.large ? 20 : 14;
  for (let x = 0; x < rect.width; x += gx) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, rect.height); ctx.stroke(); }
  for (let y = 0; y < rect.height; y += gy) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(rect.width, y); ctx.stroke(); }
  if (!values.length) return;
  ctx.strokeStyle = '#8ed1ff'; ctx.lineWidth = opts.large ? 2.5 : 2; ctx.beginPath();
  values.forEach((v, i) => { const x = (i / Math.max(values.length - 1, 1)) * rect.width; const y = rect.height / 2 - Number(v) * (opts.large ? 42 : 20); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
  ctx.stroke();
}

function hasEcgValues(r) { return ecgValues(r).length > 0; }
function ecgValues(r) { if (Array.isArray(r.ecgPreview)) return r.ecgPreview.map(Number).filter(Number.isFinite); if (Array.isArray(r.ecg?.preview)) return r.ecg.preview.map(Number).filter(Number.isFinite); const csv = r.ecg?.stripPreviewCsv || r.stripPreviewCsv || r.ecgStripPreviewCsv; if (typeof csv === 'string' && csv.trim()) return csv.split(',').map(Number).filter(Number.isFinite).slice(0, 480); return []; }
function timeAgo(ms) { const diff = Math.max(0, Date.now() - Number(ms || Date.now())); const min = Math.floor(diff / 60000); if (min < 1) return 'Just now'; if (min < 60) return `${min}m ago`; const hrs = Math.floor(min / 60); if (hrs < 24) return `${hrs}h ago`; return new Date(ms).toLocaleString(); }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[ch])); }

els.navItems.forEach(btn => btn.addEventListener('click', () => setView(btn.dataset.view)));
els.refreshBtn.addEventListener('click', fetchReadings);
els.demoBtn.addEventListener('click', addDemoReading);
els.searchInput.addEventListener('input', e => { state.query = e.target.value; render(); });
if (els.assignmentForm) els.assignmentForm.addEventListener('submit', saveAssignment);
document.addEventListener('click', e => {
  const ecgBtn = e.target.closest('[data-ecg-id]'); if (ecgBtn) { state.selectedEcgId = ecgBtn.dataset.ecgId; render(); }
  const goEcg = e.target.closest('[data-go-ecg]'); if (goEcg) { state.selectedEcgId = goEcg.dataset.goEcg; setView('ecg'); }
  const prefill = e.target.closest('[data-prefill-device]');
  if (prefill) {
    const deviceId = prefill.dataset.prefillDevice;
    const d = state.devices.find(x => x.deviceId === deviceId);
    const a = d?.assignment || {};
    els.assignDeviceId.value = deviceId;
    els.assignPatientId.value = a.patientId || '';
    els.assignPatientName.value = a.patientName || '';
    els.assignRoom.value = a.room || '';
    els.assignBed.value = a.bed || '';
    setView('assignments');
  }
});

fetchReadings();
setInterval(fetchReadings, 5000);
