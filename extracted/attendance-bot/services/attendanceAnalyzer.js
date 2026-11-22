const { randomUUID } = require("crypto");
const {
  normalizeText,
  isEmptyValue,
  isYes,
  approvalLabel,
  formatStaffedValue,
  formatSignedMinutes,
  parseNumber,
} = require("./timeConverter");
const { filterRecordsByLob } = require("./lobFilter");

function createFinding(record, properties) {
  return {
    id: randomUUID(),
    sheet: record.sheet,
    row: record.row,
    agentName: record.agentName || record.agentId || record.hrId || "Unknown",
    lob: record.lob || "Unspecified",
    tl: record.tl || "",
    agentId: record.agentId || "",
    hrId: record.hrId || "",

    category: "",
    issue: "",
    severity: "info",
    color: "gray",

    requiresApproval: false,
    approved: false,
    approvalStatus: "N/A",

    actual: "",
    scheduled: "",
    diffMinutes: null,
    diffDisplay: "",

    comments: record.comments || "",
    wfmComments: record.wfmComments || "",

    action: "",
    warnings: [],
    details: {},

    source: `${record.sheet} row ${record.row}`,

    ...properties,
  };
}

function analyzeStaffedTime(record) {
  const findings = [];

  const { actualRaw, scheduleRaw, vsRaw, actualHours, scheduleHours, vs } =
    record.staffed;

  if (vs.meaningful) {
    const vsText = normalizeText(vsRaw);

    findings.push(
      createFinding(record, {
        category: "staffed_variance",
        issue: /split/i.test(vsText)
          ? "Staffed Time VS: SPLIT"
          : "Staffed Time Variance",
        color: "blue",
        severity: "info",
        actual: formatStaffedValue(actualRaw),
        scheduled: formatStaffedValue(scheduleRaw),
        diffMinutes: vs.numeric ?? null,
        diffDisplay:
          vs.numeric !== null && vs.numeric !== undefined
            ? `${vs.numeric} h`
            : vsText,
        action: /split/i.test(vsText)
          ? "Verify the split shift arrangement and confirm staffed time is captured correctly."
          : "Check the difference between actual staffed hours and scheduled hours.",
      }),
    );

    return findings;
  }

  if (
    actualHours !== null &&
    scheduleHours !== null &&
    Math.abs(actualHours - scheduleHours) > 0.01
  ) {
    const diff = actualHours - scheduleHours;

    findings.push(
      createFinding(record, {
        category: "staffed_calculated_discrepancy",
        issue: "Staffed Time Calculated Discrepancy",
        color: "blue",
        severity: "info",
        actual: formatStaffedValue(actualRaw),
        scheduled: formatStaffedValue(scheduleRaw),
        diffMinutes: diff * 60,
        diffDisplay: `${diff.toFixed(2)} h (calculated)`,
        action:
          "Actual and Schedule differ while VS is blank. Confirm whether a VS value should be recorded.",
        warnings: [
          "VS is blank. This is a calculated discrepancy, not a recorded VS value.",
        ],
      }),
    );
  }

  return findings;
}

function analyzeLogin(record) {
  const findings = [];

  const actualMinutes = record.times.loginActualMinutes;
  const scheduledMinutes = record.times.loginScheduleMinutes;

  let diff = record.diffs.loginDiffMinutes;
  let diffSource = "Excel diff (min)";
  const warnings = [];

  const timeDiffers =
    actualMinutes !== null &&
    scheduledMinutes !== null &&
    actualMinutes !== scheduledMinutes;

  if ((diff === null || Math.round(diff) === 0) && timeDiffers) {
    diff = actualMinutes - scheduledMinutes;
    diffSource = "Calculated from Actual and Schedule";
    warnings.push(
      "Recorded login diff was blank or zero; difference calculated from Actual and Schedule.",
    );
  }

  if (
    diff === null &&
    record.diffs.lateInMinutes !== null &&
    Math.abs(record.diffs.lateInMinutes) > 0.0001
  ) {
    diff = record.diffs.lateInMinutes;
    diffSource = "Late IN (min)";
  }

  let type = null;

  if (timeDiffers) {
    type = actualMinutes > scheduledMinutes ? "Late IN" : "Early IN";
  } else if (diff !== null && Math.round(diff) !== 0) {
    type = diff > 0 ? "Late IN" : "Early IN";
    warnings.push(
      "Actual/Schedule login times were not available; classification based on diff sign.",
    );
  }

  const meaningful = (diff !== null && Math.round(diff) !== 0) || timeDiffers;

  if (!meaningful) return findings;

  const approved = isYes(record.approvedLoginRaw);
  const approvalStatus = approvalLabel(record.approvedLoginRaw);

  const color =
    type === "Late IN" ? "red" : type === "Early IN" ? "blue" : "gray";
  const issue = type || "Login Difference";

  const action = approved
    ? `Review the approved ${issue.toLowerCase()} exception and ensure it is documented.`
    : `Obtain or verify approval for the ${issue.toLowerCase()} and document the reason.`;

  findings.push(
    createFinding(record, {
      category: type === "Early IN" ? "early_in" : "late_in",
      issue,
      color,
      severity: type === "Late IN" ? "high" : "medium",
      requiresApproval: true,
      approved,
      approvalStatus,
      actual: record.times.loginActualDisplay,
      scheduled: record.times.loginScheduleDisplay,
      diffMinutes: diff,
      diffDisplay:
        diff === null ? "" : formatSignedMinutes(diff, { showPlus: true }),
      action,
      warnings,
      details: {
        diffSource,
        lateInField: record.diffs.lateInMinutes,
      },
    }),
  );

  return findings;
}

