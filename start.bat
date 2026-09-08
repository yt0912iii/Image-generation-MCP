@echo off
chcp 65001 >nul
echo Starting imagegenerate project...
echo Backend + Frontend on port 8181
echo Press Ctrl+C to stop
npx tsx server.ts
