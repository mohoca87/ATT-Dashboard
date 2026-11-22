# SEI Attendance Analysis Bot

Production-ready Node.js attendance analysis application for Replit.

## Authorized worksheets

This bot only analyzes:

1. `SEGER`
2. `SEI Voice`
3. `SEI Non-Voice`

All other worksheets are ignored completely.

## Features

- Upload `.xlsx` or `.xlsm`
- Dynamic two-level Excel header detection
- Staffed Time Actual / Schedule / VS analysis
- Log IN analysis using `Approved Log IN?`
- Log OUT analysis using `Approved Log OUT?`
- Negative logout difference treated as Early OUT
- Positive logout difference treated as Overtime
- Comments and WFM Comments included when available
- LOB multi-select filtering
- Agent search and conversational questions
- Color-coded dashboard cards
- Copy individual message
- Copy full visible report
- Light and dark themes
- Mobile-friendly layout

## Run locally

```bash
npm install
npm start