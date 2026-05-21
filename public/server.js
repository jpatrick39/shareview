import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4001;
const AUTH_TOKEN = process.env.SHAREVIEW_TOKEN || 'dev-token';
const REQUIRE_AUTH = String(process.env.SHAREVIEW_REQUIRE_AUTH || 'false').toLowerCase() === 'true';

app.use(cors());
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const now = Date.now();

let assignments = [
  {
    deviceId: 'watch-001',
    patientId: 'P-1001',
    patientName: 'Demo Patient',
    room: 'Room 214',
    bed: 'Bed 1',
    active: true,
    updatedAtEpochMs: now
  }
];

let readings = [
  {
    id: crypto.randomUUID(),
    patientId: 'P-1001',
    patientName: 'Demo Patient',
    room: 'Room 214 • Bed 1',
    bed: 'Bed 1',
    deviceId: 'watch-001',
    capturedAtEpochMs: now - 1000 * 60 * 8,
    systolic: 122,
    diastolic: 78,
    heartRateBpm: 72,
    spo2Percent: 98,
    skinTemperatureC: 36.7,
    pttMs: 118.4,
    confidenceLabel: 'Estimate only',
    ecgStatus: 'Captured',
    ecgPreview: generateEcgPreview(90),
    ppgPreview: generatePpgPreview(90),
    ecg: { rhythmLabel: 'Captured', sampleCount: 90 },
    note: 'BP is estimation only',
    source: 'Galaxy Watch',
    watchModel: 'Galaxy Watch 7',
    calibrated: true
  }
];

function requireAuth(req, res, next) {
  if (!REQUIRE_AUTH || req.method === 'GET') return next();
  const header = req.headers.authorization || '';
  const expected = `Bearer ${AUTH_TOKEN}`;
  if (header !== expected) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
}

function generateEcgPreview(count = 90) {
  return Array.from({ length: count }, (_, i) => {
    const t = i / 7;
    const base = Math.sin(t) * 0.16;
    const spike = i % 22 === 0 ? 1.0 : i % 22 === 1 ? -0.35 : 0;
    return Number((base + spike).toFixed(3));
  });
}

function generatePpgPreview(count = 90) {
  return Array.from({ length: count }, (_, i) => {
    const wave = 520 + Math.sin(i / 8) * 38 + Math.sin(i / 2) * 4;
    return Number(wave.toFixed(2));
  });
}

function parseCsv(csv) {
  if (typeof csv !== 'string' || !csv.trim()) return [];
  return csv.split(',').map(Number).filter(Number.isFinite).slice(0, 480);
}

function parseEcgPreview(body) {
  if (Array.isArray(body.ecgPreview)) return body.ecgPreview.slice(0, 480).map(Number).filter(Number.isFinite);
  if (Array.isArray(body.ecg?.preview)) return body.ecg.preview.slice(0, 480).map(Number).filter(Number.isFinite);
  const csv = body.ecg?.stripPreviewCsv || body.stripPreviewCsv || body.ecgStripPreviewCsv;
  if (typeof csv === 'string' && csv.trim()) return parseCsv(csv);
  return generateEcgPreview(90);
}

function parsePpgPreview(body) {
  if (Array.isArray(body.ppgPreview)) return body.ppgPreview.slice(0, 480).map(Number).filter(Number.isFinite);
  if (Array.isArray(body.ppg?.preview)) return body.ppg.preview.slice(0, 480).map(Number).filter(Number.isFinite);
  return parseCsv(body.ppgPreviewCsv || body.ppg?.stripPreviewCsv || '');
}

function classifyReading(r) {
  const alerts = [];
  if (r.systolic >= 140 || r.diastolic >= 90) alerts.push('High estimated BP');
  if (r.systolic > 0 && (r.systolic <= 90 || r.diastolic <= 60)) alerts.push('Low estimated BP');
  if (r.heartRateBpm >= 110) alerts.push('High HR');
  if (r.heartRateBpm > 0 && r.heartRateBpm <= 50) alerts.push('Low HR');
  if (r.spo2Percent > 0 && r.spo2Percent < 92) alerts.push('Low SpO₂');
  if (!r.calibrated) alerts.push('Calibration needed');
  if (r.ecgStatus === 'Pending') alerts.push('ECG pending');
  return alerts;
}

function findAssignment(deviceId) {
  if (!deviceId) return null;
  return assignments.find(a => a.active !== false && String(a.deviceId) === String(deviceId)) || null;
}

function normalizeAssignment(body) {
  const deviceId = String(body.deviceId || body.watchId || '').trim();
  if (!deviceId) return null;
  return {
    deviceId,
    patientId: String(body.patientId || '').trim() || 'P-UNASSIGNED',
    patientName: String(body.patientName || '').trim() || 'Unassigned Patient',
    room: String(body.room || '').trim() || 'Unassigned',
    bed: String(body.bed || '').trim() || '',
    active: body.active !== false,
    updatedAtEpochMs: Date.now()
  };
}

