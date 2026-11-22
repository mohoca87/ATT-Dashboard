const XLSX = require("xlsx");
const {
  normalizeText,
  isEmptyValue,
  formatTimeValue,
  excelTimeToMinutes,
  parseDiffMinutes,
  parseNumber,
} = require("./timeConverter");

const AUTHORIZED_SHEETS = ["SEGER", "SEI Voice", "SEI Non-Voice"];

function normalizeSheetName(name) {
  return normalizeText(name).replace(/\s+/g, " ").toLowerCase();
}

function headerScore(row) {
  const cells = (row || []).map((value) => normalizeText(value).toLowerCase());
  const text = cells.join(" | ");

  let score = 0;

  const exactHeaders = [
    "actual",
    "schedule",
    "scheduled",
    "diff",
    "diff (min)",
    "difference",
    "vs",
    "comments",
  ];

  for (const header of exactHeaders) {
    if (cells.includes(header)) score += 3;
  }

  const phrases = [
    "approved log in",
    "approved log out",
    "agent name",
    "employee name",
    "staff name",
    "representative name",
    "lob",
    "line of business",
    "staffed",
    "log in",
    "log out",
    "login",
    "logout",
    "late breaks",
    "outage",
    "wfm comments",
  ];

  for (const phrase of phrases) {
    if (text.includes(phrase)) score += 2;
  }

  const actualCount = cells.filter((cell) => cell === "actual").length;
  const scheduleCount = cells.filter((cell) =>
    cell.startsWith("schedule"),
  ).length;
  const diffCount = cells.filter((cell) => cell.includes("diff")).length;

  if (actualCount >= 2) score += 4;
  if (scheduleCount >= 2) score += 4;
  if (diffCount >= 2) score += 4;

  return score;
}

function detectHeaderRow(rows) {
  let bestIndex = -1;
  let bestScore = 0;

  const maxRows = Math.min(rows.length, 30);

  for (let i = 0; i < maxRows; i += 1) {
    const score = headerScore(rows[i] || []);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }

  return bestScore >= 6 ? bestIndex : -1;
}

function findFallbackHeaderRow(rows) {
  const maxRows = Math.min(rows.length, 30);

  for (let i = 0; i < maxRows; i += 1) {
    const row = rows[i] || [];

    const textCells = row.filter(
      (value) => !isEmptyValue(value) && parseNumber(value) === null,
    ).length;

    if (textCells >= 2) {
      return i;
    }
  }

  return -1;
}

function detectGroupRow(worksheet, rows, headerIndex) {
  if (headerIndex <= 0) return null;

  const previousRow = rows[headerIndex - 1] || [];
  const text = previousRow
    .map((value) => normalizeText(value))
    .join(" ")
    .toLowerCase();

  const hasGroupTerms = /staffed|log\s*in|login|log\s*out|logout/.test(text);
  const hasMerges = (worksheet["!merges"] || []).some(
    (merge) => merge.s.r <= headerIndex - 1 && merge.e.r >= headerIndex - 1,
  );

  if (hasGroupTerms || hasMerges) {
    return headerIndex - 1;
  }

  return null;
}

function buildGroupRow(worksheet, rows, groupIndex) {
  if (groupIndex === null) return [];

  let row = rows[groupIndex] ? [...rows[groupIndex]] : [];
  const merges = (worksheet["!merges"] || []).filter(
    (merge) => merge.s.r <= groupIndex && merge.e.r >= groupIndex,
  );

  if (merges.length > 0) {
    for (const merge of merges) {
      const anchorValue = row[merge.s.c];
      row.length = Math.max(row.length, merge.e.c + 1);

      for (let c = merge.s.c; c <= merge.e.c; c += 1) {
        row[c] = anchorValue;
      }
    }
  } else {
    let lastValue = null;

    for (let c = 0; c < row.length; c += 1) {
      if (!isEmptyValue(row[c])) {
        lastValue = row[c];
      } else if (lastValue !== null) {
        row[c] = lastValue;
      }
    }
  }

  return row;
}

