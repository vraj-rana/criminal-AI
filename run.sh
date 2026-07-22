#!/bin/bash
# Start FastAPI backend in the background
cd crime-ai-main
python server.py &
BACKEND_PID=$!

# Start Vite React client in the foreground
cd ..
npm run dev

# Kill backend background process on script exit
kill $BACKEND_PID
