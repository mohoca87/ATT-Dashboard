function formatFindingText(finding) {
  const lines = [];

  lines.push(`Agent: ${finding.agentName}`);
  lines.push(`LOB: ${finding.lob}`);
  lines.push(`Worksheet: ${finding.sheet} (row ${finding.row})`);
  lines.push(`Issue: ${finding.issue}`);

  if (finding.actual) lines.push(`Actual: ${finding.actual}`);
  if (finding.scheduled) lines.push(`Scheduled: ${finding.scheduled}`);
  if (finding.diffDisplay) lines.push(`Difference: ${finding.diffDisplay}`);

  lines.push(`Approval: ${finding.approvalStatus}`);

  if (finding.comments) lines.push(`Comments: ${finding.comments}`);
  if (finding.wfmComments) lines.push(`WFM Comments: ${finding.wfmComments}`);

  if (finding.warnings?.length) {
    lines.push(`Warnings: ${finding.warnings.join(' ')}`);
  }

  lines.push(`Action: ${finding.action}`);

  return lines.join('\n');
}

function formatReportText(analysis, title = 'Attendance Analysis Report') {
  const lines = [];

  lines.push(title);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push('');

  lines.push('SUMMARY');
  lines.push(`Total agents: ${analysis.summary.totalAgents}`);
  lines.push(`Affected agents: ${analysis.summary.affectedAgents}`);
  lines.push(`Total findings: ${analysis.summary.counts.totalFindings}`);
  lines.push(`Approved exceptions: ${analysis.summary.counts.approvedExceptions}`);
  lines.push(`Pending review: ${analysis.summary.counts.pendingReview}`);
  lines.push(`Early OUT: ${analysis.summary.counts.earlyOut}`);
  lines.push(`Overtime: ${analysis.summary.counts.overtime}`);
  lines.push(`Late IN: ${analysis.summary.counts.lateIn}`);
  lines.push(`Staffed Time variance: ${analysis.summary.counts.staffedVariance}`);
  lines.push('');

  lines.push('FINDINGS');
  lines.push('');

  analysis.findings.forEach((finding, index) => {
    lines.push(`[${index + 1}]`);
    lines.push(formatFindingText(finding));
    lines.push('');
  });

  return lines.join('\n');
}

module.exports = {
  formatFindingText,
  formatReportText
};