const assert = require('assert');
const XLSX = require('xlsx');

const { parseWorkbook } = require('../services/excelParser');
const { analyzeAttendance } = require('../services/attendanceAnalyzer');
const { answerQuestion } = require('../services/agentSearch');

function timeFraction(hours, minutes) {
  return (hours * 60 + minutes) / 1440;
}

function getMerges() {
  return [
    {
      s: { r: 0, c: 8 },
      e: { r: 0, c: 10 }
    },
    {
      s: { r: 0, c: 11 },
      e: { r: 0, c: 13 }
    },
    {
      s: { r: 0, c: 14 },
      e: { r: 0, c: 16 }
    }
  ];
}

function buildBaseRows(dataRows) {
  const headerRow1 = Array(21).fill(null);

  headerRow1[8] = 'Staffed Time (hours)';
  headerRow1[11] = 'Log IN time';
  headerRow1[14] = 'Log OUT Time';

  const headerRow2 = [
    'Subsidiary',
    'LOB',
    'HR ID',
    'Team Leader',
    'Agent Name',
    'Agent ID',
    'Sprinklr User',
    'Status',
    'Actual',
    'Schedule',
    'VS',
    'Actual',
    'Schedule',
    'diff (min)',
    'Actual',
    'Schedule',
    'diff (min)',
    'Approved Log IN?',
    'Approved Log OUT?',
    'Comments',
    'WFM Comments'
  ];

  return [headerRow1, headerRow2, ...dataRows];
}

function makeSheet(rows) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!merges'] = getMerges();

  return worksheet;
}

function buildTestWorkbook() {
  const workbook = XLSX.utils.book_new();

  const voiceRows = buildBaseRows([
    [
      'SEI',
      'SEI - HHP',
      'H1',
      'TL One',
      'Barbu, Oana Diana',
      'A1',
      'sprinklr.barbu',
      'Active',
      8,
      8,
      null,
      timeFraction(9, 0),
      timeFraction(9, 0),
      0,
      timeFraction(19, 36),
      timeFraction(20, 0),
      -24,
      null,
      'Yes',
      'Medical appointment',
      'Verified by WFM'
    ],
    [
      'SEI',
      'SEI - HHP',
      'H2',
      'TL One',
      'Agent Overtime',
      'A2',
      'sprinklr.overtime',
      'Active',
      8,
      8,
      null,
      timeFraction(9, 0),
      timeFraction(9, 0),
      0,
      timeFraction(20, 24),
      timeFraction(20, 0),
      24,
      null,
      'Yes',
      null,
      null
    ],
    [
      'SEI',
      'SEI - Digital',
      'H3',
      'TL Two',
      'Agent Unapproved',
      'A3',
      'sprinklr.unapproved',
      'Active',
      8,
      8,
      null,
      timeFraction(9, 0),
      timeFraction(9, 0),
      0,
      timeFraction(19, 50),
      timeFraction(20, 0),
      -10,
      null,
      'No',
      null,
      null
    ],
    [
      'SEI',
      'SEI - Digital',
      'H4',
      'TL Two',
      'Agent Late Login',
      'A4',
      'sprinklr.late',
      'Active',
      8,
      8,
      null,
      timeFraction(9, 15),
      timeFraction(9, 0),
      -15,
      timeFraction(20, 0),
      timeFraction(20, 0),
      0,
      'Yes',
      null,
      'Approved by supervisor',
      null
    ],
    [
      'SEI',
      'SEI - Digital',
      'H5',
      'TL Two',
      'Agent Wrong Approval',
      'A5',
      'sprinklr.wrong',
      'Active',
      8,
      8,
      null,
      timeFraction(9, 0),
      timeFraction(9, 0),
      0,
      timeFraction(19, 55),
      timeFraction(20, 0),
      -5,
      'Yes',
      null,
      null,
      null
    ],
    [
      'SEI',
      'SEI - HHP',
      'H6',
      'TL One',
      'Agent Split',
      'A6',
      'sprinklr.split',
      'Active',
      7.5,
      8,
      'SPLIT',
      timeFraction(9, 0),
      timeFraction(9, 0),
      0,
      timeFraction(20, 0),
      timeFraction(20, 0),
      0,
      null,
      null,
      'Split shift',
      null
    ]
  ]);

  const nonVoiceRows = buildBaseRows([
    [
      'SEI',
      'SEI - Back Office',
      'H7',
      'TL Three',
      'Agent NonVoice',
      'A7',
      'sprinklr.nonvoice',
      'Active',
      8,
      8,
      null,
      timeFraction(10, 0),
      timeFraction(10, 0),
      0,
      timeFraction(19, 0),
      timeFraction(19, 0),
      0,
      null,
      null,
      null,
      null
    ]
  ]);

  const summaryRows = [
    ['Unauthorized sheet', 'This must be ignored'],
    ['Total', 999]
  ];

  XLSX.utils.book_append_sheet(workbook, makeSheet(voiceRows), 'SEI Voice');
  XLSX.utils.book_append_sheet(workbook, makeSheet(nonVoiceRows), 'SEI Non-Voice');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'Summary');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error.message);
    failed += 1;
    process.exitCode = 1;
  }
}

const buffer = buildTestWorkbook();
const parsed = parseWorkbook(buffer);
const analysis = analyzeAttendance(parsed.records, []);

test('Test 8 — Missing SEGER worksheet is handled with warning', () => {
  assert.ok(parsed.missingSheets.includes('SEGER'));
  assert.ok(
    parsed.warnings.some((warning) => warning.includes('Missing authorized worksheet'))
  );
});

test('Test 9 — Unauthorized worksheets are ignored', () => {
  assert.ok(!parsed.records.some((record) => record.sheet === 'Summary'));
  assert.ok(parsed.ignoredSheets.includes('Summary'));
});