function analyzeLogout(record) {
  const findings = [];

  const actualMinutes = record.times.logoutActualMinutes;
  const scheduledMinutes = record.times.logoutScheduleMinutes;

  let diff = record.diffs.logoutDiffMinutes;
  let diffSource = "Excel diff (min)";
  const warnings = [];

  const timeDiffers =
    actualMinutes !== null &&
    scheduledMinutes !== null &&
    actualMinutes !== scheduledMinutes;

  if ((diff === null || Math.round(diff) === 0) && timeDiffers) {
    diff = actualMinutes - scheduledMinutes;
    diffSource = "Calculated from Actual and Schedule";
    warnings.push(
      "Recorded logout diff was blank or zero; difference calculated from Actual and Schedule.",
    );
  }

  let classification = null;

  if (diff !== null && Math.round(diff) !== 0) {
    classification = diff < 0 ? "Early OUT" : "Overtime";
  }

  if (timeDiffers) {
    const timeClassification =
      actualMinutes < scheduledMinutes ? "Early OUT" : "Overtime";

    if (classification && classification !== timeClassification) {
      warnings.push(
        `Recorded difference sign (${diff}) conflicts with Actual/Schedule times. Verify the source value.`,
      );
    }

    if (!classification) {
      classification = timeClassification;
    }
  }

  const meaningful = (diff !== null && Math.round(diff) !== 0) || timeDiffers;

  if (!meaningful) return findings;

  const approved = isYes(record.approvedLogoutRaw);
  const approvalStatus = approvalLabel(record.approvedLogoutRaw);

  const category =
    classification === "Early OUT"
      ? "early_out"
      : classification === "Overtime"
        ? "overtime"
        : "logout_difference";

  const color =
    classification === "Early OUT"
      ? "red"
      : classification === "Overtime"
        ? "orange"
        : "gray";

  const diffDisplay =
    classification === "Overtime"
      ? `${Math.round(diff)} minutes`
      : formatSignedMinutes(diff);

  let action;

  if (approved) {
    if (classification === "Early OUT") {
      action =
        "Review the approved early-leave record and verify that the reason is properly documented.";
    } else if (classification === "Overtime") {
      action =
        "Verify that the additional working time was authorized and documented.";
    } else {
      action =
        "Review the approved logout discrepancy and verify documentation.";
    }
  } else {
    if (classification === "Early OUT") {
      action =
        "Obtain approval or explanation for the early logout and document the reason.";
    } else if (classification === "Overtime") {
      action =
        "Verify whether the overtime was authorized; obtain documentation if missing.";
    } else {
      action = "Review the logout discrepancy and its approval status.";
    }
  }

  findings.push(
    createFinding(record, {
      category,
      issue: classification || "Logout Difference",
      color,
      severity: classification === "Early OUT" ? "high" : "medium",
      requiresApproval: true,
      approved,
      approvalStatus,
      actual: record.times.logoutActualDisplay,
      scheduled: record.times.logoutScheduleDisplay,
      diffMinutes: diff,
      diffDisplay,
      action,
      warnings,
      details: {
        diffSource,
        earlyOutField: record.diffs.earlyOutExtraMinutes,
      },
    }),
  );

  return findings;
}

function isMeaningfulLeaveValue(value) {
  if (isEmptyValue(value)) return false;

  const text = normalizeText(value).toLowerCase();
  if (["no", "n", "false", "0"].includes(text)) return false;

  const num = parseNumber(value);
  if (num !== null) return Math.abs(num) > 0.0001;

  return true;
}

