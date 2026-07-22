# Setup & Run Guide: Vigil AI (Crime Intelligence System)

This guide provides step-by-step instructions to configure, install, and run both the backend FastAPI server and frontend Vite-React client on your local machine.

---

## Prerequisites
- **Python**: Version 3.10, 3.11, or 3.12 installed.
- **Node.js**: Version 18+ and `npm` installed.

---

## 1. Backend Server Setup (FastAPI)

1. Open a terminal and navigate to the backend folder:
   ```bash
   cd crime-ai-main
   ```
2. Create and activate a Python virtual environment:
   - **macOS / Linux**:
     ```bash
     python -m venv .venv
     source .venv/bin/activate
     ```
   - **Windows (PowerShell)**:
     ```powershell
     python -m venv .venv
     .venv\Scripts\Activate.ps1
     ```
3. Install all python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Configure environment variables:
   - Copy `.env.example` to a new `.env` file:
     ```bash
     cp .env.example .env
     ```
   - Open `.env` and fill in your Google Gemini API Key:
     ```env
     GEMINI_API_KEY=your_gemini_api_key_here
     ```
5. Run the FastAPI server:
   ```bash
   python server.py
   ```
   *The backend will boot on **`http://127.0.0.1:8000`**.*

---

## 2. Frontend Client Setup (Vite + React)

1. Open a second terminal window at the project root:
   ```bash
   npm install
   ```
2. Configure frontend environment variables:
   - Copy the root `.env.example` to a new `.env` file:
     ```bash
     cp .env.example .env
     ```
   - *By default, the client points to `http://localhost:8000`. You can edit `VITE_API_URL` inside `.env` if your backend is hosted on a custom port/URL.*
3. Run the client development server:
   ```bash
   npm run dev
   ```
   *The client will boot on **`http://localhost:5173`**.*

---

## 3. Quick Run Script (macOS / Linux / WSL)

If you are running in bash or Zsh, you can start both servers simultaneously by launching our root script:
```bash
chmod +x run.sh
./run.sh
```
Windows users can manually run the two setup streams in separate terminals as shown above.
