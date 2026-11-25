// Схема базы SQLite. Версионирование — через PRAGMA user_version.
export const MIGRATIONS = [
  // --- версия 1 ---
  `
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE systems (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE vehicle (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT 'VW Passat B5',
    vin TEXT,
    body_code TEXT,
    engine_code TEXT NOT NULL DEFAULT 'ARG',
    gearbox_code TEXT,
    model_year TEXT,
    build_date TEXT,
    paint_code TEXT,
    pr_codes TEXT,
    trim TEXT,
    purchase_date TEXT,
    purchase_odometer INTEGER,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE odometer (
    id INTEGER PRIMARY KEY,
    vehicle_id INTEGER NOT NULL DEFAULT 1 REFERENCES vehicle(id),
    date TEXT NOT NULL,
    km INTEGER NOT NULL,
    record_id INTEGER
  );
  CREATE INDEX odometer_date ON odometer(vehicle_id, date, id);

  CREATE TABLE maintenance_items (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    name TEXT NOT NULL,
    system_id INTEGER REFERENCES systems(id),
    interval_km INTEGER,
    interval_months INTEGER,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'unverified',
    active INTEGER NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE records (
    id INTEGER PRIMARY KEY,
    vehicle_id INTEGER NOT NULL DEFAULT 1 REFERENCES vehicle(id),
    date TEXT NOT NULL,
    odometer_km INTEGER,
    title TEXT NOT NULL,
    system_id INTEGER REFERENCES systems(id),
    description TEXT,
    performed_by TEXT,
    cost_work REAL,
    cost_parts REAL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX records_date ON records(vehicle_id, date, id);

  CREATE TABLE record_items (
    record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    maintenance_item_id INTEGER NOT NULL REFERENCES maintenance_items(id) ON DELETE CASCADE,
    PRIMARY KEY (record_id, maintenance_item_id)
  );

  CREATE TABLE parts (
    id INTEGER PRIMARY KEY,
    oem TEXT NOT NULL,
    oem_norm TEXT NOT NULL,
    name TEXT NOT NULL,
    system_id INTEGER REFERENCES systems(id),
    maintenance_item_id INTEGER REFERENCES maintenance_items(id) ON DELETE SET NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'unverified',
    seed_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX parts_norm ON parts(oem_norm);

  CREATE TABLE part_analogs (
    id INTEGER PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    brand TEXT NOT NULL,
    number TEXT NOT NULL,
    number_norm TEXT NOT NULL,
    source_url TEXT
  );

  CREATE TABLE part_purchases (
    id INTEGER PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    date TEXT,
    shop TEXT,
    price REAL,
    url TEXT,
    note TEXT
  );

  CREATE TABLE record_parts (
    id INTEGER PRIMARY KEY,
    record_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    part_id INTEGER REFERENCES parts(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    qty REAL,
    price REAL,
    brand TEXT,
    number TEXT
  );

  CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    doc_type TEXT NOT NULL DEFAULT 'other',
    system_id INTEGER REFERENCES systems(id),
    tags TEXT,
    source_url TEXT,
    source_note TEXT,
    applies_to TEXT,
    doc_date TEXT,
    status TEXT NOT NULL DEFAULT 'unverified',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE files (
    id INTEGER PRIMARY KEY,
    owner_kind TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    rel_path TEXT NOT NULL,
    orig_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    thumb_path TEXT,
    text_content TEXT,
    text_status TEXT NOT NULL DEFAULT 'none',
    kind TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX files_owner ON files(owner_kind, owner_id);

  CREATE TABLE dtc_codes (
    id INTEGER PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    vag TEXT,
    system_id INTEGER REFERENCES systems(id),
    title TEXT NOT NULL,
    description TEXT,
    causes TEXT,
    checks TEXT,
    applies_to TEXT,
    status TEXT NOT NULL DEFAULT 'unverified',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX dtc_vag ON dtc_codes(vag);

  CREATE TABLE dtc_events (
    id INTEGER PRIMARY KEY,
    vehicle_id INTEGER NOT NULL DEFAULT 1 REFERENCES vehicle(id),
    code TEXT NOT NULL,
    code_id INTEGER REFERENCES dtc_codes(id) ON DELETE SET NULL,
    date TEXT NOT NULL,
    odometer_km INTEGER,
    tool TEXT,
    ecu TEXT,
    state TEXT,
    freeze_frame TEXT,
    cleared INTEGER NOT NULL DEFAULT 0,
    outcome TEXT,
    record_id INTEGER REFERENCES records(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX dtc_events_code ON dtc_events(code);

  CREATE TABLE articles (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    system_id INTEGER REFERENCES systems(id),
    body_md TEXT NOT NULL DEFAULT '',
    applies_to TEXT,
    status TEXT NOT NULL DEFAULT 'unverified',
    seed_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE links (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'reference',
    description TEXT,
    applies_to TEXT,
    checked_at TEXT,
    check_result TEXT,
    status TEXT NOT NULL DEFAULT 'unverified'
  );

  CREATE TABLE specs (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    system_id INTEGER REFERENCES systems(id),
    unit TEXT,
    value TEXT,
    source_url TEXT,
    source_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
    source_page TEXT,
    source_date TEXT,
    applies_to TEXT,
    status TEXT NOT NULL DEFAULT 'unverified'
  );

  CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    owner_kind TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    url TEXT,
    title TEXT,
    accessed TEXT,
    applies_to TEXT,
    note TEXT,
    document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL
  );
  CREATE INDEX sources_owner ON sources(owner_kind, owner_id);

  CREATE VIRTUAL TABLE search_fts USING fts5(
    kind UNINDEXED, ref_id UNINDEXED, title UNINDEXED, body UNINDEXED,
    title_s, body_s,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
];
