# Project: Contract Viewer

A local web app to browse, search, review, and correct the extracted results of
the contract pipeline. It reads a JSON file of extracted contract data and
presents an Outlook-style three-pane interface: a scrollable contract list on
the left, extracted detail on the upper right, and the source PDF below it.

## Stack
- Backend: FastAPI (Python 3.11+), serving a JSON API and, later, streaming PDFs.
- Frontend: React + TypeScript, built with Vite. Tailwind for styling.
- PDF viewing: react-pdf (a wrapper over Mozilla's PDF.js).
- Long lists: TanStack Virtual to virtualize the contract list.
- Runs locally: backend on a local port, opened in a browser. Cross-platform by
  virtue of being a web app. A pywebview or Tauri wrapper can be added later
  without code changes.

## The data source
The source of truth is a single JSON file: an array of contract objects produced
by the extraction pipeline. There is no database. The app reads this file and
may write user edits to a separate file, but must never corrupt the source.

The JSON is not guaranteed to be strictly valid: the extractor can emit trailing
commas. Load it tolerantly (strip trailing commas before parsing, or use a
lenient parser) and log a warning if cleanup was needed.

Each contract object has these stable top-level fields:

    filename              string, may or may not end in .pdf
    is_pricing_contract   boolean
    contract_start_date   string "DD-MM-YYYY" or null
    contract_end_date     string "DD-MM-YYYY" or null
    signatories           array of { name, position }; position may be null,
                          and there may be more than one signatory
    location              string
    pricing               array of blocks. Each block maps a category name to an
                          array of line-item objects. The category names and the
                          line-item keys VARY from contract to contract and must
                          never be hardcoded.

Documents are identified by filename.

## Non-negotiable structure
- TypeScript throughout the frontend. Define types that mirror the contract
  object; do not use `any` for API data.
- A single typed API client module is the only place that calls fetch. UI
  components call the client, never fetch directly.
- Clear component boundaries: the list pane, detail pane, and PDF pane are
  separate components that do not reach into each other's internals.
- Pricing is rendered generically from the data at runtime. There is no fixed
  list of pricing fields anywhere in the code.
- Edits are written to a separate file, never by corrupting the source JSON.

## Deliberately minimal
- Use the libraries listed above. Do not hand-roll a PDF renderer or a virtual
  list.
- No global state-management library unless prop-passing genuinely stops scaling.
- No authentication or multi-user features. Single-user local tool.
- No abstractions before a second concrete use exists.

## Workflow
- Propose a plan before writing code. Build one milestone at a time.
- During development, point the backend at a COPY of the JSON file.

## Milestones
1. Backend: load the contracts JSON tolerantly; a list endpoint with glance
   fields; a detail endpoint by filename.
2. List and detail UI: three-pane shell, virtualized left list, read-only detail
   rendering all fields, with pricing rendered generically.
3. PDF viewer in the lower right. Resolve a contract's PDF by locating its
   filename under a configurable PDF base directory (note one filename has no
   .pdf extension).
4. Editing and save-back to a separate edits file.
5. Search, filter, and sort.
