const express = require('express');
const path = require('path');
const multer = require('multer');
const { randomUUID } = require('crypto');

const { parseWorkbook } = require('./services/excelParser');
const { analyzeAttendance } = require('./services/attendanceAnalyzer');
const { getUniqueLobs } = require('./services/lobFilter');
const { answerQuestion } = require('./services/agentSearch');

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  },
  fileFilter(req, file, cb) {
    const allowed = /\.(xlsx|xlsm)$/i.test(file.originalname);

    if (!allowed) {
      return cb(new Error('Only .xlsx and .xlsm files are allowed.'));
    }

    return cb(null, true);
  }
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map();

function saveSession(data) {
  const id = randomUUID();

  sessions.set(id, {
    createdAt: Date.now(),
    ...data
  });

  return id;
}

setInterval(() => {
  const now = Date.now();
  const maxAgeMs = 2 * 60 * 60 * 1000;

  for (const [id, session] of sessions.entries()) {
    if (now - session.createdAt > maxAgeMs) {
      sessions.delete(id);
    }
  }
}, 15 * 60 * 1000).unref();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const parsed = parseWorkbook(req.file.buffer);
    const lobs = getUniqueLobs(parsed.records);
    const analysis = analyzeAttendance(parsed.records, []);

    const uploadId = saveSession({
      fileName: req.file.originalname,
      records: parsed.records,
      sheets: parsed.sheets,
      availableSheets: parsed.availableSheets,
      missingSheets: parsed.missingSheets,
      ignoredSheets: parsed.ignoredSheets,
      warnings: parsed.warnings
    });

    return res.json({
      uploadId,
      fileName: req.file.originalname,
      availableSheets: parsed.availableSheets,
      missingSheets: parsed.missingSheets,
      ignoredSheets: parsed.ignoredSheets,
      warnings: parsed.warnings,
      lobs,
      summary: analysis.summary
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post('/api/analyze', (req, res) => {
  try {
    const { uploadId, lobs = [] } = req.body;

    const session = sessions.get(uploadId);
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found. Please upload the workbook again.' });
    }

    const analysis = analyzeAttendance(session.records, lobs);

    return res.json({ analysis });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/api/ask', (req, res) => {
  try {
    const { uploadId, question = '', lobs = [], context = {} } = req.body;

    const session = sessions.get(uploadId);
    if (!session) {
      return res.status(404).json({ error: 'Upload session not found. Please upload the workbook again.' });
    }

    const analysis = analyzeAttendance(session.records, lobs);

    const answer = answerQuestion({
      question,
      records: session.records,
      analysis,
      selectedLobs: lobs,
      context
    });

    return res.json(answer);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File is too large. Maximum size is 25 MB.' });
    }

    return res.status(400).json({ error: err.message });
  }

  if (err.message) {
    return res.status(400).json({ error: err.message });
  }

  return res.status(500).json({ error: 'Unexpected server error.' });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`SEI Attendance Analysis Bot running on port ${PORT}`);
});