const path = require('path');
const crypto = require('crypto');

// ============================================================
// Hash de senha (scrypt + salt) — guarda "salt:hash"
// ============================================================
function hashSenha(senha) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(senha), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}
function verificaSenha(senha, armazenado) {
  if (!armazenado || !armazenado.includes(':')) return false;
  const [salt, hash] = armazenado.split(':');
  const calc = crypto.scryptSync(String(senha), salt, 32).toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
  } catch (e) {
    return false;
  }
}

// ============================================================
// CAMADA DE BANCO — dois dialetos:
//  - Produção: PostgreSQL (Supabase) quando process.env.DATABASE_URL existe.
//  - Local/dev: SQLite (arquivo tuin.db) quando não há DATABASE_URL.
// Os helpers dbRun/dbGet/dbAll abstraem a diferença (placeholders, lastID).
// ============================================================

const DATABASE_URL = process.env.DATABASE_URL;
const isPg = !!DATABASE_URL;

let dbRun, dbGet, dbAll;

if (isPg) {
  const { Pool, types } = require('pg');
  // Faz COUNT (bigint) e NUMERIC voltarem como número (não string)
  types.setTypeParser(20, v => (v === null ? null : parseInt(v, 10)));   // int8 / bigint
  types.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));    // numeric

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Supabase exige SSL
    max: 5
  });
  pool.on('error', (e) => console.error('Erro no pool PostgreSQL:', e.message));
  console.log('Banco: PostgreSQL (produção / Supabase).');

  // Converte placeholders "?" (estilo SQLite) para "$1, $2..." (estilo PG)
  const toPg = (sql) => { let i = 0; return sql.replace(/\?/g, () => '$' + (++i)); };

  dbRun = async (sql, params = []) => {
    let text = toPg(sql);
    // Para INSERT, devolve o id gerado (equivalente ao lastID do SQLite)
    if (/^\s*INSERT\s/i.test(text) && !/RETURNING/i.test(text) && !/ON CONFLICT/i.test(text)) {
      text = text.replace(/\s*;?\s*$/, '') + ' RETURNING id';
    }
    const res = await pool.query(text, params);
    const id = res.rows && res.rows[0] ? res.rows[0].id : undefined;
    return { id, changes: res.rowCount };
  };
  dbGet = async (sql, params = []) => (await pool.query(toPg(sql), params)).rows[0];
  dbAll = async (sql, params = []) => (await pool.query(toPg(sql), params)).rows;
} else {
  const sqlite3 = require('sqlite3').verbose();
  const dbPath = path.join(__dirname, 'tuin.db');
  const sdb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Erro ao conectar ao SQLite:', err.message);
    else console.log('Banco: SQLite local.');
  });
  dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    sdb.run(sql, params, function (err) { err ? reject(err) : resolve({ id: this.lastID, changes: this.changes }); });
  });
  dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    sdb.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
  dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    sdb.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// Tipos que variam entre os dialetos
const PK = isPg ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
const TS = isPg ? 'TIMESTAMPTZ DEFAULT now()' : 'DATETIME DEFAULT CURRENT_TIMESTAMP';
const TSNULL = isPg ? 'TIMESTAMPTZ' : 'DATETIME';

// Detecta violação de unicidade em qualquer dialeto (opcionalmente filtrando por campo)
function isUniqueViolation(err, campo) {
  if (!err) return false;
  const msg = `${err.message || ''} ${err.detail || ''} ${err.constraint || ''}`;
  const unique = err.code === '23505' || msg.includes('UNIQUE constraint failed');
  if (!unique) return false;
  return campo ? msg.toLowerCase().includes(campo.toLowerCase()) : true;
}

// Filtro "registros de hoje" por dialeto
function filtroHoje(coluna) {
  return isPg ? `${coluna}::date = current_date` : `date(${coluna}) = date('now','localtime')`;
}