test('Parser reads records from authorized sheets only', () => {
  assert.ok(parsed.records.length > 0);
  assert.ok(parsed.records.every((record) =>
    ['SEI Voice', 'SEI Non-Voice'].includes(record.sheet)
  ));
});

test('Test 1 — Early logout approved with negative difference', () => {
  const finding = analysis.approvedExceptions.find(
    (item) => item.agentName === 'Barbu, Oana Diana' && item.category === 'early_out'
  );

  assert.ok(finding, 'Expected approved early OUT finding for Barbu, Oana Diana.');
  assert.strictEqual(finding.diffMinutes, -24);
  assert.strictEqual(finding.approved, true);
  assert.strictEqual(finding.diffDisplay, '-24 minutes');
});

test('Test 2 — Overtime approved with positive difference and no minus sign', () => {
  const finding = analysis.approvedExceptions.find(
    (item) => item.agentName === 'Agent Overtime' && item.category === 'overtime'
  );

  assert.ok(finding, 'Expected approved overtime finding.');
  assert.strictEqual(finding.diffMinutes, 24);
  assert.strictEqual(finding.diffDisplay, '24 minutes');
  assert.ok(!finding.diffDisplay.includes('-'));
});

test('Test 3 — Unapproved logout difference is not an approved exception', () => {
  const approved = analysis.approvedExceptions.find(
    (item) => item.agentName === 'Agent Unapproved' && item.category === 'early_out'
  );

  assert.strictEqual(approved, undefined);

  const pending = analysis.pendingReview.find(
    (item) => item.agentName === 'Agent Unapproved' && item.category === 'early_out'
  );

  assert.ok(pending, 'Expected unapproved logout discrepancy in pending review.');
});

test('Test 4 — Approved late login keeps original negative diff but classifies Late IN from times', () => {
  const finding = analysis.approvedExceptions.find(
    (item) => item.agentName === 'Agent Late Login' && item.category === 'late_in'
  );

  assert.ok(finding, 'Expected approved Late IN finding.');
  assert.strictEqual(finding.issue, 'Late IN');
  assert.ok(finding.diffDisplay.includes('-15'));
  assert.strictEqual(finding.actual, '09:15');
  assert.strictEqual(finding.scheduled, '09:00');
  assert.strictEqual(finding.approved, true);
});

test('Test 5 — Logout discrepancy must not use Approved Log IN? column', () => {
  const approvedLogout = analysis.approvedExceptions.find(
    (item) =>
      item.agentName === 'Agent Wrong Approval' &&
      ['early_out', 'overtime'].includes(item.category)
  );

  assert.strictEqual(approvedLogout, undefined);

  const pendingLogout = analysis.pendingReview.find(
    (item) =>
      item.agentName === 'Agent Wrong Approval' &&
      ['early_out', 'overtime'].includes(item.category)
  );

  assert.ok(pendingLogout, 'Expected logout discrepancy to be pending review.');
});

test('Test 6 — Comments are included in the same notification', () => {
  const finding = analysis.approvedExceptions.find(
    (item) => item.agentName === 'Barbu, Oana Diana' && item.category === 'early_out'
  );

  assert.ok(finding.comments.includes('Medical appointment'));
  assert.ok(finding.wfmComments.includes('Verified by WFM'));
});

test('Test 7 — LOB filter only returns selected LOB records', () => {
  const hhpAnalysis = analyzeAttendance(parsed.records, ['SEI - HHP']);

  assert.ok(hhpAnalysis.findings.length > 0);
  assert.ok(hhpAnalysis.findings.every((finding) => finding.lob === 'SEI - HHP'));

  const digitalAnalysis = analyzeAttendance(parsed.records, ['SEI - Digital']);

  assert.ok(digitalAnalysis.findings.length > 0);
  assert.ok(digitalAnalysis.findings.every((finding) => finding.lob === 'SEI - Digital'));
});

test('Staffed VS SPLIT is identified as meaningful staffed variance', () => {
  const finding = analysis.findings.find(
    (item) => item.agentName === 'Agent Split' && item.category === 'staffed_variance'
  );

  assert.ok(finding, 'Expected SPLIT staffed variance finding.');
  assert.ok(finding.diffDisplay.includes('SPLIT'));
});

test('Test 10 — Agent search returns findings for exact agent name', () => {
  const answer = answerQuestion({
    question: 'What are the attendance issues for Barbu, Oana Diana?',
    records: parsed.records,
    analysis,
    selectedLobs: [],
    context: {}
  });

  assert.ok(answer.cards, 'Expected cards for agent search.');
  assert.ok(answer.cards.length > 0);
  assert.ok(answer.cards.every((card) => card.agentName === 'Barbu, Oana Diana'));
});

test('Agent search answers LOB question', () => {
  const answer = answerQuestion({
    question: 'Which LOB does Barbu, Oana Diana belong to?',
    records: parsed.records,
    analysis,
    selectedLobs: [],
    context: {}
  });

  assert.ok(answer.text.includes('SEI - HHP'));
});

test('Aggregate question returns early logout cards in SEI Voice', () => {
  const answer = answerQuestion({
    question: 'Show all agents with early logout in SEI Voice.',
    records: parsed.records,
    analysis,
    selectedLobs: [],
    context: {}
  });

  assert.ok(answer.cards, 'Expected aggregate cards.');
  assert.ok(answer.cards.length > 0);
  assert.ok(answer.cards.every((card) => card.sheet === 'SEI Voice'));
  assert.ok(answer.cards.every((card) => ['early_out', 'early_out_extra'].includes(card.category)));
});

console.log(`\n${passed} passed, ${failed} failed.`);