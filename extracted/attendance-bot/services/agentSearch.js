const { normalizeText, approvalLabel } = require('./timeConverter');
const { filterRecordsByLob, getUniqueLobs } = require('./lobFilter');

function cleanName(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const matrix = [];

  for (let i = 0; i <= b.length; i += 1) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function nameScore(query, name) {
  const q = cleanName(query);
  const n = cleanName(name);

  if (!q || !n) return 0;
  if (q === n) return 1;
  if (n.includes(q) || q.includes(n)) return 0.92;

  const qTokens = q.split(' ').filter(Boolean);
  const nTokens = n.split(' ').filter(Boolean);

  let matchedScore = 0;

  for (const qToken of qTokens) {
    let best = 0;

    for (const nToken of nTokens) {
      const distance = levenshtein(qToken, nToken);
      const similarity = 1 - distance / Math.max(qToken.length, nToken.length);

      if (similarity > best) {
        best = similarity;
      }
    }

    if (best >= 0.8) {
      matchedScore += best;
    }
  }

  if (matchedScore > 0) {
    return (matchedScore / qTokens.length) * 0.95;
  }

  const fullDistance = levenshtein(q, n);
  return Math.max(0, 1 - fullDistance / Math.max(q.length, n.length));
}

function getKnownAgentNames(records) {
  return [...new Set(records.filter((r) => r.agentName).map((r) => normalizeText(r.agentName)))];
}

function findExactAgentRecords(records, question) {
  const q = normalizeText(question).toLowerCase();
  const names = getKnownAgentNames(records);

  const matchedNames = names
    .filter((name) => name && q.includes(name.toLowerCase()))
    .sort((a, b) => b.length - a.length);

  if (matchedNames.length === 0) return [];

  const primary = matchedNames[0];

  const acceptableNames = matchedNames.filter(
    (name) => name === primary || !primary.toLowerCase().includes(name.toLowerCase())
  );

  return records.filter((record) =>
    acceptableNames.includes(normalizeText(record.agentName))
  );
}

function findFuzzyAgentRecords(records, question) {
  const cleaned = question
    .replace(
      /what|show|me|all|attendance|issues|issue|exceptions|exception|agent|for|did|was|were|the|a|an|of|in|which|is|are|leave|early|late|overtime|approved|comments|comment|lob|actual|scheduled|logout|login|time|minutes|min|does|belong/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length < 3) {
    return { records: [], method: 'none', candidates: [] };
  }

  const names = getKnownAgentNames(records);
  const scored = [];

  for (const name of names) {
    const score = nameScore(cleaned, name);

    if (score >= 0.62) {
      scored.push({ name, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { records: [], method: 'none', candidates: [] };
  }

  const topScore = scored[0].score;
  const candidates = scored
    .filter((item) => topScore - item.score <= 0.08)
    .map((item) => item.name);

    const matchedRecords = records.filter((record) =>
    candidates.includes(normalizeText(record.agentName))
  );

  return {
    records: matchedRecords,
    method: candidates.length > 1 ? 'fuzzy' : 'fuzzy-single',
    candidates
  };
}

function detectCategories(question) {
  const q = normalizeText(question).toLowerCase();

  if (/early\s*(out|leave|logout)|left\s*early/.test(q)) {
    return ['early_out', 'early_out_extra'];
  }

  if (/overtime|ot\b/.test(q)) {
    return ['overtime'];
  }

  if (/late\s*(in|login|arrival)/.test(q)) {
    return ['late_in', 'early_in'];
  }

  if (/late\s*break/.test(q)) {
    return ['late_breaks'];
  }

  if (/outage/.test(q)) {
    return ['outage', 'outage_not_approved'];
  }

  if (/staffed/.test(q)) {
    return ['staffed_variance', 'staffed_calculated_discrepancy'];
  }

  return null;
}

function detectSheets(question) {
  const q = normalizeText(question).toLowerCase();
  const sheets = [];

  if (q.includes('seger')) sheets.push('SEGER');

  if (q.includes('sei voice') || q.includes('voice')) {
    sheets.push('SEI Voice');
  }

  if (
    q.includes('sei non-voice') ||
    q.includes('sei non voice') ||
    q.includes('non-voice') ||
    q.includes('non voice')
  ) {
    sheets.push('SEI Non-Voice');
  }

  return sheets;
}

function detectLobsInQuestion(question, records) {
  const q = normalizeText(question).toLowerCase();
  const lobs = getUniqueLobs(records);

  return lobs.filter((lob) => q.includes(normalizeText(lob).toLowerCase()));
}

function aggregateAnswer(question, baseRecords, analysis) {
  let findings = [...analysis.findings];

  const categories = detectCategories(question);
  const sheets = detectSheets(question);
  const lobs = detectLobsInQuestion(question, baseRecords);

  const approvedOnly =
    /approved/.test(question.toLowerCase()) &&
    !/unapproved|not approved|pending/.test(question.toLowerCase());

  const pendingOnly = /unapproved|not approved|pending|requires review/.test(
    question.toLowerCase()
  );

  if (sheets.length > 0) {
    findings = findings.filter((finding) =>
      sheets.some((sheet) =>
        normalizeText(finding.sheet).toLowerCase().includes(normalizeText(sheet).toLowerCase())
      )
    );
  }

  if (lobs.length > 0) {
    findings = findings.filter((finding) =>
      lobs.some(
        (lob) => normalizeText(finding.lob).toLowerCase() === normalizeText(lob).toLowerCase()
      )
    );
  }

  if (categories) {
    findings = findings.filter((finding) => categories.includes(finding.category));
  }

  if (approvedOnly) {
    findings = findings.filter((finding) => finding.approved === true);
  }

  if (pendingOnly) {
    findings = findings.filter((finding) => finding.requiresApproval && !finding.approved);
  }

  if (findings.length === 0) {
    return {
      type: 'text',
      text: 'No matching attendance findings were found for the selected LOBs and filters.'
    };
  }

  return {
    type: 'cards',
    text: `Found ${findings.length} attendance finding(s).`,
    cards: findings
  };
}

function answerAgent(question, agentRecords, analysis) {
  const q = normalizeText(question).toLowerCase();

  const agentFindings = analysis.findings.filter((finding) =>
    agentRecords.some((record) => record.sheet === finding.sheet && record.row === finding.row)
  );

  const agentNames = [...new Set(agentRecords.map((r) => r.agentName))].join(', ');

  if (/which lob|lob does|line of business/.test(q)) {
    return {
      type: 'text',
      text: agentRecords
        .map(
          (record) =>
            `${record.agentName} belongs to LOB: ${record.lob} (${record.sheet}, row ${record.row}).`
        )
        .join('\n')
    };
  }

  if (/comment|wfm/.test(q)) {
    return {
      type: 'text',
      text: agentRecords
        .map((record) => {
          const comments = record.comments || 'No comments';
          const wfmComments = record.wfmComments || 'No WFM comments';

          return `${record.agentName} (${record.lob}, ${record.sheet} row ${record.row}):\nComments: ${comments}\nWFM Comments: ${wfmComments}`;
        })
        .join('\n\n')
    };
  }

  if (
    (/actual logout|actual log out|logout time|log out time/.test(q) &&
      !/scheduled/.test(q)) ||
    /what was the actual logout/.test(q)
  ) {
    return {
      type: 'text',
      text: agentRecords
        .map(
          (record) =>
            `${record.agentName}: Actual Logout ${record.times.logoutActualDisplay || 'not available'} (${record.sheet}, row ${record.row}).`
        )
        .join('\n')
    };
  }

  if (/scheduled logout|scheduled log out/.test(q)) {
    return {
      type: 'text',
      text: agentRecords
        .map(
          (record) =>
            `${record.agentName}: Scheduled Logout ${record.times.logoutScheduleDisplay || 'not available'} (${record.sheet}, row ${record.row}).`
        )
        .join('\n')
    };
  }

  if (
    (/actual login|actual log in|login time/.test(q) && !/scheduled/.test(q)) ||
    /what was the actual login/.test(q)
  ) {
    return {
      type: 'text',
      text: agentRecords
        .map(
          (record) =>
            `${record.agentName}: Actual Login ${record.times.loginActualDisplay || 'not available'} (${record.sheet}, row ${record.row}).`
        )
        .join('\n')
    };
  }

  if (/scheduled login|scheduled log in/.test(q)) {
    return {
      type: 'text',
      text: agentRecords
        .map(
          (record) =>
            `${record.agentName}: Scheduled Login ${record.times.loginScheduleDisplay || 'not available'} (${record.sheet}, row ${record.row}).`
        )
        .join('\n')
    };
  }

  if (/login difference approved|approved log ?in|approved login/.test(q)) {
    return {
      type: 'text',
      text: agentRecords
        .map(
          (record) =>
            `${record.agentName}: Approved Log IN? ${approvalLabel(record.approvedLoginRaw)} (${record.sheet}, row ${record.row}).`
        )
        .join('\n')
    };
  }

  if (/logout difference approved|approved log ?out|approved logout/.test(q)) {
    return {
      type: 'text',
      text: agentRecords
        .map(
          (record) =>
            `${record.agentName}: Approved Log OUT? ${approvalLabel(record.approvedLogoutRaw)} (${record.sheet}, row ${record.row}).`
        )
        .join('\n')
    };
  }

  if (/approved overtime/.test(q)) {
    const overtimeCards = agentFindings.filter(
      (finding) => finding.category === 'overtime' && finding.approved
    );

    if (overtimeCards.length > 0) {
      return {
        type: 'cards',
        text: `Approved overtime for ${agentNames}:`,
        cards: overtimeCards
      };
    }

    return {
      type: 'text',
      text: `No approved overtime found for ${agentNames}.`
    };
  }

  if (/leave early|early out|early leave|left early/.test(q)) {
    const earlyCards = agentFindings.filter((finding) =>
      ['early_out', 'early_out_extra'].includes(finding.category)
    );

    if (earlyCards.length > 0) {
      return {
        type: 'cards',
        text: `Early logout findings for ${agentNames}:`,
        cards: earlyCards
      };
    }

    return {
      type: 'text',
      text: `No early logout found for ${agentNames}.`
    };
  }

  if (/late|how many minutes/.test(q) && !/break/.test(q)) {
    const lateCards = agentFindings.filter((finding) =>
      ['late_in', 'early_in'].includes(finding.category)
    );

    if (lateCards.length > 0) {
      return {
        type: 'cards',
        text: `Login discrepancy findings for ${agentNames}:`,
        cards: lateCards
      };
    }

    return {
      type: 'text',
      text: `No login lateness found for ${agentNames}.`
    };
  }

  if (agentFindings.length > 0) {
    return {
      type: 'cards',
      text: `Attendance findings for ${agentNames}:`,
      cards: agentFindings
    };
  }

  return {
    type: 'text',
    text: `No attendance exceptions found for ${agentNames} in the selected LOBs.`
  };
}

function helpAnswer() {
  return {
    type: 'text',
    text: [
      'I can answer questions from the uploaded attendance workbook.',
      '',
      'Examples:',
      '- What are the attendance issues for Barbu, Oana Diana?',
      '- Did this agent leave early?',
      '- Show all agents with early logout in SEI Voice.',
      '- Which agents have approved overtime in SEI Non-Voice?',
      '- Show all attendance discrepancies in SEI - HHP.'
    ].join('\n')
  };
}

function answerQuestion({ question = '', records = [], analysis = null, selectedLobs = [], context = {} }) {
  if (!analysis) {
    return { type: 'text', text: 'Upload an attendance workbook first.' };
  }

  const q = normalizeText(question).toLowerCase();
  if (!q) return helpAnswer();

  let baseRecords = filterRecordsByLob(records, selectedLobs);

  const exactAgentRecords = findExactAgentRecords(baseRecords, q);

  if (exactAgentRecords.length > 0) {
    return answerAgent(q, exactAgentRecords, analysis);
  }

  if (
    context?.agentName &&
    /(this agent|the agent|they|their|he|she|him|her)/.test(q)
  ) {
    const contextRecords = baseRecords.filter(
      (record) =>
        normalizeText(record.agentName).toLowerCase() ===
        normalizeText(context.agentName).toLowerCase()
    );

    if (contextRecords.length > 0) {
      return answerAgent(q, contextRecords, analysis);
    }
  }

  if (/(show|list|which|who|all agents|agents with|how many|give me)/.test(q)) {
    return aggregateAnswer(q, baseRecords, analysis);
  }

  const fuzzy = findFuzzyAgentRecords(baseRecords, q);

  if (fuzzy.records.length > 0) {
    const distinctNames = [...new Set(fuzzy.records.map((r) => normalizeText(r.agentName)))];

    if (fuzzy.method === 'fuzzy' && distinctNames.length > 1) {
      return {
        type: 'choose-agent',
        text: 'Multiple similar agent names were found. Please select the correct agent.',
        candidates: distinctNames
      };
    }

    return answerAgent(q, fuzzy.records, analysis);
  }

  if (/(show|list|all|discrepanc|exception|issue)/.test(q)) {
    return aggregateAnswer(q, baseRecords, analysis);
  }

  return helpAnswer();
}

module.exports = {
  answerQuestion,
  findExactAgentRecords,
  findFuzzyAgentRecords,
  nameScore
};