function assignStandaloneColumns(map, columnIndex, group, sub, full) {
  if (
    map.approvedLogin === undefined &&
    /approved\s*(log\s*in|login)/.test(full) &&
    !full.includes("log out") &&
    !full.includes("logout")
  ) {
    map.approvedLogin = columnIndex;
    return true;
  }

  if (
    map.approvedLogout === undefined &&
    /approved\s*(log\s*out|logout)/.test(full)
  ) {
    map.approvedLogout = columnIndex;
    return true;
  }

  if (map.wfmComments === undefined && /wfm\s*comments?/.test(full)) {
    map.wfmComments = columnIndex;
    return true;
  }

  if (
    map.comments === undefined &&
    /comments?/.test(sub || full) &&
    !full.includes("wfm")
  ) {
    map.comments = columnIndex;
    return true;
  }

  return false;
}

function assignAdditionalColumns(map, columnIndex, group, sub, full) {
  if (
    map.approvedLatenessBreaks === undefined &&
    /approved\s*lateness\s*breaks?/.test(full)
  ) {
    map.approvedLatenessBreaks = columnIndex;
    return true;
  }

  if (
    map.lateBreaks === undefined &&
    /late\s*breaks?/.test(full) &&
    !/approved/.test(full)
  ) {
    map.lateBreaks = columnIndex;
    return true;
  }

  if (
    map.lateInMin === undefined &&
    /late\s*in/.test(full) &&
    /min/.test(full)
  ) {
    map.lateInMin = columnIndex;
    return true;
  }

  if (
    map.earlyOutExtraTime === undefined &&
    /(early\s*out|extra\s*time)/.test(full) &&
    /min/.test(full)
  ) {
    map.earlyOutExtraTime = columnIndex;
    return true;
  }

  if (
    map.outageNotApprovedMin === undefined &&
    /outage\s*not\s*approved/.test(full)
  ) {
    map.outageNotApprovedMin = columnIndex;
    return true;
  }

  if (
    map.outageToRecover === undefined &&
    /outage\s*(to|not\s*to)?\s*recover|not\s*to\s*recover/.test(full)
  ) {
    map.outageToRecover = columnIndex;
    return true;
  }

  if (
    map.outageMin === undefined &&
    /outage/.test(full) &&
    !/not\s*approved|recover/.test(full)
  ) {
    map.outageMin = columnIndex;
    return true;
  }

  if (
    map.totalLateAfterApproval === undefined &&
    /total\s*late\s*minutes\s*after\s*approval/.test(full)
  ) {
    map.totalLateAfterApproval = columnIndex;
    return true;
  }

  if (
    map.totalLateMinutes === undefined &&
    /total\s*late\s*minutes/.test(full) &&
    !/after/.test(full)
  ) {
    map.totalLateMinutes = columnIndex;
    return true;
  }

  if (
    map.staffedTargetAdjusted === undefined &&
    /staffed\s*time\s*target\s*adjusted/.test(full)
  ) {
    map.staffedTargetAdjusted = columnIndex;
    return true;
  }

  if (
    map.staffedTarget === undefined &&
    /staffed\s*time\s*target/.test(full) &&
    !/adjusted/.test(full)
  ) {
    map.staffedTarget = columnIndex;
    return true;
  }

  if (
    map.approvedLeave === undefined &&
    /approved\s*leave/.test(full) &&
    !/unapproved/.test(full)
  ) {
    map.approvedLeave = columnIndex;
    return true;
  }

  if (map.unapprovedLeave === undefined && /unapproved\s*leave/.test(full)) {
    map.unapprovedLeave = columnIndex;
    return true;
  }

  return false;
}

