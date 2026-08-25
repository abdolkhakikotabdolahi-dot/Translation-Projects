-- جدول فایل‌های ترجمه
CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  description TEXT,
  file_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available', -- 'available' یا 'taken'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- جدول ثبت‌نام دانشجویان
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  university TEXT NOT NULL,
  file_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (file_id) REFERENCES files(id)
);

CREATE INDEX idx_files_status ON files(status);