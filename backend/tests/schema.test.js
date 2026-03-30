const Database = require('better-sqlite3');

const schemaSql = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('farmer', 'buyer')),
    stellar_public_key TEXT,
    stellar_secret_key TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    farmer_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT DEFAULT 'other',
    price REAL NOT NULL,
    quantity INTEGER NOT NULL,
    unit TEXT DEFAULT 'unit',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (farmer_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    buyer_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    total_price REAL NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'paid', 'failed')),
    stellar_tx_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (buyer_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`;

describe('Database Schema & Constraints', () => {
  let db;

  beforeAll(() => {
    db = new Database(':memory:');
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    // Re-exec schema fresh each test
    db.exec(schemaSql);
    // Mimic migration ALTER
    try {
      db.exec(`ALTER TABLE products ADD COLUMN category TEXT DEFAULT 'other'`);
    } catch (e) {
      // Column may already exist
    }
  });

  describe('Table Structure Verification (PRAGMA)', () => {
    it('creates users table with correct columns', () => {
      const tableInfo = db.pragma('table_info(users)');
      expect(tableInfo.length).toBe(8);
      const id = tableInfo.find((row) => row.name === 'id');
      expect(id.pk).toBe(1);
      const email = tableInfo.find((row) => row.name === 'email');
      expect(email.notnull).toBe(1);
      expect(email.unique).toBe(1);
      const role = tableInfo.find((row) => row.name === 'role');
      expect(role.notnull).toBe(1);
    });

    it('creates products table with correct columns & FK', () => {
      const tableInfo = db.pragma('table_info(products)');
      expect(tableInfo.length).toBe(10);
      const id = tableInfo.find((row) => row.name === 'id');
      expect(id.pk).toBe(1);
      const farmerId = tableInfo.find((row) => row.name === 'farmer_id');
      expect(farmerId.notnull).toBe(1);

      const foreignKeys = db.pragma('foreign_key_list(products)');
      expect(foreignKeys.length).toBe(1);
      expect(foreignKeys[0].table).toBe('users');
      expect(foreignKeys[0].from).toBe('farmer_id');
      expect(foreignKeys[0].to).toBe('id');
    });

    it('creates orders table with correct columns, FKs & CHECK', () => {
      const tableInfo = db.pragma('table_info(orders)');
      expect(tableInfo.length).toBe(10);
      const buyerId = tableInfo.find((row) => row.name === 'buyer_id');
      expect(buyerId.notnull).toBe(1);
      const productId = tableInfo.find((row) => row.name === 'product_id');
      expect(productId.notnull).toBe(1);

      const foreignKeys = db.pragma('foreign_key_list(orders)');
      expect(foreignKeys.length).toBe(2);
      const buyerFK = foreignKeys.find((fk) => fk.from === 'buyer_id');
      expect(buyerFK.table).toBe('users');
      const productFK = foreignKeys.find((fk) => fk.from === 'product_id');
      expect(productFK.table).toBe('products');
    });

    it('has category column on products with default', () => {
      const tableInfo = db.pragma('table_info(products)');
      const category = tableInfo.find((row) => row.name === 'category');
      expect(category).toBeDefined();
      expect(category.dflt_value).toBe("'other'");
    });
  });

  describe('Data Constraints Enforcement', () => {
    it('users: enforces UNIQUE email', () => {
      db.exec(
        "INSERT INTO users (name, email, password, role) VALUES ('Alice', 'test@email.com', 'pass', 'buyer')"
      );
      expect(() => {
        db.exec(
          "INSERT INTO users (name, email, password, role) VALUES ('Bob', 'test@email.com', 'pass', 'farmer')"
        );
      }).toThrow(/UNIQUE constraint failed|UNIQUE/);
    });

    it('users: enforces CHECK role constraint', () => {
      expect(() => {
        db.exec(
          "INSERT INTO users (name, email, password, role) VALUES ('Admin', 'admin@test.com', 'pass', 'admin')"
        );
      }).toThrow(/CHECK constraint failed|CHECK/);
    });

    it('products: enforces FK farmer_id', () => {
      // No users exist yet
      expect(() => {
        db.exec(
          "INSERT INTO products (farmer_id, name, price, quantity) VALUES (999, 'Apple', 1.0, 10)"
        );
      }).toThrow(/FOREIGN KEY constraint failed|FOREIGN KEY/);
    });

    it('orders: enforces FKs buyer_id & product_id', () => {
      const userId = db
        .prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
        .run('Alice', 'a@test.com', 'pass', 'buyer').lastInsertRowid;
      const farmerId = db
        .prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
        .run('Farmer', 'f@test.com', 'pass', 'farmer').lastInsertRowid;
      const prodId = db
        .prepare('INSERT INTO products (farmer_id, name, price, quantity) VALUES (?, ?, ?, ?)')
        .run(farmerId, 'Apple', 1.0, 10).lastInsertRowid;

      expect(() => {
        db.exec(
          `INSERT INTO orders (buyer_id, product_id, quantity, total_price) VALUES (9999, ${prodId}, 1, 1.0)`
        );
      }).toThrow(/FOREIGN KEY constraint failed|FOREIGN KEY/);
    });

    it('orders: enforces CHECK status constraint', () => {
      const userId = db
        .prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
        .run('Bob', 'b@test.com', 'pass', 'buyer').lastInsertRowid;
      const farmerId = db
        .prepare('INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)')
        .run('Farm', 'farm@test.com', 'pass', 'farmer').lastInsertRowid;
      const prodId = db
        .prepare('INSERT INTO products (farmer_id, name, price, quantity) VALUES (?, ?, ?, ?)')
        .run(farmerId, 'Orange', 2.0, 5).lastInsertRowid;

      expect(() => {
        db.exec(
          `INSERT INTO orders (buyer_id, product_id, quantity, total_price, status) VALUES (${userId}, ${prodId}, 1, 2.0, 'invalid')`
        );
      }).toThrow(/CHECK constraint failed|CHECK/);
    });
  });

  describe('Schema Idempotency', () => {
    it('CREATE IF NOT EXISTS is safe to run multiple times', () => {
      db.exec(schemaSql);
      expect(() => db.exec(schemaSql)).not.toThrow();
      const tables = db.pragma('table_list');
      expect(tables.map((t) => t.name).sort()).toEqual(['orders', 'products', 'users']);
    });
  });
});