function analyzeAdditional(record, existingTimeFindings) {
  const findings = [];

  const hasLogoutFinding = existingTimeFindings.some((finding) =>
    ["early_out", "overtime", "logout_difference"].includes(finding.category),
  );

  const hasLoginFinding = existingTimeFindings.some((finding) =>
    ["late_in", "early_in"].includes(finding.category),
  );

  const lateBreaks = record.diffs.lateBreaksMinutes;
  if (lateBreaks !== null && Math.round(lateBreaks) > 0) {
    const approved = isYes(record.additionalRaw.approvedLatenessBreaks);

    findings.push(
      createFinding(record, {
        category: "late_breaks",
        issue: "Late Breaks",
        color: "orange",
        severity: "medium",
        requiresApproval: true,
        approved,
        approvalStatus: approvalLabel(
          record.additionalRaw.approvedLatenessBreaks,
        ),
        diffMinutes: lateBreaks,
        diffDisplay: `${Math.round(lateBreaks)} minutes`,
        action: approved
          ? "Review the approved late break duration and ensure it is documented."
          : "Review the break duration and corresponding approval.",
      }),
    );
  }

  const outageNotApproved = record.diffs.outageNotApprovedMinutes;
  if (outageNotApproved !== null && Math.round(outageNotApproved) > 0) {
    findings.push(
      createFinding(record, {
        category: "outage_not_approved",
        issue: "Outage Not Approved",
        color: "red",
        severity: "high",
        requiresApproval: true,
        approved: false,
        approvalStatus: "No",
        diffMinutes: outageNotApproved,
        diffDisplay: `${Math.round(outageNotApproved)} minutes`,
        action:
          "Investigate the unapproved outage record and its recovery status.",
        details: {
          outageRecovery: normalizeText(record.additionalRaw.outageToRecover),
        },
      }),
    );
  } else {
    const outage = record.diffs.outageMinutes;

    if (outage !== null && Math.round(outage) > 0) {
      findings.push(
        createFinding(record, {
          category: "outage",
          issue: "Outage",
          color: "orange",
          severity: "medium",
          requiresApproval: false,
          approvalStatus: "N/A",
          diffMinutes: outage,
          diffDisplay: `${Math.round(outage)} minutes`,
          action: "Investigate the outage record and its recovery status.",
          details: {
            outageRecovery: normalizeText(record.additionalRaw.outageToRecover),
          },
        }),
      );
    }
  }

  const earlyOutExtra = record.diffs.earlyOutExtraMinutes;
  if (
    !hasLogoutFinding &&
    earlyOutExtra !== null &&
    Math.round(earlyOutExtra) > 0
  ) {
    findings.push(
      createFinding(record, {
        category: "early_out_extra",
        issue: "Early OUT / Extra Time",
        color: "orange",
        severity: "medium",
        requiresApproval: false,
        approvalStatus: "N/A",
        diffMinutes: earlyOutExtra,
        diffDisplay: `${Math.round(earlyOutExtra)} minutes`,
        action:
          "Review the Early OUT / Extra time entry and verify whether it relates to logout variance.",
      }),
    );
  }

  const totalLate = record.diffs.totalLateMinutes;
  const hasLateFinding =
    hasLoginFinding ||
    findings.some((finding) => finding.category === "late_breaks");

  if (!hasLateFinding && totalLate !== null && Math.round(totalLate) > 0) {
    findings.push(
      createFinding(record, {
        category: "total_late",
        issue: "Total Late Minutes",
        color: "orange",
        severity: "medium",
        requiresApproval: false,
        approvalStatus: "N/A",
        diffMinutes: totalLate,
        diffDisplay: `${Math.round(totalLate)} minutes`,
        action:
          "Review total late minutes and identify the underlying late component.",
      }),
    );
  }

  if (isMeaningfulLeaveValue(record.additionalRaw.approvedLeave)) {
    findings.push(
      createFinding(record, {
        category: "approved_leave",
        issue: "Approved Leave",
        color: "green",
        severity: "info",
        requiresApproval: false,
        approved: true,
        approvalStatus: "Yes",
        diffDisplay: normalizeText(record.additionalRaw.approvedLeave),
        action:
          "Approved leave is present. Ensure the leave type and documentation are visible in payroll/WFM.",
      }),
    );
  }

  if (isMeaningfulLeaveValue(record.additionalRaw.unapprovedLeave)) {
    findings.push(
      createFinding(record, {
        category: "unapproved_leave",
        issue: "Unapproved Leave",
        color: "red",
        severity: "high",
        requiresApproval: true,
        approved: false,
        approvalStatus: "No",
        diffDisplay: normalizeText(record.additionalRaw.unapprovedLeave),
        action:
          "Obtain clarification or supporting documentation for the unapproved leave.",
      }),
    );
  }

  return findings;
}

function analyzeRecord(record) {
  const staffedFindings = analyzeStaffedTime(record);
  const loginFindings = analyzeLogin(record);
  const logoutFindings = analyzeLogout(record);

  const additionalFindings = analyzeAdditional(record, [
    ...loginFindings,
    ...logoutFindings,
  ]);

  return [
    ...staffedFindings,
    ...loginFindings,
    ...logoutFindings,
    ...additionalFindings,
  ];
}

