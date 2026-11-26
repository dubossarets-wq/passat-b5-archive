// Схема справочника. База собирается в памяти из папки seed/ при каждом запуске:
// что лежит в git, то и показывается. Пользовательских данных нет.
export const SCHEMA = `
  CREATE TABLE systems (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE maintenance_items (
    id INTEGER PRIMARY KEY,
    key TEXT UNIQUE,
    name TEXT NOT NULL,
    system_id INTEGER REFERENCES systems(id),
    interval_km INTEGER,
    interval_months INTEGER,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'unverified',
    sort INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE parts (
    id INTEGER PRIMARY KEY,
    oem TEXT NOT NULL,
    oem_norm TEXT NOT NULL,
    name TEXT NOT NULL,
    system_id INTEGER REFERENCES systems(id),
    maintenance_item_id INTEGER REFERENCES maintenance_items(id),
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'unverified',
    seed_key TEXT UNIQUE
  );

  CREATE TABLE part_analogs (
    id INTEGER PRIMARY KEY,
    part_id INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    brand TEXT NOT NULL,
    number TEXT NOT NULL,
    number_norm TEXT NOT NULL,
    source_url TEXT
  );

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
    status TEXT NOT NULL DEFAULT 'unverified'
  );
  CREATE INDEX dtc_vag ON dtc_codes(vag);

  CREATE TABLE articles (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    system_id INTEGER REFERENCES systems(id),
    body_md TEXT NOT NULL DEFAULT '',
    applies_to TEXT,
    status TEXT NOT NULL DEFAULT 'unverified',
    seed_key TEXT UNIQUE
  );

  CREATE TABLE links (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    category TEXT NOT NULL DEFAULT 'reference',
    description TEXT,
    applies_to TEXT,
    checked_at TEXT,
    check_result TEXT
  );

  CREATE TABLE schemes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    system_id INTEGER REFERENCES systems(id),
    kind TEXT NOT NULL DEFAULT 'diagram',
    source_type TEXT NOT NULL DEFAULT 'reference',
    description TEXT,
    applies_to TEXT,
    checked_at TEXT,
    check_result TEXT,
    images TEXT,
    status TEXT NOT NULL DEFAULT 'unverified'
  );

  -- Собственные схемы и распиновки, нарисованные приложением по фактам из источников.
  CREATE TABLE diagrams (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    system_id INTEGER REFERENCES systems(id),
    applies_to TEXT,
    data TEXT NOT NULL,
    notes TEXT,
    images TEXT,
    photo TEXT,
    part_numbers TEXT,
    status TEXT NOT NULL DEFAULT 'unverified'
  );

  -- Заводские параметры компонентов (только из официальных источников) и краткая методика проверки.
  CREATE TABLE component_specs (
    id INTEGER PRIMARY KEY,
    diagram_slug TEXT,
    component TEXT NOT NULL,
    part_number TEXT,
    specs TEXT,
    checks TEXT,
    applies_to TEXT,
    source_url TEXT,
    source_title TEXT,
    source_owner TEXT,
    check_source_url TEXT
  );

  -- Результат проверки по источникам и по машине владельца (seed/verification/*.json).
  CREATE TABLE verification (
    kind TEXT NOT NULL,
    key TEXT NOT NULL,
    status TEXT NOT NULL,
    fits TEXT NOT NULL DEFAULT 'unknown',
    note TEXT,
    checked TEXT,
    date TEXT,
    PRIMARY KEY (kind, key)
  );

  CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    owner_kind TEXT NOT NULL,
    owner_id INTEGER NOT NULL,
    url TEXT,
    title TEXT,
    accessed TEXT,
    applies_to TEXT,
    note TEXT
  );
  CREATE INDEX sources_owner ON sources(owner_kind, owner_id);
`;
