const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL — читатели не блокируют писателя и наоборот (иначе SQLite по
// умолчанию сериализует даже чтения на время записи). При гоночном тесте
// (50 параллельных вебхуков) реальную сериализацию критической секции даёт
// не WAL, а то, что better-sqlite3 синхронный: JS-код между началом и
// концом одного db.prepare(...).run() не может быть прерван другим
// запросом — event loop однопоточный. WAL нужен, чтобы не ловить
// "database is locked" на конкурентных запросах, а не для корректности
// как таковой.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));

module.exports = db;