function normalizeReading(body) {
  const bp = body.bp || {};
  const vitals = body.vitals || {};
  const deviceId = String(body.deviceId || body.watchId || 'unknown-device');
  const assignment = findAssignment(deviceId);
  const assignedRoom = assignment ? [assignment.room, assignment.bed].filter(Boolean).join(' • ') : null;

  const systolic = Number(body.systolic ?? body.systolicEstimate ?? bp.systolic ?? 0);
  const diastolic = Number(body.diastolic ?? body.diastolicEstimate ?? bp.diastolic ?? 0);
  const heartRateBpm = Number(body.heartRateBpm ?? body.heartRate ?? body.hr ?? body.pulse ?? vitals.heartRateBpm ?? bp.pulse ?? 0);
  const spo2Percent = Number(body.spo2Percent ?? body.spo2 ?? vitals.spo2Percent ?? 0);
  const skinTemperatureC = Number(body.skinTemperatureC ?? vitals.skinTemperatureC ?? 0);
  const ecgPreview = parseEcgPreview(body);
  const ppgPreview = parsePpgPreview(body);

  return {
    id: crypto.randomUUID(),
    patientId: assignment?.patientId || String(body.patientId || body.userId || body.devicePatientId || 'P-UNASSIGNED'),
    patientName: assignment?.patientName || String(body.patientName || 'Unassigned Patient'),
    room: assignedRoom || String(body.room || 'Unassigned'),
    bed: assignment?.bed || String(body.bed || ''),
    deviceId,
    capturedAtEpochMs: Number(body.capturedAtEpochMs || body.timestampEpochMs || body.timestamp || Date.now()),
    systolic,
    diastolic,
    heartRateBpm,
    spo2Percent,
    skinTemperatureC,
    pttMs: Number(body.pttMs || 0),
    confidenceLabel: String(body.confidenceLabel || body.confidence || 'Estimate only'),
    ecgStatus: String(body.ecgStatus || (body.ecg ? 'Captured' : 'Captured')),
    ecgPreview,
    ppgPreview,
    ecg: body.ecg || { rhythmLabel: body.ecgRhythm || 'Captured', sampleCount: ecgPreview.length },
    note: String(body.note || 'BP is estimation only'),
    source: String(body.source || 'Galaxy Watch'),
    watchModel: String(body.watchModel || 'Galaxy Watch'),
    calibrated: Boolean(body.calibrated ?? true)
  };
}

function addReadingFromBody(body) {
  const reading = normalizeReading(body || {});
  readings.unshift(reading);
  readings = readings.slice(0, 500);
  return { ...reading, alerts: classifyReading(reading) };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'shareview-health-dashboard', port: PORT });
});

app.get('/api/assignments', (_req, res) => {
  const latestByDevice = new Map();
  readings.forEach(r => {
    const key = r.deviceId || r.watchId || 'unknown-device';
    if (!latestByDevice.has(key)) latestByDevice.set(key, r);
  });

  const knownDevices = Array.from(new Set([
    ...assignments.map(a => a.deviceId),
    ...readings.map(r => r.deviceId || r.watchId).filter(Boolean)
  ])).map(deviceId => {
    const assignment = findAssignment(deviceId);
    const latest = latestByDevice.get(deviceId);
    return {
      deviceId,
      assignment,
      latestReading: latest ? {
        capturedAtEpochMs: latest.capturedAtEpochMs,
        systolic: latest.systolic,
        diastolic: latest.diastolic,
        heartRateBpm: latest.heartRateBpm,
        spo2Percent: latest.spo2Percent
      } : null
    };
  });

  res.json({ ok: true, assignments, devices: knownDevices });
});

app.post('/api/assignments', requireAuth, (req, res) => {
  const assignment = normalizeAssignment(req.body || {});
  if (!assignment) return res.status(400).json({ ok: false, error: 'deviceId is required' });
  assignments = assignments.filter(a => a.deviceId !== assignment.deviceId);
  assignments.unshift(assignment);
  res.status(201).json({ ok: true, assignment });
});

app.delete('/api/assignments/:deviceId', requireAuth, (req, res) => {
  const deviceId = String(req.params.deviceId || '');
  assignments = assignments.map(a => a.deviceId === deviceId ? { ...a, active: false, updatedAtEpochMs: Date.now() } : a);
  res.json({ ok: true });
});

app.get('/api/readings', (_req, res) => {
  const enriched = readings
    .slice()
    .sort((a, b) => b.capturedAtEpochMs - a.capturedAtEpochMs)
    .map(r => ({ ...r, alerts: classifyReading(r) }));
  res.json({ ok: true, readings: enriched });
});

app.post('/api/readings', requireAuth, (req, res) => {
  console.log('INCOMING WATCH BODY:', JSON.stringify(req.body, null, 2));
  const reading = addReadingFromBody(req.body || {});
  res.status(201).json({ ok: true, reading });
});

app.post('/api/ingest/watch-reading', requireAuth, (req, res) => {
  const reading = addReadingFromBody(req.body || {});
  res.status(201).json({ ok: true, reading });
});

app.post('/api/demo-reading', (_req, res) => {
  const n = readings.length + 1;
  const deviceId = `watch-00${(n % 3) + 1}`;
  const demo = addReadingFromBody({
    deviceId,
    patientId: `P-${1000 + ((n % 4) + 1)}`,
    patientName: `Demo Patient ${(n % 4) + 1}`,
    room: `Room ${210 + n}`,
    systolic: 112 + Math.round(Math.random() * 42),
    diastolic: 70 + Math.round(Math.random() * 24),
    heartRateBpm: 62 + Math.round(Math.random() * 38),
    spo2Percent: 95 + Math.round(Math.random() * 4),
    ppgPreviewCsv: generatePpgPreview(90).join(','),
    ecgStatus: 'Captured',
    note: 'Demo reading'
  });
  res.status(201).json({ ok: true, reading: demo });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`ShareView Health dashboard running on http://localhost:${PORT}`);
  console.log(`Ingest endpoint: POST http://<this-computer-ip>:${PORT}/api/readings`);
  console.log(`Assignments endpoint: POST http://<this-computer-ip>:${PORT}/api/assignments`);
});