function assignGroupedTimeColumns(map, columnIndex, group, sub, full) {
  const isStaffed = /staffed/.test(group) || /staffed/.test(full);
  const isLogin =
    /log\s*in|login/.test(group) ||
    (/log\s*in|login/.test(full) && !/log\s*out|logout/.test(full));
  const isLogout =
    /log\s*out|logout/.test(group) || /log\s*out|logout/.test(full);

  if (isStaffed) {
    if (map.staffedActual === undefined && /actual/.test(sub)) {
      map.staffedActual = columnIndex;
      return true;
    }

    if (map.staffedSchedule === undefined && /schedule/.test(sub)) {
      map.staffedSchedule = columnIndex;
      return true;
    }

    if (map.staffedVS === undefined && /(^vs$|variance|vs value)/.test(sub)) {
      map.staffedVS = columnIndex;
      return true;
    }
  }

  if (isLogin) {
    if (map.loginActual === undefined && /actual/.test(sub)) {
      map.loginActual = columnIndex;
      return true;
    }

    if (map.loginSchedule === undefined && /schedule/.test(sub)) {
      map.loginSchedule = columnIndex;
      return true;
    }

    if (map.loginDiff === undefined && /diff|difference|min/.test(sub)) {
      map.loginDiff = columnIndex;
      return true;
    }
  }

  if (isLogout) {
    if (map.logoutActual === undefined && /actual/.test(sub)) {
      map.logoutActual = columnIndex;
      return true;
    }

    if (map.logoutSchedule === undefined && /schedule/.test(sub)) {
      map.logoutSchedule = columnIndex;
      return true;
    }

    if (map.logoutDiff === undefined && /diff|difference|min/.test(sub)) {
      map.logoutDiff = columnIndex;
      return true;
    }
  }

  return false;
}

function assignBaseColumns(map, columnIndex, group, sub, full) {
  if (
    map.lob === undefined &&
    /\blob\b|line of business|lineofbusiness|business line|lob name|line of business \(lob\)|lob \(line of business\)/.test(
      full,
    )
  ) {
    map.lob = columnIndex;
    return;
  }

  if (
    map.subsidiary === undefined &&
    /subsidiary|company|entity|business unit/.test(full)
  ) {
    map.subsidiary = columnIndex;
    return;
  }

  if (
    map.hrId === undefined &&
    /(hr|employee|emp|personnel)\s*(id|number|no|code)|hrid|personnel\s*(id|number|no|code)/.test(
      full,
    )
  ) {
    map.hrId = columnIndex;
    return;
  }

  if (
    map.teamLeader === undefined &&
    /team\s*leader|tl\s*name|^tl$|supervisor|manager/.test(full)
  ) {
    map.teamLeader = columnIndex;
    return;
  }

  if (
    map.agentId === undefined &&
    /agent\s*id|staff\s*id|user\s*id|employee\s*id|emp\s*id/.test(full)
  ) {
    map.agentId = columnIndex;
    return;
  }

  if (map.sprinklrUser === undefined && /sprinklr/.test(full)) {
    map.sprinklrUser = columnIndex;
    return;
  }

  if (
    map.status === undefined &&
    /^status$|attendance\s*status|leave\s*status/.test(full)
  ) {
    map.status = columnIndex;
    return;
  }

  if (
    map.agentName === undefined &&
    /(agent\s*name|employee\s*name|staff\s*name|representative\s*name|rep\s*name|advisor\s*name|consultant\s*name|^agent$|^name$|full name|^employee$)/.test(
      full,
    ) &&
    !/id|user|sprinklr|login|log|logout/.test(full)
  ) {
    map.agentName = columnIndex;
  }
}

function mapColumns(groupRow, headerRow) {
  const map = {};
  const length = Math.max(groupRow.length, headerRow.length);

  for (let c = 0; c < length; c += 1) {
    const group = normalizeText(groupRow[c]).toLowerCase();
    const sub = normalizeText(headerRow[c]).toLowerCase();

    if (!group && !sub) continue;

    const full = [group, sub].filter(Boolean).join(" ").toLowerCase();

    if (assignStandaloneColumns(map, c, group, sub, full)) continue;
    if (assignAdditionalColumns(map, c, group, sub, full)) continue;
    if (assignGroupedTimeColumns(map, c, group, sub, full)) continue;

    assignBaseColumns(map, c, group, sub, full);
  }

  return map;
}

function getRawValue(row, columnIndex) {
  if (columnIndex === undefined || columnIndex === null) return null;
  return row[columnIndex] ?? null;
}

function getCell(worksheet, range, rowIndex, columnIndex) {
  if (columnIndex === undefined || columnIndex === null) return null;

  const address = XLSX.utils.encode_cell({
    r: range.s.r + rowIndex,
    c: columnIndex,
  });

  return worksheet[address] || null;
}

