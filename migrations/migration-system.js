const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class MigrationSystem {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath);
    this.migrationsDir = path.join(__dirname);
    this.initializeMigrationsTable();
  }

  initializeMigrationsTable() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT UNIQUE NOT NULL,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async getAppliedMigrations() {
    return new Promise((resolve, reject) => {
      this.db.all('SELECT filename FROM migrations ORDER BY id', (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(row => row.filename));
      });
    });
  }

  async getAllMigrations() {
    const files = fs.readdirSync(this.migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();
    return files;
  }

  async runMigration(filename) {
    const filePath = path.join(this.migrationsDir, filename);
    const sql = fs.readFileSync(filePath, 'utf8');
    
    return new Promise((resolve, reject) => {
      this.db.serialize(() => {
        this.db.run('BEGIN TRANSACTION');
        
        // Split SQL by semicolons and run each statement
        const statements = sql.split(';').filter(s => s.trim());
        
        const runStatements = (index) => {
          if (index >= statements.length) {
            // Mark migration as applied
            this.db.run('INSERT INTO migrations (filename) VALUES (?)', [filename], (err) => {
              if (err) {
                this.db.run('ROLLBACK');
                reject(err);
              } else {
                this.db.run('COMMIT');
                resolve();
              }
            });
            return;
          }

          this.db.run(statements[index], (err) => {
            if (err) {
              this.db.run('ROLLBACK');
              reject(err);
            } else {
              runStatements(index + 1);
            }
          });
        };

        runStatements(0);
      });
    });
  }

  async migrate() {
    try {
      const applied = await this.getAppliedMigrations();
      const all = await this.getAllMigrations();
      const pending = all.filter(migration => !applied.includes(migration));

      console.log(`Found ${pending.length} pending migrations`);

      for (const migration of pending) {
        console.log(`Running migration: ${migration}`);
        await this.runMigration(migration);
        console.log(`✅ Applied: ${migration}`);
      }

      console.log('✅ All migrations completed');
    } catch (error) {
      console.error('❌ Migration failed:', error);
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}

module.exports = MigrationSystem;