// Garante que uma coluna exista (migração idempotente)
async function ensureColumn(tabela, coluna, definicao) {
  if (isPg) {
    await dbRun(`ALTER TABLE ${tabela} ADD COLUMN IF NOT EXISTS ${coluna} ${definicao}`);
  } else {
    const cols = await dbAll(`PRAGMA table_info(${tabela})`);
    if (!cols.some(c => c.name === coluna)) {
      await dbRun(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
      console.log(`Migração: coluna ${tabela}.${coluna} adicionada.`);
    }
  }
}

// Inicialização das Tabelas
async function initDatabase() {
  try {
    await dbRun(`
      CREATE TABLE IF NOT EXISTS clientes (
        id ${PK},
        nome TEXT NOT NULL,
        email TEXT,
        cpf TEXT UNIQUE,
        telefone TEXT,
        saldo REAL DEFAULT 0.0,
        status TEXT DEFAULT 'ativo',
        criado_em ${TS}
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS cartoes_nfc (
        id ${PK},
        uid TEXT UNIQUE NOT NULL,
        cliente_id INTEGER,
        status TEXT DEFAULT 'ativo',
        criado_em ${TS},
        FOREIGN KEY(cliente_id) REFERENCES clientes(id) ON DELETE SET NULL
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS torneiras (
        id ${PK},
        numero INTEGER UNIQUE NOT NULL,
        chopp_nome TEXT NOT NULL,
        chopp_preco_litro REAL NOT NULL,
        preco_copo_300 REAL DEFAULT 0.0,
        preco_copo_500 REAL DEFAULT 0.0,
        status TEXT DEFAULT 'ativa',
        criado_em ${TS}
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS sessoes_consumo (
        id ${PK},
        cliente_id INTEGER NOT NULL,
        torneira_id INTEGER NOT NULL,
        cartao_uid TEXT NOT NULL,
        saldo_inicial REAL NOT NULL,
        ml_consumido REAL DEFAULT 0.0,
        valor_pago REAL DEFAULT 0.0,
        status TEXT DEFAULT 'em_andamento',
        criado_em ${TS},
        atualizado_em ${TS},
        FOREIGN KEY(cliente_id) REFERENCES clientes(id),
        FOREIGN KEY(torneira_id) REFERENCES torneiras(id)
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS recargas (
        id ${PK},
        cliente_id INTEGER NOT NULL,
        valor REAL NOT NULL,
        metodo TEXT NOT NULL,
        criado_em ${TS},
        FOREIGN KEY(cliente_id) REFERENCES clientes(id)
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS historico_consumo (
        id ${PK},
        sessao_id INTEGER NOT NULL,
        cliente_id INTEGER NOT NULL,
        torneira_id INTEGER NOT NULL,
        ml_consumido REAL NOT NULL,
        valor_pago REAL NOT NULL,
        criado_em ${TS},
        FOREIGN KEY(sessao_id) REFERENCES sessoes_consumo(id),
        FOREIGN KEY(cliente_id) REFERENCES clientes(id),
        FOREIGN KEY(torneira_id) REFERENCES torneiras(id)
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS chopps (
        id ${PK},
        nome TEXT UNIQUE NOT NULL,
        estilo TEXT NOT NULL,
        preco_litro REAL NOT NULL,
        criado_em ${TS}
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS estornos (
        id ${PK},
        cliente_id INTEGER NOT NULL,
        torneira_id INTEGER NOT NULL,
        sessao_id INTEGER,
        valor REAL NOT NULL,
        motivo TEXT NOT NULL,
        criado_em ${TS},
        FOREIGN KEY(cliente_id) REFERENCES clientes(id),
        FOREIGN KEY(torneira_id) REFERENCES torneiras(id),
        FOREIGN KEY(sessao_id) REFERENCES sessoes_consumo(id)
      )
    `);

    // ===== MODELO COMANDA DIGITAL =====
    await dbRun(`
      CREATE TABLE IF NOT EXISTS pagamentos (
        id ${PK},
        cliente_id INTEGER NOT NULL,
        valor REAL NOT NULL,
        metodo TEXT NOT NULL,
        tipo TEXT DEFAULT 'comanda',
        criado_em ${TS},
        FOREIGN KEY(cliente_id) REFERENCES clientes(id)
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS consumos (
        id ${PK},
        cliente_id INTEGER NOT NULL,
        torneira_id INTEGER NOT NULL,
        chopp_nome TEXT NOT NULL,
        tamanho_ml INTEGER NOT NULL,
        valor REAL NOT NULL,
        status TEXT DEFAULT 'aberto',
        pagamento_id INTEGER,
        criado_em ${TS},
        FOREIGN KEY(cliente_id) REFERENCES clientes(id),
        FOREIGN KEY(torneira_id) REFERENCES torneiras(id),
        FOREIGN KEY(pagamento_id) REFERENCES pagamentos(id)
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS config (
        chave TEXT PRIMARY KEY,
        valor TEXT NOT NULL
      )
    `);

    // Usuários do sistema (perfis de acesso)
    await dbRun(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id ${PK},
        usuario TEXT UNIQUE NOT NULL,
        senha TEXT NOT NULL,
        perfil TEXT DEFAULT 'atendente',   -- admin | atendente
        status TEXT DEFAULT 'ativo',
        criado_em ${TS}
      )
    `);

    // ===== ESTOQUE DE BARRIS =====
    await dbRun(`
      CREATE TABLE IF NOT EXISTS barris (
        id ${PK},
        chopp_nome TEXT NOT NULL,
        capacidade_ml REAL NOT NULL,
        preco_custo REAL DEFAULT 0.0,
        volume_vendido_ml REAL DEFAULT 0.0,
        status TEXT DEFAULT 'estoque',
        torneira_id INTEGER,
        criado_em ${TS},
        esvaziado_em ${TSNULL},
        FOREIGN KEY(torneira_id) REFERENCES torneiras(id)
      )
    `);

    await dbRun(`
      CREATE TABLE IF NOT EXISTS movimentacoes_barril (
        id ${PK},
        barril_id INTEGER NOT NULL,
        tipo TEXT NOT NULL,
        torneira_id INTEGER,
        volume_restante_ml REAL,
        observacao TEXT,
        criado_em ${TS},
        FOREIGN KEY(barril_id) REFERENCES barris(id),
        FOREIGN KEY(torneira_id) REFERENCES torneiras(id)
      )
    `);

    // ===== MIGRAÇÕES (bancos já existentes) =====
    await ensureColumn('clientes', 'telefone', 'TEXT');
    await ensureColumn('torneiras', 'preco_copo_300', 'REAL DEFAULT 0.0');
    await ensureColumn('torneiras', 'preco_copo_500', 'REAL DEFAULT 0.0');
    await ensureColumn('torneiras', 'preco_copo_1000', 'REAL DEFAULT 0.0');
    await ensureColumn('torneiras', 'barril_id', 'INTEGER');
    await ensureColumn('consumos', 'barril_id', 'INTEGER');
    await ensureColumn('barris', 'estilo', 'TEXT');
    await ensureColumn('barris', 'marca', 'TEXT');

    // Preenche preços de copo iniciais com base no preço/litro (cast p/ ROUND no PG)
    const castN = isPg ? '::numeric' : '';
    await dbRun(`UPDATE torneiras SET preco_copo_300 = ROUND((chopp_preco_litro * 0.3)${castN}, 2) WHERE (preco_copo_300 IS NULL OR preco_copo_300 = 0) AND chopp_preco_litro > 0`);
    await dbRun(`UPDATE torneiras SET preco_copo_500 = ROUND((chopp_preco_litro * 0.5)${castN}, 2) WHERE (preco_copo_500 IS NULL OR preco_copo_500 = 0) AND chopp_preco_litro > 0`);
    await dbRun(`UPDATE torneiras SET preco_copo_1000 = ROUND((chopp_preco_litro * 1.0)${castN}, 2) WHERE (preco_copo_1000 IS NULL OR preco_copo_1000 = 0) AND chopp_preco_litro > 0`);

    // Configurações padrão (não sobrescreve se já existir)
    const insIgnore = isPg
      ? 'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT (chave) DO NOTHING'
      : 'INSERT OR IGNORE INTO config (chave, valor) VALUES (?, ?)';
    await dbRun(insIgnore, ['valor_segunda_via', '10.00']);
    await dbRun(insIgnore, ['markup_padrao', '300']);

    // Seed inicial (só em banco vazio)
    const countTorneiras = await dbGet('SELECT COUNT(*) as count FROM torneiras');
    if (Number(countTorneiras.count) === 0) {
      console.log('Banco vazio. Inserindo dados de semente...');
      await dbRun('INSERT INTO torneiras (numero, chopp_nome, chopp_preco_litro, preco_copo_300, preco_copo_500, preco_copo_1000, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [1, 'Pilsen Imperial', 18.00, 8.00, 12.00, 22.00, 'ativa']);
      await dbRun('INSERT INTO torneiras (numero, chopp_nome, chopp_preco_litro, preco_copo_300, preco_copo_500, preco_copo_1000, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [2, 'IPA Maracujá', 26.00, 11.00, 16.00, 30.00, 'ativa']);
      await dbRun('INSERT INTO torneiras (numero, chopp_nome, chopp_preco_litro, preco_copo_300, preco_copo_500, preco_copo_1000, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [3, 'Weiss Trigo', 22.00, 10.00, 14.00, 26.00, 'ativa']);
      await dbRun('INSERT INTO torneiras (numero, chopp_nome, chopp_preco_litro, preco_copo_300, preco_copo_500, preco_copo_1000, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [4, 'Double Stout', 30.00, 13.00, 18.00, 34.00, 'ativa']);
      await dbRun('INSERT INTO torneiras (numero, chopp_nome, chopp_preco_litro, preco_copo_300, preco_copo_500, preco_copo_1000, status) VALUES (?, ?, ?, ?, ?, ?, ?)', [5, 'Torneira Livre', 0.00, 0.00, 0.00, 0.00, 'inativa']);

      const cli1 = await dbRun('INSERT INTO clientes (nome, email, cpf, telefone, saldo) VALUES (?, ?, ?, ?, ?)', ['Diego Fernandes', 'diego@tuin.com.br', '123.456.789-00', '(11) 99999-0001', 0.00]);
      const cli2 = await dbRun('INSERT INTO clientes (nome, email, cpf, telefone, saldo) VALUES (?, ?, ?, ?, ?)', ['Mariana Costa', 'mariana@tuin.com.br', '987.654.321-11', '(11) 99999-0002', 0.00]);
      await dbRun('INSERT INTO cartoes_nfc (uid, cliente_id) VALUES (?, ?)', ['NFC123456', cli1.id]);
      await dbRun('INSERT INTO cartoes_nfc (uid, cliente_id) VALUES (?, ?)', ['NFC987654', cli2.id]);
      console.log('Dados de semente inseridos.');
    }

    const countChopps = await dbGet('SELECT COUNT(*) as count FROM chopps');
    if (Number(countChopps.count) === 0) {
      await dbRun('INSERT INTO chopps (nome, estilo, preco_litro) VALUES (?, ?, ?)', ['Pilsen Imperial', 'Pilsen', 18.00]);
      await dbRun('INSERT INTO chopps (nome, estilo, preco_litro) VALUES (?, ?, ?)', ['IPA Maracujá', 'IPA', 26.00]);
      await dbRun('INSERT INTO chopps (nome, estilo, preco_litro) VALUES (?, ?, ?)', ['Weiss Trigo', 'Weiss', 22.00]);
      await dbRun('INSERT INTO chopps (nome, estilo, preco_litro) VALUES (?, ?, ?)', ['Double Stout', 'Stout', 30.00]);
    }

    const tap5 = await dbGet('SELECT * FROM torneiras WHERE numero = 5');
    if (!tap5) {
      await dbRun('INSERT INTO torneiras (numero, chopp_nome, chopp_preco_litro, status) VALUES (?, ?, ?, ?)', [5, 'Torneira Livre', 0.00, 'inativa']);
    }

    // Bootstrap do admin a partir das variáveis de ambiente (só em produção, com APP_SENHA)
    const adminUsuario = process.env.APP_USUARIO || 'admin';
    const adminSenha = process.env.APP_SENHA;
    if (adminSenha) {
      const existe = await dbGet('SELECT id FROM usuarios WHERE usuario = ?', [adminUsuario]);
      if (!existe) {
        await dbRun('INSERT INTO usuarios (usuario, senha, perfil, status) VALUES (?, ?, ?, ?)',
          [adminUsuario, hashSenha(adminSenha), 'admin', 'ativo']);
        console.log(`Usuário admin "${adminUsuario}" criado a partir das variáveis de ambiente.`);
      }
    }
  } catch (error) {
    console.error('Erro na inicialização do banco de dados:', error);
  }
}

module.exports = {
  dbRun,
  dbGet,
  dbAll,
  initDatabase,
  isPg,
  isUniqueViolation,
  filtroHoje,
  hashSenha,
  verificaSenha
};
