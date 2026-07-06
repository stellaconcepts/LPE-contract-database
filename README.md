# Contract Viewer

Local web app for browsing, searching, and correcting extracted contract data.

## Requirements

- macOS
- Python 3.11+
- Node.js 18+ (for the frontend/Vite build)
- Homebrew's `tesseract` (used for OCR on uploaded PDFs):

  ```sh
  brew install tesseract
  ```

- An Anthropic API key with access to Claude (used for extraction)

## 1. Clone the repo

```sh
git clone https://github.com/stellaconcepts/LPE-contract-database.git
cd LPE-contract-database
```

## 2. Backend setup

Create a virtualenv and install Python dependencies:

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Set your Anthropic API key (the backend reads it from the environment):

```sh
export ANTHROPIC_API_KEY=sk-ant-...
```

Add that line to your `~/.zshrc` if you don't want to re-export it every session.

## 3. Frontend setup

```sh
cd frontend
npm install
```

## 4. Run it

Two terminals, both from the repo root (with the venv activated in the backend one):

```sh
# Terminal 1 — backend (http://127.0.0.1:8000)
source .venv/bin/activate
python main.py

# Terminal 2 — frontend (http://localhost:5173)
cd frontend
npm run dev
```

Open http://localhost:5173 in your browser.

## Configuration

The backend reads these environment variables (all optional, defaults shown):

| Variable          | Default                 | Purpose                          |
|-------------------|--------------------------|-----------------------------------|
| `ANTHROPIC_API_KEY` | —                      | Required for contract extraction |
| `CONTRACTS_JSON`  | `sample_contracts.json` | Path to the extracted contracts JSON |
| `PDF_DIR`         | `./All_Parts_ocr`       | Directory of source PDFs |
| `EDITS_JSON`      | `edits.json`            | Where user edits are saved |