function parseVSValue(raw) {
  if (isEmptyValue(raw)) {
    return { meaningful: false, raw };
  }

  const num = parseNumber(raw);
  if (num !== null) {
    return {
      meaningful: Math.abs(num) > 0.0001,
      numeric: num,
      raw,
    };
  }

  const text = normalizeText(raw);
  const ignoredText = ["ok", "okay", "no", "no exception", "no variance"];

  if (ignoredText.includes(text.toLowerCase())) {
    return { meaningful: false, raw };
  }

  return { meaningful: true, text, raw };
}

function isIgnoredIdentifier(value) {
  const text = normalizeText(value).toLowerCase();

  return [
    "total",
    "totals",
    "grand total",
    "subtotal",
    "sum",
    "all agents",
    "total agents",
  ].includes(text);
}

function isEmptyDataRow(row, columnMap) {
  const identifierColumns = [
    columnMap.agentName,
    columnMap.agentId,
    columnMap.hrId,
  ].filter((columnIndex) => columnIndex !== undefined && columnIndex !== null);

  if (identifierColumns.length === 0) return true;

  return !identifierColumns.some((columnIndex) => {
    const value = row[columnIndex];

    return !isEmptyValue(value) && !isIgnoredIdentifier(value);
  });
}

function buildRecord(worksheet, range, row, rowIndex, columnMap, sheetName) {
  const excelRow = range.s.r + rowIndex + 1;

  const staffedActualRaw = getRawValue(row, columnMap.staffedActual);
  const staffedScheduleRaw = getRawValue(row, columnMap.staffedSchedule);
  const staffedVSRaw = getRawValue(row, columnMap.staffedVS);

  const loginActualRaw = getRawValue(row, columnMap.loginActual);
  const loginScheduleRaw = getRawValue(row, columnMap.loginSchedule);
  const loginDiffRaw = getRawValue(row, columnMap.loginDiff);

  const logoutActualRaw = getRawValue(row, columnMap.logoutActual);
  const logoutScheduleRaw = getRawValue(row, columnMap.logoutSchedule);
  const logoutDiffRaw = getRawValue(row, columnMap.logoutDiff);

  const loginDiffCell = getCell(
    worksheet,
    range,
    rowIndex,
    columnMap.loginDiff,
  );
  const logoutDiffCell = getCell(
    worksheet,
    range,
    rowIndex,
    columnMap.logoutDiff,
  );

  const lateBreaksRaw = getRawValue(row, columnMap.lateBreaks);
  const approvedLatenessBreaksRaw = getRawValue(
    row,
    columnMap.approvedLatenessBreaks,
  );
  const lateInRaw = getRawValue(row, columnMap.lateInMin);
  const earlyOutExtraRaw = getRawValue(row, columnMap.earlyOutExtraTime);
  const outageRaw = getRawValue(row, columnMap.outageMin);
  const outageNotApprovedRaw = getRawValue(row, columnMap.outageNotApprovedMin);
  const outageToRecoverRaw = getRawValue(row, columnMap.outageToRecover);
  const totalLateRaw = getRawValue(row, columnMap.totalLateMinutes);
  const totalLateAfterApprovalRaw = getRawValue(
    row,
    columnMap.totalLateAfterApproval,
  );
  const staffedTargetRaw = getRawValue(row, columnMap.staffedTarget);
  const staffedTargetAdjustedRaw = getRawValue(
    row,
    columnMap.staffedTargetAdjusted,
  );
  const approvedLeaveRaw = getRawValue(row, columnMap.approvedLeave);
  const unapprovedLeaveRaw = getRawValue(row, columnMap.unapprovedLeave);

  const lateBreaksCell = getCell(
    worksheet,
    range,
    rowIndex,
    columnMap.lateBreaks,
  );
  const lateInCell = getCell(worksheet, range, rowIndex, columnMap.lateInMin);
  const earlyOutExtraCell = getCell(
    worksheet,
    range,
    rowIndex,
    columnMap.earlyOutExtraTime,
  );
  const outageCell = getCell(worksheet, range, rowIndex, columnMap.outageMin);
  const outageNotApprovedCell = getCell(
    worksheet,
    range,
    rowIndex,
    columnMap.outageNotApprovedMin,
  );
  const totalLateCell = getCell(
    worksheet,
    range,
    rowIndex,
    columnMap.totalLateMinutes,
  );
  const totalLateAfterApprovalCell = getCell(
    worksheet,
    range,
    rowIndex,
    columnMap.totalLateAfterApproval,
  );

  const agentName =
    normalizeText(getRawValue(row, columnMap.agentName)) ||
    normalizeText(getRawValue(row, columnMap.agentId)) ||
    normalizeText(getRawValue(row, columnMap.hrId));

  return {
    sheet: sheetName,
    row: excelRow,

    subsidiary: normalizeText(getRawValue(row, columnMap.subsidiary)),
    lob: normalizeText(getRawValue(row, columnMap.lob)) || "Unspecified",
    hrId: normalizeText(getRawValue(row, columnMap.hrId)),
    tl: normalizeText(getRawValue(row, columnMap.teamLeader)),
    agentName,
    agentId: normalizeText(getRawValue(row, columnMap.agentId)),
    sprinklrUser: normalizeText(getRawValue(row, columnMap.sprinklrUser)),
    status: normalizeText(getRawValue(row, columnMap.status)),

    approvedLoginRaw: getRawValue(row, columnMap.approvedLogin),
    approvedLogoutRaw: getRawValue(row, columnMap.approvedLogout),

    comments: normalizeText(getRawValue(row, columnMap.comments)),
    wfmComments: normalizeText(getRawValue(row, columnMap.wfmComments)),

    staffed: {
      actualRaw: staffedActualRaw,
      scheduleRaw: staffedScheduleRaw,
      vsRaw: staffedVSRaw,
      actualHours: parseNumber(staffedActualRaw),
      scheduleHours: parseNumber(staffedScheduleRaw),
      vs: parseVSValue(staffedVSRaw),
    },

    times: {
      loginActualMinutes: excelTimeToMinutes(loginActualRaw),
      loginScheduleMinutes: excelTimeToMinutes(loginScheduleRaw),
      logoutActualMinutes: excelTimeToMinutes(logoutActualRaw),
      logoutScheduleMinutes: excelTimeToMinutes(logoutScheduleRaw),

      loginActualDisplay: formatTimeValue(loginActualRaw),
      loginScheduleDisplay: formatTimeValue(loginScheduleRaw),
      logoutActualDisplay: formatTimeValue(logoutActualRaw),
      logoutScheduleDisplay: formatTimeValue(logoutScheduleRaw),
    },

    diffs: {
      loginDiffMinutes: parseDiffMinutes(loginDiffRaw, loginDiffCell),
      logoutDiffMinutes: parseDiffMinutes(logoutDiffRaw, logoutDiffCell),

      lateBreaksMinutes: parseDiffMinutes(lateBreaksRaw, lateBreaksCell),
      lateInMinutes: parseDiffMinutes(lateInRaw, lateInCell),
      earlyOutExtraMinutes: parseDiffMinutes(
        earlyOutExtraRaw,
        earlyOutExtraCell,
      ),
      outageMinutes: parseDiffMinutes(outageRaw, outageCell),
      outageNotApprovedMinutes: parseDiffMinutes(
        outageNotApprovedRaw,
        outageNotApprovedCell,
      ),
      totalLateMinutes: parseDiffMinutes(totalLateRaw, totalLateCell),
      totalLateAfterApprovalMinutes: parseDiffMinutes(
        totalLateAfterApprovalRaw,
        totalLateAfterApprovalCell,
      ),
    },

    additionalRaw: {
      lateBreaks: lateBreaksRaw,
      approvedLatenessBreaks: approvedLatenessBreaksRaw,
      lateIn: lateInRaw,
      earlyOutExtra: earlyOutExtraRaw,
      outage: outageRaw,
      outageNotApproved: outageNotApprovedRaw,
      outageToRecover: outageToRecoverRaw,
      totalLate: totalLateRaw,
      totalLateAfterApproval: totalLateAfterApprovalRaw,
      staffedTarget: staffedTargetRaw,
      staffedTargetAdjusted: staffedTargetAdjustedRaw,
      approvedLeave: approvedLeaveRaw,
      unapprovedLeave: unapprovedLeaveRaw,
    },
  };
}

