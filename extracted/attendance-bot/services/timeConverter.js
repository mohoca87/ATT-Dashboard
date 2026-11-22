const PLACEHOLDERS = new Set([
  "",
  "-",
  "—",
  "–",
  "none",
  "n/a",
  "na",
  "null",
  "undefined",
  "blank",
  "not available",
]);

function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function isEmptyValue(value) {
  const text = normalizeText(value).toLowerCase();
  return PLACEHOLDERS.has(text);
}

function parseNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value ? 1 : 0;

  let text = normalizeText(value);
  if (!text || isEmptyValue(text)) return null;

  let negativeParentheses = false;
  if (/^\(.*\)$/.test(text)) {
    negativeParentheses = true;
    text = text.slice(1, -1);
  }

  let percent = false;
  if (text.endsWith("%")) {
    percent = true;
    text = text.slice(0, -1);
  }

  let cleaned = text
    .replace(/[,\s]/g, "")
    .replace(/min(ute)?s?/gi, "")
    .replace(/minutes?/gi, "")
    .replace(/hours?/gi, "")
    .replace(/hrs?/gi, "");

  const match = cleaned.match(/^[-+]?(\d+(\.\d*)?|\.\d+)$/);
  if (!match) return null;

  let num = parseFloat(cleaned);
  if (percent) num = num / 100;
  if (negativeParentheses) num = -num;

  return num;
}

function isMeaningfulNumber(value, tolerance = 0.0001) {
  const num = parseNumber(value);
  return num !== null && Math.abs(num) > tolerance;
}

function excelTimeToMinutes(value) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date) {
    return (
      value.getUTCHours() * 60 +
      value.getUTCMinutes() +
      Math.round(value.getUTCSeconds() / 60)
    );
  }

  const num = parseNumber(value);
  if (num !== null) {
    if (num < 0) return null;

    let fraction = num;

    // Standard Excel time values are usually between 0 and 1.
    // If the value is greater than 1, it is usually a date-time serial.
    // Example: 45312.833333 = date + 20:00 time.
    if (num > 1) {
      fraction = num - Math.floor(num);
    }

    return Math.round(fraction * 1440);
  }

  const text = normalizeText(value);
  const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  const meridiem = match[4] ? match[4].toUpperCase() : null;

  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;

  return hours * 60 + minutes + Math.round(seconds / 60);
}

function formatTimeValue(value) {
  const minutes = excelTimeToMinutes(value);
  if (minutes === null) return normalizeText(value);

  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;

  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function looksLikeTimeFormat(cell) {
  if (!cell) return false;

  const formatted = normalizeText(cell.w || cell.h || "");
  const format = normalizeText(cell.z || "");

  if (formatted.includes(":")) return true;
  if (/am|pm/i.test(formatted)) return true;
  if (/h|mm|am\/pm/i.test(format)) return true;

  return false;
}

function parseDurationTextToMinutes(value) {
  const original = normalizeText(value);
  if (!original || isEmptyValue(original)) return null;

  let text = original;
  let negative = false;

  if (/^[+-]/.test(text)) {
    negative = text.startsWith("-");
    text = text.slice(1).trim();
  }

  // Examples: 00:24, 1:30, 01:30:00
  const colonMatch = text.match(/^(\d{1,3}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (colonMatch) {
    const hours = parseInt(colonMatch[1], 10);
    const minutes = parseInt(colonMatch[2], 10);
    const seconds = colonMatch[3] ? parseInt(colonMatch[3], 10) : 0;

    const total = hours * 60 + minutes + seconds / 60;
    return negative ? -total : total;
  }

  // Examples: 24m, 1h 30m, 2 hours 15 minutes
  const hourMatch = text.match(/(\d+(\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/i);
  const minuteMatch = text.match(
    /(\d+(\.\d+)?)\s*(m|min|mins|minute|minutes)\b/i,
  );

  if (hourMatch || minuteMatch) {
    const hours = hourMatch ? parseFloat(hourMatch[1]) : 0;
    const minutes = minuteMatch ? parseFloat(minuteMatch[1]) : 0;

    const total = hours * 60 + minutes;
    return negative ? -total : total;
  }

  return null;
}

function parseDiffMinutes(value, cell = null, options = {}) {
  if (isEmptyValue(value)) return null;

  // Support text durations like -00:24, 1:30, 45m, 1h 15m.
  if (typeof value === "string") {
    const duration = parseDurationTextToMinutes(value);
    if (duration !== null) {
      return Math.round(duration * 100) / 100;
    }
  }

  const num = parseNumber(value);
  if (num === null) return null;

  let minutes = num;

  const timeFormat = looksLikeTimeFormat(cell);

  // IMPORTANT:
  // Do NOT convert whole numbers like -1 or 1 into -1440 / 1440 minutes.
  // Only convert true Excel day fractions such as -0.0166667.
  const probablyDayFraction =
    Math.abs(num) < 0.25 &&
    num !== 0 &&
    !Number.isInteger(num) &&
    String(Math.abs(num)).length > 10;

  const shouldConvertAsDayFraction =
    Math.abs(num) < 1 && num !== 0 && (timeFormat || probablyDayFraction);

  if (shouldConvertAsDayFraction) {
    minutes = num * 1440;
  }

  return Math.round(minutes * 100) / 100;
}

function formatStaffedValue(value) {
  if (isEmptyValue(value)) return "";

  const num = parseNumber(value);
  if (num !== null) {
    return `${Number.isInteger(num) ? num : num.toFixed(2)} h`;
  }

  return normalizeText(value);
}

function formatSignedMinutes(minutes, options = {}) {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes))
    return "";

  const rounded = Math.round(minutes);
  if (rounded === 0) return "0 minutes";

  if (rounded < 0) return `${rounded} minutes`;
  if (options.showPlus) return `+${rounded} minutes`;

  return `${rounded} minutes`;
}

function isYes(value) {
  if (value === true) return true;

  const num = parseNumber(value);
  if (num === 1) return true;

  const text = normalizeText(value).toLowerCase();
  return ["yes", "y", "true", "approved", "approve", "1"].includes(text);
}

function isNo(value) {
  if (value === false) return true;

  const text = normalizeText(value).toLowerCase();
  return ["no", "n", "false", "0"].includes(text);
}

function approvalLabel(value) {
  if (isYes(value)) return "Yes";
  if (isNo(value)) return "No";
  if (isEmptyValue(value)) return "Not specified";

  return normalizeText(value);
}

module.exports = {
  normalizeText,
  isEmptyValue,
  parseNumber,
  isMeaningfulNumber,
  excelTimeToMinutes,
  formatTimeValue,
  parseDurationTextToMinutes,
  parseDiffMinutes,
  formatStaffedValue,
  formatSignedMinutes,
  isYes,
  isNo,
  approvalLabel,
};