function buildSummary(records, findings) {
  const byLobInternal = {};

  const agentIdentity = (item) => {
    const id = normalizeText(item.hrId || item.agentId || "").toLowerCase();
    const name = normalizeText(item.agentName || "").toLowerCase();

    return id || name || "unknown";
  };

  const ensureLob = (lob) => {
    if (!byLobInternal[lob]) {
      byLobInternal[lob] = {
        lob,
        agentSet: new Set(),
        exceptions: 0,
        approvedExceptions: 0,
        pendingReview: 0,
        earlyOut: 0,
        overtime: 0,
        lateIn: 0,
        earlyIn: 0,
        staffedVariance: 0,
        lateBreaks: 0,
        outage: 0,
      };
    }

    return byLobInternal[lob];
  };

  const totalAgentSet = new Set();

  // Count unique agents, not every row.
  for (const record of records) {
    const identity = agentIdentity(record);
    totalAgentSet.add(identity);

    const lob = record.lob || "Unspecified";
    ensureLob(lob).agentSet.add(identity);
  }

  const exceptionFindings = findings.filter(
    (finding) => !["approved_leave"].includes(finding.category),
  );

  const affectedAgentSet = new Set();

  for (const finding of exceptionFindings) {
    affectedAgentSet.add(agentIdentity(finding));

    const lobRow = ensureLob(finding.lob || "Unspecified");

    lobRow.exceptions += 1;

    if (finding.requiresApproval && finding.approved) {
      lobRow.approvedExceptions += 1;
    }

    if (finding.requiresApproval && !finding.approved) {
      lobRow.pendingReview += 1;
    }

    switch (finding.category) {
      case "early_out":
      case "early_out_extra":
        lobRow.earlyOut += 1;
        break;

      case "overtime":
        lobRow.overtime += 1;
        break;

      case "late_in":
        lobRow.lateIn += 1;
        break;

      case "early_in":
        lobRow.earlyIn += 1;
        break;

      case "staffed_variance":
      case "staffed_calculated_discrepancy":
        lobRow.staffedVariance += 1;
        break;

      case "late_breaks":
        lobRow.lateBreaks += 1;
        break;

      case "outage":
      case "outage_not_approved":
        lobRow.outage += 1;
        break;

      default:
        break;
    }
  }

  const byLob = Object.values(byLobInternal)
    .map((row) => ({
      lob: row.lob,
      agents: row.agentSet.size,
      exceptions: row.exceptions,
      approvedExceptions: row.approvedExceptions,
      pendingReview: row.pendingReview,
      earlyOut: row.earlyOut,
      overtime: row.overtime,
      lateIn: row.lateIn,
      earlyIn: row.earlyIn,
      staffedVariance: row.staffedVariance,
      lateBreaks: row.lateBreaks,
      outage: row.outage,
    }))
    .sort((a, b) => a.lob.localeCompare(b.lob));

  const counts = {
    totalFindings: findings.length,
    approvedExceptions: findings.filter((f) => f.requiresApproval && f.approved)
      .length,
    pendingReview: findings.filter((f) => f.requiresApproval && !f.approved)
      .length,
    earlyOut: findings.filter((f) =>
      ["early_out", "early_out_extra"].includes(f.category),
    ).length,
    overtime: findings.filter((f) => f.category === "overtime").length,
    lateIn: findings.filter((f) => f.category === "late_in").length,
    earlyIn: findings.filter((f) => f.category === "early_in").length,
    staffedVariance: findings.filter((f) =>
      ["staffed_variance", "staffed_calculated_discrepancy"].includes(
        f.category,
      ),
    ).length,
    lateBreaks: findings.filter((f) => f.category === "late_breaks").length,
    outage: findings.filter((f) =>
      ["outage", "outage_not_approved"].includes(f.category),
    ).length,
    warnings: findings.reduce(
      (count, f) => count + (f.warnings?.length || 0),
      0,
    ),
  };

  return {
    totalAgents: totalAgentSet.size,
    affectedAgents: affectedAgentSet.size,
    counts,
    byLob,
  };
}

function analyzeAttendance(records, selectedLobs = []) {
  const filteredRecords = filterRecordsByLob(records, selectedLobs);

  const findings = [];

  for (const record of filteredRecords) {
    findings.push(...analyzeRecord(record));
  }

  const approvedExceptions = findings.filter(
    (finding) => finding.requiresApproval && finding.approved,
  );

  const pendingReview = findings.filter(
    (finding) => finding.requiresApproval && !finding.approved,
  );

  const informational = findings.filter((finding) => !finding.requiresApproval);

  const summary = buildSummary(filteredRecords, findings);

  return {
    findings,
    approvedExceptions,
    pendingReview,
    informational,
    summary,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  analyzeAttendance,
  analyzeRecord,
};
