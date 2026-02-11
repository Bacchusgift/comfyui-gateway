@echo off
cd /d "%~dp0"

rem 若需 Redis，请先执行: set REDIS_URL=redis://用户:密码@host:6379/0

if not exist .venv (
  python -m venv .venv
)
.venv\Scripts\pip install -q -r requirements.txt

if not exist frontend\dist (
  echo Building frontend...
  cd frontend && call npm install && call npm run build && cd ..
)

echo Starting gateway at http://127.0.0.1:8000
.venv\Scripts\uvicorn app.main:app --host 0.0.0.0 --port 8000