function parseSheet(worksheet, sheetName) {
  if (!worksheet["!ref"]) {
    throw new Error(`Worksheet "${sheetName}" appears to be empty.`);
  }

  const range = XLSX.utils.decode_range(worksheet["!ref"]);

  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });

  let headerIndex = detectHeaderRow(rows);

  if (headerIndex === -1) {
    headerIndex = findFallbackHeaderRow(rows);
  }

  if (headerIndex === -1) {
    throw new Error(
      `Could not detect a header row in worksheet "${sheetName}".`,
    );
  }

  const groupIndex = detectGroupRow(worksheet, rows, headerIndex);
  const groupRow = buildGroupRow(worksheet, rows, groupIndex);
  const headerRow = rows[headerIndex] || [];

  const columnMap = mapColumns(groupRow, headerRow);

  if (
    columnMap.agentName === undefined &&
    columnMap.agentId === undefined &&
    columnMap.hrId === undefined
  ) {
    throw new Error(
      `No agent identifier column found in worksheet "${sheetName}".`,
    );
  }

  const hasAttendanceColumns = [
    columnMap.loginActual,
    columnMap.loginSchedule,
    columnMap.loginDiff,
    columnMap.logoutActual,
    columnMap.logoutSchedule,
    columnMap.logoutDiff,
    columnMap.staffedActual,
    columnMap.staffedSchedule,
    columnMap.lateInMin,
    columnMap.earlyOutExtraTime,
    columnMap.outageMin,
    columnMap.totalLateMinutes,
  ].some((columnIndex) => columnIndex !== undefined && columnIndex !== null);

  if (!hasAttendanceColumns) {
    throw new Error(
      `No attendance time columns found in worksheet "${sheetName}".`,
    );
  }

  const records = [];

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i] || [];

    if (isEmptyDataRow(row, columnMap)) continue;

    const record = buildRecord(worksheet, range, row, i, columnMap, sheetName);
    records.push(record);
  }

  return {
    name: sheetName,
    headerRowIndex: headerIndex + 1,
    groupRowIndex: groupIndex === null ? null : groupIndex + 1,
    columnMap,
    records,
  };
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    cellDates: false,
    cellFormula: false,
    cellStyles: true,
  });

  const warnings = [];
  const records = [];
  const sheets = [];
  const availableSheets = [];
  const skippedSheets = [];

  const missingPreferredSheets = AUTHORIZED_SHEETS.filter(
    (authorizedName) =>
      !workbook.SheetNames.some(
        (sheetName) =>
          normalizeSheetName(sheetName) === normalizeSheetName(authorizedName),
      ),
  );

  if (missingPreferredSheets.length > 0) {
    warnings.push(
      `Preferred worksheet(s) not found: ${missingPreferredSheets.join(", ")}. Reading all available worksheets instead.`,
    );
  }

  // Read every worksheet in the uploaded workbook.
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];

    try {
      const parsedSheet = parseSheet(worksheet, sheetName);

      if (parsedSheet.records.length > 0) {
        sheets.push(parsedSheet);
        records.push(...parsedSheet.records);
        availableSheets.push(sheetName);
      } else {
        skippedSheets.push(sheetName);
        warnings.push(
          `Worksheet "${sheetName}" was skipped because no agent rows were found.`,
        );
      }
    } catch (error) {
      skippedSheets.push(sheetName);
      warnings.push(`Worksheet "${sheetName}" was skipped: ${error.message}`);
    }
  }

  if (records.length === 0) {
    warnings.push("No readable agent rows were found in any worksheet.");
  }

  return {
    records,
    sheets,
    availableSheets,
    missingSheets: missingPreferredSheets,
    ignoredSheets: skippedSheets,
    warnings,
  };
}

module.exports = {
  AUTHORIZED_SHEETS,
  parseWorkbook,
};
