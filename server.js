const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const {
  initDatabase,
  dbRun,
  dbGet,
  dbAll,
  isPg,
  isUniqueViolation,
  filtroHoje,
  hashSenha,
  verificaSenha
} = require('./database');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// ==========================================
// LOGIN E PERFIS DE ACESSO (admin / atendente)
// Só protege quando APP_SENHA estiver definida (produção). Local fica aberto.
// ==========================================
const crypto = require('crypto');
const APP_SENHA = process.env.APP_SENHA;
const APP_USUARIO = process.env.APP_USUARIO || 'admin';
const SEGREDO = process.env.APP_SEGREDO || `${APP_USUARIO}:${APP_SENHA}:tuin-secret-v1`;

const lerCookie = (req, nome) => {
  const raw = req.headers.cookie || '';
  const item = raw.split(';').map(s => s.trim()).find(s => s.startsWith(nome + '='));
  return item ? decodeURIComponent(item.split('=').slice(1).join('=')) : null;
};

// Cookie assinado (HMAC) com {usuario, perfil, exp} — stateless, sobrevive a restart
function assinarSessao(obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SEGREDO).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function lerSessao(req) {
  const token = lerCookie(req, 'tuin_auth');
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const esperado = crypto.createHmac('sha256', SEGREDO).update(payload).digest('base64url');
  if (sig !== esperado) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch (e) { return null; }
}

// Valida CPF pelos dígitos verificadores
function cpfValido(cpf) {
  cpf = String(cpf || '').replace(/\D/g, '');
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i], 10) * (10 - i);
  let d1 = 11 - (soma % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== parseInt(cpf[9], 10)) return false;
  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i], 10) * (11 - i);
  let d2 = 11 - (soma % 11);
  if (d2 >= 10) d2 = 0;
  return d2 === parseInt(cpf[10], 10);
}

// Quem é o usuário logado (ou admin implícito quando o sistema está sem senha)
app.get('/api/me', (req, res) => {
  if (!APP_SENHA) return res.json({ usuario: 'local', perfil: 'admin', semLogin: true });
  const s = lerSessao(req);
  if (!s) return res.status(401).json({ error: 'Não autenticado.' });
  res.json({ usuario: s.usuario, perfil: s.perfil });
});

if (APP_SENHA) {
  app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

  app.post('/api/login', async (req, res) => {
    const { usuario, senha } = req.body || {};
    if (!usuario || !senha) return res.status(400).json({ error: 'Informe usuário e senha.' });
    try {
      let perfil = null;
      // Chave-mestra: as variáveis de ambiente sempre entram como admin (recuperação)
      if (usuario === APP_USUARIO && senha === APP_SENHA) {
        perfil = 'admin';
      } else {
        const u = await dbGet("SELECT * FROM usuarios WHERE usuario = ? AND status = 'ativo'", [usuario]);
        if (u && verificaSenha(senha, u.senha)) perfil = u.perfil || 'atendente';
      }
      if (!perfil) return res.status(401).json({ error: 'Usuário ou senha incorretos.' });
      const maxAge = 30 * 24 * 60 * 60 * 1000;
      const token = assinarSessao({ usuario, perfil, exp: Date.now() + maxAge });
      res.cookie('tuin_auth', token, { httpOnly: true, sameSite: 'lax', maxAge });
      res.json({ ok: true, usuario, perfil });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/logout', (req, res) => {
    res.clearCookie('tuin_auth');
    res.json({ ok: true });
  });

  // Rotas de API que o ATENDENTE NÃO pode acessar (apenas admin)
  const apiBloqueadaAtendente = [
    /^\/api\/financeiro/, /^\/api\/relatorios/, /^\/api\/barris/,
    /^\/api\/estoque/, /^\/api\/movimentacoes-barril/, /^\/api\/chopps/,
    /^\/api\/estornos/, /^\/api\/config/, /^\/api\/usuarios/, /^\/api\/teste/
  ];

  app.use((req, res, next) => {
    const p = req.path;
    // Fluxo de login e assets: liberados
    if (p === '/login' || p === '/api/login' || p === '/api/logout' || p === '/api/me') return next();
    if (/\.(css|js|png|jpe?g|svg|ico|gif|webp|woff2?|ttf|map)$/i.test(p)) return next();

    const s = lerSessao(req);
    if (!s) {
      if (p.startsWith('/api/')) return res.status(401).json({ error: 'Não autenticado.' });
      return res.redirect('/login');
    }
    req.sessao = s;
    if (s.perfil === 'admin') return next();

    // ===== Perfil ATENDENTE: só Atendimento e Caixa =====
    // Trocar a própria senha é sempre permitido
    if (p === '/api/trocar-senha') return next();
    if (p.startsWith('/api/')) {
      if (apiBloqueadaAtendente.some(rx => rx.test(p))) {
        return res.status(403).json({ error: 'Sem permissão.' });
      }
      if (/^\/api\/torneiras/.test(p) && req.method !== 'GET') {
        return res.status(403).json({ error: 'Sem permissão.' });
      }
      return next(); // demais APIs (clientes, comanda, consumos, pagamentos, cartoes, torneiras GET)
    }
    // Páginas: só /atendente e /caixa
    if (p.startsWith('/atendente') || p.startsWith('/caixa')) return next();
    return res.redirect('/atendente/');
  });

  console.log('🔒 Login e perfis de acesso ATIVADOS.');
}

app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// GESTÃO DE USUÁRIOS (protegida pelo middleware: só admin em produção)
// ==========================================
app.get('/api/usuarios', async (req, res) => {
  try {
    const us = await dbAll('SELECT id, usuario, perfil, status, criado_em FROM usuarios ORDER BY criado_em DESC');
    res.json(us);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/usuarios', async (req, res) => {
  const { usuario, senha, perfil } = req.body || {};
  if (!usuario || !senha) return res.status(400).json({ error: 'Usuário e senha são obrigatórios.' });
  const perfilOk = perfil === 'admin' ? 'admin' : 'atendente';
  try {
    await dbRun('INSERT INTO usuarios (usuario, senha, perfil, status) VALUES (?, ?, ?, ?)',
      [usuario.trim(), hashSenha(senha), perfilOk, 'ativo']);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (isUniqueViolation(e, 'usuario')) return res.status(400).json({ error: 'Já existe um usuário com esse nome.' });
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/usuarios/:id', async (req, res) => {
  const { id } = req.params;
  const { perfil, status, senha } = req.body || {};
  try {
    if (perfil) await dbRun('UPDATE usuarios SET perfil = ? WHERE id = ?', [perfil === 'admin' ? 'admin' : 'atendente', id]);
    if (status) await dbRun('UPDATE usuarios SET status = ? WHERE id = ?', [status, id]);
    if (senha) await dbRun('UPDATE usuarios SET senha = ? WHERE id = ?', [hashSenha(senha), id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/usuarios/:id', async (req, res) => {
  try {
    await dbRun('DELETE FROM usuarios WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Trocar a própria senha (qualquer usuário logado)
app.post('/api/trocar-senha', async (req, res) => {
  const s = req.sessao || lerSessao(req);
  if (!s) return res.status(401).json({ error: 'Não autenticado.' });
  const { atual, nova } = req.body || {};
  if (!nova) return res.status(400).json({ error: 'Informe a nova senha.' });
  try {
    const u = await dbGet('SELECT * FROM usuarios WHERE usuario = ?', [s.usuario]);
    if (!u) return res.status(400).json({ error: 'Usuário não encontrado para troca de senha.' });
    if (!verificaSenha(atual, u.senha)) return res.status(400).json({ error: 'Senha atual incorreta.' });
    await dbRun('UPDATE usuarios SET senha = ? WHERE id = ?', [hashSenha(nova), u.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Inicializa o Banco de Dados
initDatabase().then(() => {
  console.log('Banco de dados inicializado com sucesso.');
}).catch(err => {
  console.error('Falha ao inicializar o banco de dados:', err);
});

// ==========================================
// ROTAS DA API REST
// ==========================================

// --- Clientes ---

// Listar todos os clientes
app.get('/api/clientes', async (req, res) => {
  try {
    const clientes = await dbAll('SELECT * FROM clientes ORDER BY criado_em DESC');
    res.json(clientes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cadastrar novo cliente
app.post('/api/clientes', async (req, res) => {
  const { nome, email, cpf, telefone } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'Nome é obrigatório.' });
  }
  if (!cpf || !cpfValido(cpf)) {
    return res.status(400).json({ error: 'CPF inválido. Confira os números.' });
  }
  if (!telefone || String(telefone).replace(/\D/g, '').length < 10) {
    return res.status(400).json({ error: 'Telefone é obrigatório (com DDD).' });
  }
  try {
    const result = await dbRun(
      'INSERT INTO clientes (nome, email, cpf, telefone, saldo) VALUES (?, ?, ?, ?, 0.0)',
      [nome, email || null, cpf || null, telefone || null]
    );
    const novoCliente = await dbGet('SELECT * FROM clientes WHERE id = ?', [result.id]);
    io.emit('clientes_atualizado');
    res.status(201).json(novoCliente);
  } catch (error) {
    if (isUniqueViolation(error, 'cpf')) {
      return res.status(400).json({ error: 'CPF já cadastrado.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Editar dados do cliente
app.put('/api/clientes/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, email, cpf, telefone } = req.body;
  if (!nome) {
    return res.status(400).json({ error: 'Nome é obrigatório.' });
  }
  try {
    await dbRun(
      'UPDATE clientes SET nome = ?, email = ?, cpf = ?, telefone = ? WHERE id = ?',
      [nome, email || null, cpf || null, telefone || null, id]
    );
    const updated = await dbGet('SELECT * FROM clientes WHERE id = ?', [id]);
    io.emit('clientes_atualizado');
    res.json(updated);
  } catch (error) {
    if (isUniqueViolation(error, 'cpf')) {
      return res.status(400).json({ error: 'CPF já cadastrado para outro cliente.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Excluir cliente (protege quem tem histórico de consumo/pagamento)
app.delete('/api/clientes/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const cliente = await dbGet('SELECT * FROM clientes WHERE id = ?', [id]);
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const cons = await dbGet('SELECT COUNT(*) as c FROM consumos WHERE cliente_id = ?', [id]);
    const pag = await dbGet('SELECT COUNT(*) as c FROM pagamentos WHERE cliente_id = ?', [id]);
    if (Number(cons.c) > 0 || Number(pag.c) > 0) {
      return res.status(400).json({ error: 'Este cliente já tem consumos/pagamentos registrados e não pode ser excluído (use Editar). Exclusão é só para cadastros feitos por engano.' });
    }

    // Remove o cartão vinculado e o cliente
    await dbRun('DELETE FROM cartoes_nfc WHERE cliente_id = ?', [id]);
    await dbRun('DELETE FROM clientes WHERE id = ?', [id]);
    io.emit('clientes_atualizado');
    io.emit('cartoes_atualizado');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Recarregar saldo do cliente
app.post('/api/clientes/:id/recarga', async (req, res) => {
  const { id } = req.params;
  const { valor, metodo } = req.body;

  if (!valor || valor <= 0) {
    return res.status(400).json({ error: 'Valor da recarga deve ser maior que zero.' });
  }
  if (!metodo) {
    return res.status(400).json({ error: 'Método de pagamento é obrigatório.' });
  }

  try {
    const cliente = await dbGet('SELECT * FROM clientes WHERE id = ?', [id]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    // Atualiza o saldo do cliente
    const novoSaldo = cliente.saldo + parseFloat(valor);
    await dbRun('UPDATE clientes SET saldo = ? WHERE id = ?', [novoSaldo, id]);

    // Registra a recarga
    await dbRun(
      'INSERT INTO recargas (cliente_id, valor, metodo) VALUES (?, ?, ?)',
      [id, valor, metodo]
    );

    io.emit('clientes_atualizado');
    io.emit('relatorios_atualizado');
    res.json({ message: 'Recarga efetuada com sucesso!', novoSaldo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Listar todas as recargas realizadas
app.get('/api/recargas', async (req, res) => {
  try {
    const recargas = await dbAll(`
      SELECT r.*, c.nome as cliente_nome, c.cpf as cliente_cpf 
      FROM recargas r
      JOIN clientes c ON r.cliente_id = c.id
      ORDER BY r.criado_em DESC
    `);
    res.json(recargas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


// --- Cartões NFC ---

// Listar cartões vinculados
app.get('/api/cartoes', async (req, res) => {
  try {
    const cartoes = await dbAll(`
      SELECT c.*, cl.nome as cliente_nome, cl.saldo as cliente_saldo 
      FROM cartoes_nfc c
      LEFT JOIN clientes cl ON c.cliente_id = cl.id
      ORDER BY c.criado_em DESC
    `);
    res.json(cartoes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Vincular cartão NFC a um cliente
app.post('/api/cartoes', async (req, res) => {
  const { uid, clienteId, metodo } = req.body;
  if (!uid || !clienteId) {
    return res.status(400).json({ error: 'UID do cartão e ID do cliente são obrigatórios.' });
  }

  try {
    // Verifica se o cliente existe
    const cliente = await dbGet('SELECT * FROM clientes WHERE id = ?', [clienteId]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }

    // Conta quantos cartões o cliente já possui no histórico
    const historico = await dbGet('SELECT COUNT(*) as count FROM cartoes_nfc WHERE cliente_id = ?', [clienteId]);
    const totalCartoes = historico ? historico.count : 0;

    // Se for segunda via ou posterior (totalCartoes > 0) e método de pagamento foi fornecido, registra o pagamento
    if (totalCartoes > 0 && metodo && metodo !== 'Gratis') {
      const cfg = await dbGet("SELECT valor FROM config WHERE chave = 'valor_segunda_via'");
      const valor = cfg ? parseFloat(cfg.valor) : 10.0;
      await dbRun(
        "INSERT INTO pagamentos (cliente_id, valor, metodo, tipo) VALUES (?, ?, ?, 'segunda_via')",
        [clienteId, valor, metodo]
      );
    }

    // Desativa cartões anteriores deste cliente
    await dbRun("UPDATE cartoes_nfc SET status = 'inativo' WHERE cliente_id = ?", [clienteId]);

    // Deleta o cartão de qualquer outro vínculo anterior para evitar duplicidade de UIDs ativos/inativos
    await dbRun('DELETE FROM cartoes_nfc WHERE uid = ?', [uid]);

    // Cria o novo vínculo
    await dbRun(
      'INSERT INTO cartoes_nfc (uid, cliente_id, status) VALUES (?, ?, ?)',
      [uid, clienteId, 'ativo']
    );

    io.emit('cartoes_atualizado');
    io.emit('clientes_atualizado');
    io.emit('relatorios_atualizado');
    res.status(201).json({ message: 'Cartão NFC vinculado com sucesso!', via: totalCartoes + 1 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obter histórico de cartões de um cliente específico
app.get('/api/clientes/:id/cartoes', async (req, res) => {
  const { id } = req.params;
  try {
    const history = await dbAll('SELECT * FROM cartoes_nfc WHERE cliente_id = ? ORDER BY criado_em ASC', [id]);
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obter dados do cartão e do cliente pelo UID
app.get('/api/cartoes/:uid', async (req, res) => {
  const { uid } = req.params;
  try {
    const cartao = await dbGet(`
      SELECT c.*, cl.nome as cliente_nome, cl.saldo as cliente_saldo, cl.status as cliente_status
      FROM cartoes_nfc c
      LEFT JOIN clientes cl ON c.cliente_id = cl.id
      WHERE c.uid = ? AND c.status = 'ativo'
    `, [uid]);

    if (!cartao) {
      return res.status(404).json({ error: 'Cartão NFC não cadastrado.' });
    }
    res.json(cartao);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Desvincular cartão NFC
app.delete('/api/cartoes/:uid', async (req, res) => {
  const { uid } = req.params;
  try {
    await dbRun("UPDATE cartoes_nfc SET status = 'inativo' WHERE uid = ?", [uid]);
    io.emit('cartoes_atualizado');
    io.emit('clientes_atualizado');
    res.json({ message: 'Cartão NFC desvinculado com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Torneiras ---

// Listar todas as torneiras (com estilo/marca do barril montado)
app.get('/api/torneiras', async (req, res) => {
  try {
    const torneiras = await dbAll(`
      SELECT t.*, b.estilo as barril_estilo, b.marca as barril_marca
      FROM torneiras t
      LEFT JOIN barris b ON t.barril_id = b.id
      ORDER BY t.numero ASC
    `);
    res.json(torneiras);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cadastrar ou atualizar torneira
app.post('/api/torneiras', async (req, res) => {
  const { numero, chopp_nome, chopp_preco_litro, preco_copo_300, preco_copo_500, preco_copo_1000 } = req.body;
  if (!numero || !chopp_nome) {
    return res.status(400).json({ error: 'Número e nome do chopp são obrigatórios.' });
  }

  // No modo comanda, o preço/litro é opcional; usa 0 quando não informado.
  const precoLitro = chopp_preco_litro != null ? parseFloat(chopp_preco_litro) : 0;
  const copo300 = preco_copo_300 != null ? parseFloat(preco_copo_300) : 0;
  const copo500 = preco_copo_500 != null ? parseFloat(preco_copo_500) : 0;
  const copo1000 = preco_copo_1000 != null ? parseFloat(preco_copo_1000) : 0;

  try {
    const existente = await dbGet('SELECT * FROM torneiras WHERE numero = ?', [numero]);
    if (existente) {
      // Atualiza
      await dbRun(
        'UPDATE torneiras SET chopp_nome = ?, chopp_preco_litro = ?, preco_copo_300 = ?, preco_copo_500 = ?, preco_copo_1000 = ? WHERE numero = ?',
        [chopp_nome, precoLitro, copo300, copo500, copo1000, numero]
      );
    } else {
      // Insere novo
      await dbRun(
        'INSERT INTO torneiras (numero, chopp_nome, chopp_preco_litro, preco_copo_300, preco_copo_500, preco_copo_1000) VALUES (?, ?, ?, ?, ?, ?)',
        [numero, chopp_nome, precoLitro, copo300, copo500, copo1000]
      );
    }
    io.emit('torneiras_atualizado');
    res.json({ message: 'Torneira configurada com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Alterar status da torneira (ativa / inativa)
app.post('/api/torneiras/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  try {
    await dbRun('UPDATE torneiras SET status = ? WHERE id = ?', [status, id]);
    io.emit('torneiras_atualizado');
    res.json({ message: 'Status da torneira atualizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Relatórios ---

app.get('/api/relatorios/painel', async (req, res) => {
  try {
    // Clientes totais
    const clientes = await dbGet('SELECT COUNT(*) as total FROM clientes');

    // Em aberto (a receber) — comandas abertas
    const emAberto = await dbGet("SELECT COALESCE(SUM(valor),0) as total, COUNT(DISTINCT cliente_id) as devedores FROM consumos WHERE status = 'aberto'");

    // Recebido total e hoje (pagamentos de comanda)
    const recebidoTotal = await dbGet("SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE tipo = 'comanda'");
    const recebidoHoje = await dbGet(`SELECT COALESCE(SUM(valor),0) as total FROM pagamentos WHERE tipo = 'comanda' AND ${filtroHoje('criado_em')}`);

    // Copos servidos (total geral)
    const copos = await dbGet('SELECT COUNT(*) as total FROM consumos');

    // Consumo agrupado por torneira (copos)
    const consumoTorneiras = await dbAll(`
      SELECT t.numero, t.chopp_nome,
             COUNT(co.id) as qtd_copos,
             COALESCE(SUM(co.valor),0) as valor_total
      FROM consumos co
      JOIN torneiras t ON co.torneira_id = t.id
      GROUP BY t.id, t.numero, t.chopp_nome
      ORDER BY t.numero ASC
    `);

    // Últimos consumos lançados
    const ultimosConsumos = await dbAll(`
      SELECT co.*, c.nome as cliente_nome, t.numero as torneira_numero
      FROM consumos co
      JOIN clientes c ON co.cliente_id = c.id
      LEFT JOIN torneiras t ON co.torneira_id = t.id
      ORDER BY co.criado_em DESC
      LIMIT 10
    `);

    res.json({
      totalClientes: clientes.total || 0,
      totalEmAberto: emAberto.total || 0,
      totalDevedores: emAberto.devedores || 0,
      recebidoTotal: recebidoTotal.total || 0,
      recebidoHoje: recebidoHoje.total || 0,
      totalCopos: copos.total || 0,
      consumoTorneiras,
      ultimosConsumos
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Chopps ---

// Listar todos os chopps cadastrados
app.get('/api/chopps', async (req, res) => {
  try {
    const chopps = await dbAll('SELECT * FROM chopps ORDER BY nome ASC');
    res.json(chopps);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cadastrar novo chopp
app.post('/api/chopps', async (req, res) => {
  const { nome, estilo, preco_litro } = req.body;
  if (!nome || !estilo || !preco_litro) {
    return res.status(400).json({ error: 'Nome, estilo e preço por litro são obrigatórios.' });
  }
  try {
    const result = await dbRun(
      'INSERT INTO chopps (nome, estilo, preco_litro) VALUES (?, ?, ?)',
      [nome, estilo, preco_litro]
    );
    const novoChopp = await dbGet('SELECT * FROM chopps WHERE id = ?', [result.id]);
    io.emit('torneiras_atualizado'); // Notifica para recarregar as torneiras/chopps no monitor
    res.status(201).json(novoChopp);
  } catch (error) {
    if (isUniqueViolation(error, 'nome')) {
      return res.status(400).json({ error: 'Chopp com este nome já cadastrado.' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Editar chopp existente
app.put('/api/chopps/:id', async (req, res) => {
  const { id } = req.params;
  const { nome, estilo, preco_litro } = req.body;
  if (!nome || !estilo || !preco_litro) {
    return res.status(400).json({ error: 'Nome, estilo e preço são obrigatórios.' });
  }
  try {
    await dbRun('UPDATE chopps SET nome = ?, estilo = ?, preco_litro = ? WHERE id = ?', [nome, estilo, preco_litro, id]);
    const updated = await dbGet('SELECT * FROM chopps WHERE id = ?', [id]);
    io.emit('torneiras_atualizado');
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deletar chopp
app.delete('/api/chopps/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbRun('DELETE FROM chopps WHERE id = ?', [id]);
    io.emit('torneiras_atualizado');
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Estornos ---

// Listar histórico de estornos
app.get('/api/estornos', async (req, res) => {
  try {
    const estornos = await dbAll(`
      SELECT e.*, c.nome as cliente_nome, c.cpf as cliente_cpf, t.numero as torneira_numero, t.chopp_nome
      FROM estornos e
      JOIN clientes c ON e.cliente_id = c.id
      JOIN torneiras t ON e.torneira_id = t.id
      ORDER BY e.criado_em DESC
    `);
    res.json(estornos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Buscar última sessão finalizada e reembolsável de um cliente
app.get('/api/clientes/:id/ultima-sessao', async (req, res) => {
  const { id } = req.params;
  try {
    const sessao = await dbGet(`
      SELECT s.*, t.numero as torneira_numero, t.chopp_nome
      FROM sessoes_consumo s
      JOIN torneiras t ON s.torneira_id = t.id
      WHERE s.cliente_id = ? AND s.status = 'finalizada' AND s.valor_pago > 0
      AND s.id NOT IN (SELECT sessao_id FROM estornos WHERE sessao_id IS NOT NULL)
      ORDER BY s.criado_em DESC
      LIMIT 1
    `);
    if (!sessao) {
      return res.status(404).json({ error: 'Nenhuma sessão reembolsável encontrada para este cliente.' });
    }
    res.json(sessao);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Confirmar estorno total de uma sessão
app.post('/api/estornos', async (req, res) => {
  const { sessaoId, motivo } = req.body;
  if (!sessaoId || !motivo) {
    return res.status(400).json({ error: 'Sessão ID e motivo são obrigatórios.' });
  }
  try {
    // Busca a sessão
    const sessao = await dbGet('SELECT * FROM sessoes_consumo WHERE id = ?', [sessaoId]);
    if (!sessao) {
      return res.status(404).json({ error: 'Sessão não encontrada.' });
    }
    if (sessao.valor_pago <= 0) {
      return res.status(400).json({ error: 'Sessão sem valor pago para estornar.' });
    }
    
    // Verifica se já foi estornada
    const jaEstornado = await dbGet('SELECT * FROM estornos WHERE sessao_id = ?', [sessaoId]);
    if (jaEstornado) {
      return res.status(400).json({ error: 'Esta sessão já foi estornada anteriormente.' });
    }

    // Reembolsa o cliente
    await dbRun('UPDATE clientes SET saldo = saldo + ? WHERE id = ?', [sessao.valor_pago, sessao.cliente_id]);

    // Insere o estorno
    await dbRun(
      'INSERT INTO estornos (cliente_id, torneira_id, sessao_id, valor, motivo) VALUES (?, ?, ?, ?, ?)',
      [sessao.cliente_id, sessao.torneira_id, sessaoId, sessao.valor_pago, motivo]
    );

    // Emite notificações em tempo real
    io.emit('clientes_atualizado');
    io.emit('estornos_atualizado');
    io.emit('relatorios_atualizado');

    res.json({ message: 'Estorno realizado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Históricos de Cliente ---

// Listar consumo de um cliente específico
app.get('/api/clientes/:id/historico', async (req, res) => {
  const { id } = req.params;
  try {
    const consumos = await dbAll(`
      SELECT h.*, t.numero as torneira_numero, t.chopp_nome
      FROM historico_consumo h
      JOIN torneiras t ON h.torneira_id = t.id
      WHERE h.cliente_id = ?
      ORDER BY h.criado_em DESC
    `, [id]);
    res.json(consumos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Listar recargas de um cliente específico
app.get('/api/clientes/:id/recargas', async (req, res) => {
  const { id } = req.params;
  try {
    const recargas = await dbAll(`
      SELECT * FROM recargas
      WHERE cliente_id = ?
      ORDER BY criado_em DESC
    `, [id]);
    res.json(recargas);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// COMANDA DIGITAL (fase atual)
// ==========================================

// Helper: total em aberto de um cliente
async function totalEmAberto(clienteId) {
  const row = await dbGet(
    "SELECT COALESCE(SUM(valor), 0) as total FROM consumos WHERE cliente_id = ? AND status = 'aberto'",
    [clienteId]
  );
  return row ? row.total : 0;
}

// Obter a comanda de um cliente (dados + itens em aberto + total devendo)
app.get('/api/comanda/:clienteId', async (req, res) => {
  const { clienteId } = req.params;
  try {
    const cliente = await dbGet('SELECT * FROM clientes WHERE id = ?', [clienteId]);
    if (!cliente) {
      return res.status(404).json({ error: 'Cliente não encontrado.' });
    }
    const itens = await dbAll(`
      SELECT co.*, t.numero as torneira_numero
      FROM consumos co
      LEFT JOIN torneiras t ON co.torneira_id = t.id
      WHERE co.cliente_id = ? AND co.status = 'aberto'
      ORDER BY co.criado_em DESC
    `, [clienteId]);
    // Histórico de chopps já consumidos (pagos) — para o atendente ver o que o cliente costuma beber
    const historico = await dbAll(`
      SELECT co.*, t.numero as torneira_numero
      FROM consumos co
      LEFT JOIN torneiras t ON co.torneira_id = t.id
      WHERE co.cliente_id = ? AND co.status = 'pago'
      ORDER BY co.criado_em DESC
      LIMIT 30
    `, [clienteId]);
    const total = await totalEmAberto(clienteId);
    const cartao = await dbGet('SELECT uid FROM cartoes_nfc WHERE cliente_id = ? LIMIT 1', [clienteId]);
    res.json({ cliente, itens, historico, total, cartao_uid: cartao ? cartao.uid : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Lançar um consumo (copo) na comanda
app.post('/api/consumos', async (req, res) => {
  const { cliente_id, torneira_id, tamanho_ml } = req.body;
  if (!cliente_id || !torneira_id || !tamanho_ml) {
    return res.status(400).json({ error: 'Cliente, torneira e tamanho do copo são obrigatórios.' });
  }
  if (![300, 500, 1000].includes(parseInt(tamanho_ml))) {
    return res.status(400).json({ error: 'Tamanho inválido (use 300, 500 ou 1000).' });
  }
  try {
    const cliente = await dbGet('SELECT * FROM clientes WHERE id = ?', [cliente_id]);
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const torneira = await dbGet('SELECT * FROM torneiras WHERE id = ?', [torneira_id]);
    if (!torneira) return res.status(404).json({ error: 'Torneira não encontrada.' });
    if (torneira.status !== 'ativa') {
      return res.status(400).json({ error: 'Torneira inativa/manutenção.' });
    }

    const tam = parseInt(tamanho_ml);
    const valor = tam === 300 ? torneira.preco_copo_300 : tam === 500 ? torneira.preco_copo_500 : torneira.preco_copo_1000;
    if (!valor || valor <= 0) {
      const nome = tam === 1000 ? 'growler 1L' : `copo de ${tam}ml`;
      return res.status(400).json({ error: `Preço do ${nome} não configurado nesta torneira.` });
    }

    // Estoque: debita do barril montado na torneira (se houver)
    let avisoEstoque = null;
    const barrilId = torneira.barril_id || null;
    if (barrilId) {
      await dbRun('UPDATE barris SET volume_vendido_ml = volume_vendido_ml + ? WHERE id = ?', [tam, barrilId]);
      const barril = await dbGet('SELECT * FROM barris WHERE id = ?', [barrilId]);
      if (barril) {
        const restante = barril.capacidade_ml - barril.volume_vendido_ml;
        if (restante <= 0) {
          avisoEstoque = `Barril da torneira ${torneira.numero} no fim (${(restante / 1000).toFixed(1)} L). Troque ou marque como vazio.`;
        } else if (restante <= 2000) {
          avisoEstoque = `Barril da torneira ${torneira.numero} acabando: ${(restante / 1000).toFixed(1)} L restantes.`;
        }
      }
    }

    await dbRun(
      "INSERT INTO consumos (cliente_id, torneira_id, chopp_nome, tamanho_ml, valor, status, barril_id) VALUES (?, ?, ?, ?, ?, 'aberto', ?)",
      [cliente_id, torneira_id, torneira.chopp_nome, tam, valor, barrilId]
    );

    const total = await totalEmAberto(cliente_id);
    io.emit('comandas_atualizado');
    io.emit('relatorios_atualizado');
    if (barrilId) io.emit('estoque_atualizado');
    res.status(201).json({ message: 'Consumo lançado!', valor, total, avisoEstoque });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Remover um item de consumo em aberto (correção de lançamento)
app.delete('/api/consumos/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const item = await dbGet("SELECT * FROM consumos WHERE id = ? AND status = 'aberto'", [id]);
    if (!item) return res.status(404).json({ error: 'Consumo não encontrado ou já pago.' });
    await dbRun('DELETE FROM consumos WHERE id = ?', [id]);
    // Devolve o volume ao barril de origem (correção de lançamento)
    if (item.barril_id) {
      await dbRun('UPDATE barris SET volume_vendido_ml = MAX(0, volume_vendido_ml - ?) WHERE id = ?', [item.tamanho_ml, item.barril_id]);
      io.emit('estoque_atualizado');
    }
    io.emit('comandas_atualizado');
    io.emit('relatorios_atualizado');
    res.json({ message: 'Consumo removido.', total: await totalEmAberto(item.cliente_id) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Listar todas as comandas em aberto (clientes devendo) — para o Caixa e Dashboard
app.get('/api/comandas-abertas', async (req, res) => {
  try {
    const lista = await dbAll(`
      SELECT c.id as cliente_id, c.nome, c.cpf, c.telefone,
             COUNT(co.id) as qtd_itens,
             SUM(co.valor) as total,
             MIN(co.criado_em) as aberta_desde
      FROM consumos co
      JOIN clientes c ON co.cliente_id = c.id
      WHERE co.status = 'aberto'
      GROUP BY c.id, c.nome, c.cpf, c.telefone
      ORDER BY aberta_desde ASC
    `);
    res.json(lista);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Receber pagamento (fecha a comanda do cliente)
app.post('/api/pagamentos', async (req, res) => {
  const { cliente_id, metodo } = req.body;
  if (!cliente_id || !metodo) {
    return res.status(400).json({ error: 'Cliente e método de pagamento são obrigatórios.' });
  }
  try {
    const itens = await dbAll("SELECT * FROM consumos WHERE cliente_id = ? AND status = 'aberto'", [cliente_id]);
    if (itens.length === 0) {
      return res.status(400).json({ error: 'Não há consumos em aberto para este cliente.' });
    }
    const total = itens.reduce((acc, i) => acc + i.valor, 0);

    const pag = await dbRun(
      "INSERT INTO pagamentos (cliente_id, valor, metodo, tipo) VALUES (?, ?, ?, 'comanda')",
      [cliente_id, total, metodo]
    );
    await dbRun(
      "UPDATE consumos SET status = 'pago', pagamento_id = ? WHERE cliente_id = ? AND status = 'aberto'",
      [pag.id, cliente_id]
    );

    io.emit('comandas_atualizado');
    io.emit('clientes_atualizado');
    io.emit('relatorios_atualizado');
    res.json({ message: 'Pagamento recebido!', valor: total, pagamentoId: pag.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Histórico de pagamentos (geral ou por cliente via ?cliente_id=)
app.get('/api/pagamentos', async (req, res) => {
  const { cliente_id } = req.query;
  try {
    let sql = `
      SELECT p.*, c.nome as cliente_nome, c.cpf as cliente_cpf
      FROM pagamentos p
      JOIN clientes c ON p.cliente_id = c.id
    `;
    const params = [];
    if (cliente_id) {
      sql += ' WHERE p.cliente_id = ?';
      params.push(cliente_id);
    }
    sql += ' ORDER BY p.criado_em DESC';
    const pagamentos = await dbAll(sql, params);
    res.json(pagamentos);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Venda de 2ª via de cartão (cobrada à parte)
app.post('/api/cartao-segunda-via', async (req, res) => {
  const { cliente_id, metodo } = req.body;
  if (!cliente_id || !metodo) {
    return res.status(400).json({ error: 'Cliente e método de pagamento são obrigatórios.' });
  }
  try {
    const cliente = await dbGet('SELECT * FROM clientes WHERE id = ?', [cliente_id]);
    if (!cliente) return res.status(404).json({ error: 'Cliente não encontrado.' });

    const cfg = await dbGet("SELECT valor FROM config WHERE chave = 'valor_segunda_via'");
    const valor = cfg ? parseFloat(cfg.valor) : 0;

    await dbRun(
      "INSERT INTO pagamentos (cliente_id, valor, metodo, tipo) VALUES (?, ?, ?, 'segunda_via')",
      [cliente_id, valor, metodo]
    );
    io.emit('relatorios_atualizado');
    res.json({ message: 'Segunda via registrada!', valor });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Configurações ---
app.get('/api/config/:chave', async (req, res) => {
  try {
    const row = await dbGet('SELECT valor FROM config WHERE chave = ?', [req.params.chave]);
    res.json({ chave: req.params.chave, valor: row ? row.valor : null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/config/:chave', async (req, res) => {
  const { valor } = req.body;
  if (valor === undefined || valor === null) {
    return res.status(400).json({ error: 'Valor é obrigatório.' });
  }
  try {
    await dbRun(
      'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor',
      [req.params.chave, String(valor)]
    );
    res.json({ chave: req.params.chave, valor: String(valor) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ESTOQUE DE BARRIS
// ==========================================

async function registrarMovBarril(barrilId, tipo, torneiraId, restanteMl, obs) {
  await dbRun(
    'INSERT INTO movimentacoes_barril (barril_id, tipo, torneira_id, volume_restante_ml, observacao) VALUES (?, ?, ?, ?, ?)',
    [barrilId, tipo, torneiraId || null, restanteMl != null ? restanteMl : null, obs || null]
  );
}

// Listar todos os barris (com volume restante e torneira)
app.get('/api/barris', async (req, res) => {
  try {
    const barris = await dbAll(`
      SELECT b.*, t.numero as torneira_numero,
             (b.capacidade_ml - b.volume_vendido_ml) as volume_restante_ml
      FROM barris b
      LEFT JOIN torneiras t ON b.torneira_id = t.id
      ORDER BY CASE b.status WHEN 'em_uso' THEN 0 WHEN 'estoque' THEN 1 ELSE 2 END, b.criado_em DESC
    `);
    res.json(barris);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resumo de estoque (KPIs)
app.get('/api/estoque/resumo', async (req, res) => {
  try {
    const disp = await dbGet(`
      SELECT COUNT(*) as qtd,
             COALESCE(SUM(capacidade_ml - volume_vendido_ml), 0) as volume,
             COALESCE(SUM(preco_custo), 0) as valor
      FROM barris WHERE status IN ('estoque', 'em_uso')
    `);
    const emUso = await dbGet("SELECT COUNT(*) as qtd FROM barris WHERE status = 'em_uso'");
    res.json({
      barris_disponiveis: disp.qtd || 0,
      volume_disponivel_ml: disp.volume || 0,
      valor_estoque: disp.valor || 0,
      barris_em_uso: emUso.qtd || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Entrada de barril no estoque
app.post('/api/barris', async (req, res) => {
  const { chopp_nome, estilo, marca, capacidade_litros, preco_custo } = req.body;
  if (!chopp_nome || !capacidade_litros) {
    return res.status(400).json({ error: 'Chopp e capacidade (litros) são obrigatórios.' });
  }
  const capMl = parseFloat(capacidade_litros) * 1000;
  if (isNaN(capMl) || capMl <= 0) {
    return res.status(400).json({ error: 'Capacidade inválida.' });
  }
  try {
    const result = await dbRun(
      "INSERT INTO barris (chopp_nome, estilo, marca, capacidade_ml, preco_custo, status) VALUES (?, ?, ?, ?, ?, 'estoque')",
      [chopp_nome, estilo || null, marca || null, capMl, parseFloat(preco_custo) || 0]
    );
    await registrarMovBarril(result.id, 'entrada', null, capMl, `Entrada: ${chopp_nome}${marca ? ' / ' + marca : ''} (${capacidade_litros} L)`);
    io.emit('estoque_atualizado');
    res.status(201).json({ message: 'Barril adicionado ao estoque!', id: result.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Montar/trocar barril numa torneira
app.post('/api/barris/:id/montar', async (req, res) => {
  const { id } = req.params;
  const { torneira_id } = req.body;
  if (!torneira_id) return res.status(400).json({ error: 'Torneira é obrigatória.' });
  try {
    const barril = await dbGet('SELECT * FROM barris WHERE id = ?', [id]);
    if (!barril) return res.status(404).json({ error: 'Barril não encontrado.' });
    if (barril.status === 'vazio') return res.status(400).json({ error: 'Este barril está marcado como vazio.' });

    const torneira = await dbGet('SELECT * FROM torneiras WHERE id = ?', [torneira_id]);
    if (!torneira) return res.status(404).json({ error: 'Torneira não encontrada.' });

    // Desmonta o barril que já estava na torneira (volta ao estoque com o que sobrou)
    if (torneira.barril_id && torneira.barril_id != id) {
      const atual = await dbGet('SELECT * FROM barris WHERE id = ?', [torneira.barril_id]);
      if (atual) {
        await dbRun("UPDATE barris SET status = 'estoque', torneira_id = NULL WHERE id = ?", [atual.id]);
        await registrarMovBarril(atual.id, 'desmontagem', torneira_id, atual.capacidade_ml - atual.volume_vendido_ml, 'Trocado por outro barril');
      }
    }
    // Se este barril estava em outra torneira, libera a anterior
    if (barril.torneira_id && barril.torneira_id != torneira_id) {
      await dbRun('UPDATE torneiras SET barril_id = NULL WHERE id = ?', [barril.torneira_id]);
    }

    await dbRun("UPDATE barris SET status = 'em_uso', torneira_id = ? WHERE id = ?", [torneira_id, id]);
    // O barril define o chopp da torneira
    await dbRun('UPDATE torneiras SET barril_id = ?, chopp_nome = ? WHERE id = ?', [id, barril.chopp_nome, torneira_id]);
    await registrarMovBarril(id, 'montagem', torneira_id, barril.capacidade_ml - barril.volume_vendido_ml, null);

    io.emit('estoque_atualizado');
    io.emit('torneiras_atualizado');
    res.json({ message: `Barril montado na torneira ${torneira.numero}!` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Desmontar barril (volta ao estoque, NÃO marca vazio)
app.post('/api/barris/:id/desmontar', async (req, res) => {
  const { id } = req.params;
  try {
    const barril = await dbGet('SELECT * FROM barris WHERE id = ?', [id]);
    if (!barril) return res.status(404).json({ error: 'Barril não encontrado.' });
    if (barril.torneira_id) {
      await dbRun('UPDATE torneiras SET barril_id = NULL WHERE id = ?', [barril.torneira_id]);
    }
    await dbRun("UPDATE barris SET status = 'estoque', torneira_id = NULL WHERE id = ?", [id]);
    await registrarMovBarril(id, 'desmontagem', barril.torneira_id, barril.capacidade_ml - barril.volume_vendido_ml, 'Desmontado — volta ao estoque');
    io.emit('estoque_atualizado');
    io.emit('torneiras_atualizado');
    res.json({ message: 'Barril desmontado e devolvido ao estoque.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Marcar barril como vazio (calcula a perda real)
app.post('/api/barris/:id/vazio', async (req, res) => {
  const { id } = req.params;
  try {
    const barril = await dbGet('SELECT * FROM barris WHERE id = ?', [id]);
    if (!barril) return res.status(404).json({ error: 'Barril não encontrado.' });

    const vendido = barril.volume_vendido_ml;
    const perda = barril.capacidade_ml - vendido;
    const perdaPct = barril.capacidade_ml > 0 ? (perda / barril.capacidade_ml) * 100 : 0;

    if (barril.torneira_id) {
      await dbRun('UPDATE torneiras SET barril_id = NULL WHERE id = ?', [barril.torneira_id]);
    }
    await dbRun("UPDATE barris SET status = 'vazio', torneira_id = NULL, esvaziado_em = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    await registrarMovBarril(id, 'vazio', barril.torneira_id, 0,
      `Vendido ${(vendido / 1000).toFixed(1)} L · perda ${(perda / 1000).toFixed(1)} L (${perdaPct.toFixed(1)}%)`);

    io.emit('estoque_atualizado');
    io.emit('torneiras_atualizado');
    res.json({
      message: 'Barril marcado como vazio.',
      vendido_litros: +(vendido / 1000).toFixed(2),
      perda_litros: +(perda / 1000).toFixed(2),
      perda_pct: +perdaPct.toFixed(1)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Excluir barril (apenas se não estiver em uso)
app.delete('/api/barris/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const barril = await dbGet('SELECT * FROM barris WHERE id = ?', [id]);
    if (!barril) return res.status(404).json({ error: 'Barril não encontrado.' });
    if (barril.status === 'em_uso') return res.status(400).json({ error: 'Desmonte o barril da torneira antes de excluir.' });
    await dbRun('DELETE FROM movimentacoes_barril WHERE barril_id = ?', [id]);
    await dbRun('DELETE FROM barris WHERE id = ?', [id]);
    io.emit('estoque_atualizado');
    res.json({ message: 'Barril removido.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Histórico de movimentações (relatório de entradas/trocas)
app.get('/api/movimentacoes-barril', async (req, res) => {
  try {
    const movs = await dbAll(`
      SELECT m.*, b.chopp_nome, t.numero as torneira_numero
      FROM movimentacoes_barril m
      JOIN barris b ON m.barril_id = b.id
      LEFT JOIN torneiras t ON m.torneira_id = t.id
      ORDER BY m.criado_em DESC
      LIMIT 50
    `);
    res.json(movs);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// FINANCEIRO — margem e lucro (bruto)
// ==========================================
app.get('/api/financeiro/resumo', async (req, res) => {
  try {
    const recComanda = await dbGet("SELECT COALESCE(SUM(valor),0) as t FROM pagamentos WHERE tipo = 'comanda'");
    const recSegVia = await dbGet("SELECT COALESCE(SUM(valor),0) as t FROM pagamentos WHERE tipo = 'segunda_via'");
    // CMV: custo proporcional ao volume vendido de cada barril
    const cmvRow = await dbGet("SELECT COALESCE(SUM(preco_custo * volume_vendido_ml / capacidade_ml),0) as t FROM barris WHERE capacidade_ml > 0");
    // Capital parado: custo dos barris ainda disponíveis (estoque + em uso)
    const investidoRow = await dbGet("SELECT COALESCE(SUM(preco_custo),0) as t FROM barris WHERE status IN ('estoque','em_uso')");
    const cfg = await dbGet("SELECT valor FROM config WHERE chave = 'markup_padrao'");

    const receitaComandas = recComanda.t || 0;
    const cmv = cmvRow.t || 0;
    const lucroBruto = receitaComandas - cmv;
    const margemPct = receitaComandas > 0 ? (lucroBruto / receitaComandas) * 100 : 0;

    res.json({
      receita_comandas: receitaComandas,
      receita_segunda_via: recSegVia.t || 0,
      cmv,
      lucro_bruto: lucroBruto,
      margem_pct: +margemPct.toFixed(1),
      investido_estoque: investidoRow.t || 0,
      markup_padrao: cfg ? parseFloat(cfg.valor) : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// AMBIENTE DE TESTES (apenas para simulação/demonstração)
// ==========================================

// Envelhece a comanda aberta de um cliente (para testar as cores 12h/48h sem esperar)
app.post('/api/teste/envelhecer-comanda', async (req, res) => {
  const { cliente_id, horas } = req.body;
  if (!cliente_id || horas === undefined) {
    return res.status(400).json({ error: 'cliente_id e horas são obrigatórios.' });
  }
  try {
    const h = parseInt(horas);
    if (isPg) {
      await dbRun(
        `UPDATE consumos SET criado_em = now() - (? * interval '1 hour') WHERE cliente_id = ? AND status = 'aberto'`,
        [h, cliente_id]
      );
    } else {
      await dbRun(
        `UPDATE consumos SET criado_em = datetime('now', ?) WHERE cliente_id = ? AND status = 'aberto'`,
        [`-${h} hours`, cliente_id]
      );
    }
    io.emit('comandas_atualizado');
    res.json({ message: `Comanda envelhecida em ${h}h para teste.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// INTEGRAÇÃO COM HARDWARE E SIMULADOR
// ==========================================

// 1. APROXIMAR CARTÃO (NFC SWIPE)
app.post('/api/hardware/aproximar-cartao', async (req, res) => {
  const { uid, torneiraNumero } = req.body;

  if (!uid || !torneiraNumero) {
    return res.status(400).json({ error: 'UID e número da torneira são obrigatórios.' });
  }

  try {
    // Busca cartão e cliente
    const cartao = await dbGet(`
      SELECT c.*, cl.id as cliente_id, cl.nome as cliente_nome, cl.saldo as cliente_saldo, cl.status as cliente_status
      FROM cartoes_nfc c
      JOIN clientes cl ON c.cliente_id = cl.id
      WHERE c.uid = ? AND c.status = 'ativo'
    `, [uid]);

    if (!cartao) {
      return res.status(400).json({ status: 'negado', error: 'Cartão inválido, inativo ou desvinculado.' });
    }

    if (cartao.cliente_status !== 'ativo') {
      return res.status(400).json({ status: 'negado', error: 'Conta do cliente desativada.' });
    }

    if (cartao.cliente_saldo <= 0) {
      return res.status(400).json({ status: 'negado', error: 'Saldo insuficiente. Recarregue seu cartão!' });
    }

    // Busca torneira
    const torneira = await dbGet('SELECT * FROM torneiras WHERE numero = ? AND status = \'ativa\'', [torneiraNumero]);
    if (!torneira) {
      return res.status(400).json({ status: 'negado', error: 'Torneira não encontrada ou em manutenção.' });
    }

    // Verifica se já existe uma sessão em aberto nessa torneira e finaliza
    const sessaoAberta = await dbGet('SELECT * FROM sessoes_consumo WHERE torneira_id = ? AND status = \'em_andamento\'', [torneira.id]);
    if (sessaoAberta) {
      await dbRun('UPDATE sessoes_consumo SET status = \'finalizada\', atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [sessaoAberta.id]);
    }

    // Inicia nova sessão
    const result = await dbRun(`
      INSERT INTO sessoes_consumo (cliente_id, torneira_id, cartao_uid, saldo_inicial, ml_consumido, valor_pago, status)
      VALUES (?, ?, ?, ?, 0.0, 0.0, 'em_andamento')
    `, [cartao.cliente_id, torneira.id, uid, cartao.cliente_saldo]);

    const sessaoId = result.id;

    // Transmite alteração de status para o Websocket
    io.emit('torneira_estado', {
      torneiraNumero,
      estado: 'liberada',
      sessaoId,
      cliente: cartao.cliente_nome,
      saldo: cartao.cliente_saldo,
      chopp: torneira.chopp_nome
    });

    res.json({
      status: 'liberado',
      cliente: {
        id: cartao.cliente_id,
        nome: cartao.cliente_nome,
        saldo: cartao.cliente_saldo
      },
      torneira: {
        id: torneira.id,
        chopp_nome: torneira.chopp_nome,
        chopp_preco_litro: torneira.chopp_preco_litro
      },
      sessaoId
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. ATUALIZAR FLUXO (SIMULAÇÃO / LEITURA DO SENSOR DE ML)
app.post('/api/hardware/atualizar-fluxo', async (req, res) => {
  const { sessaoId, mlConsumido } = req.body;

  if (sessaoId === undefined || mlConsumido === undefined) {
    return res.status(400).json({ error: 'Sessão ID e ML consumido são obrigatórios.' });
  }

  try {
    // Busca a sessão
    const sessao = await dbGet(`
      SELECT s.*, t.chopp_preco_litro, t.numero as torneira_numero, t.chopp_nome, c.nome as cliente_nome, c.saldo as cliente_saldo
      FROM sessoes_consumo s
      JOIN torneiras t ON s.torneira_id = t.id
      JOIN clientes c ON s.cliente_id = c.id
      WHERE s.id = ?
    `, [sessaoId]);

    if (!sessao) {
      return res.status(404).json({ error: 'Sessão não encontrada.' });
    }

    if (sessao.status !== 'em_andamento') {
      return res.json({ status: 'bloqueado', error: 'Esta sessão de consumo já foi encerrada.' });
    }

    // Calcula o custo
    const precoPorMl = sessao.chopp_preco_litro / 1000.0;
    let custo = parseFloat((mlConsumido * precoPorMl).toFixed(4));
    let mlFinal = mlConsumido;
    let finalizaSessao = false;

    const saldoDisponivel = sessao.saldo_inicial;

    // Se o custo atingir ou passar o saldo, encerra e corta
    if (custo >= saldoDisponivel) {
      custo = saldoDisponivel;
      mlFinal = parseFloat((custo / precoPorMl).toFixed(1)); // ml máximo comprado com o saldo
      finalizaSessao = true;
    }

    // Calcula a diferença em relação ao que já foi pago nesta sessão para abater do saldo do cliente
    const diferencaAPagar = custo - sessao.valor_pago;

    // Atualiza o saldo do cliente no banco de dados
    const novoSaldo = Math.max(0, sessao.cliente_saldo - diferencaAPagar);
    await dbRun('UPDATE clientes SET saldo = ? WHERE id = ?', [novoSaldo, sessao.cliente_id]);

    // Atualiza os dados da sessão de consumo
    const statusSessao = finalizaSessao ? 'finalizada' : 'em_andamento';
    await dbRun(`
      UPDATE sessoes_consumo
      SET ml_consumido = ?, valor_pago = ?, status = ?, atualizado_em = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [mlFinal, custo, statusSessao, sessaoId]);

    // Se finalizou, cria um registro de histórico de consumo
    if (finalizaSessao) {
      await dbRun(`
        INSERT INTO historico_consumo (sessao_id, cliente_id, torneira_id, ml_consumido, valor_pago)
        VALUES (?, ?, ?, ?, ?)
      `, [sessaoId, sessao.cliente_id, sessao.torneira_id, mlFinal, custo]);
    }

    // Envia dados em tempo real para os painéis via Socket.io
    io.emit('consumo_tempo_real', {
      torneiraNumero: sessao.torneira_numero,
      ml: mlFinal,
      custo: custo.toFixed(2),
      saldoRestante: novoSaldo.toFixed(2),
      status: statusSessao
    });

    if (finalizaSessao) {
      io.emit('torneira_estado', {
        torneiraNumero: sessao.torneira_numero,
        estado: 'bloqueada',
        motivo: 'Saldo Esgotado'
      });
      io.emit('clientes_atualizado');
      io.emit('relatorios_atualizado');
    }

    res.json({
      status: statusSessao === 'finalizada' ? 'bloqueado' : 'liberado',
      mlConsumido: mlFinal,
      custo: custo,
      saldoRestante: novoSaldo
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. FECHAR TORNEIRA MANUALMENTE (Pelo gatilho visual ou interrupção do copo)
app.post('/api/hardware/fechar-torneira', async (req, res) => {
  const { sessaoId } = req.body;

  if (!sessaoId) {
    return res.status(400).json({ error: 'Sessão ID é obrigatório.' });
  }

  try {
    const sessao = await dbGet(`
      SELECT s.*, t.numero as torneira_numero, c.nome as cliente_nome 
      FROM sessoes_consumo s
      JOIN torneiras t ON s.torneira_id = t.id
      JOIN clientes c ON s.cliente_id = c.id
      WHERE s.id = ?
    `, [sessaoId]);

    if (!sessao) {
      return res.status(404).json({ error: 'Sessão não encontrada.' });
    }

    if (sessao.status === 'finalizada') {
      return res.json({ message: 'A torneira já está fechada para esta sessão.' });
    }

    // Finaliza a sessão
    await dbRun(`
      UPDATE sessoes_consumo 
      SET status = 'finalizada', atualizado_em = CURRENT_TIMESTAMP 
      WHERE id = ?
    `, [sessaoId]);

    // Registra no histórico de consumo final
    await dbRun(`
      INSERT INTO historico_consumo (sessao_id, cliente_id, torneira_id, ml_consumido, valor_pago)
      VALUES (?, ?, ?, ?, ?)
    `, [sessaoId, sessao.cliente_id, sessao.torneira_id, sessao.ml_consumido, sessao.valor_pago]);

    // Transmite o encerramento no Websocket
    io.emit('torneira_estado', {
      torneiraNumero: sessao.torneira_numero,
      estado: 'bloqueada',
      motivo: 'Fluxo Encerrado'
    });

    io.emit('clientes_atualizado');
    io.emit('relatorios_atualizado');

    res.json({ status: 'finalizada', message: 'Torneira fechada e consumo registrado com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// CONTROLE DE CONEXÃO DO SOCKET.IO
// ==========================================
io.on('connection', (socket) => {
  console.log('Cliente conectado ao Websocket:', socket.id);
  
  // Transmite leitura NFC (do simulador OU do leitor físico) para TODAS as telas,
  // incluindo a própria que leu — assim a tela ativa reage ao cartão encostado.
  socket.on('nfc_lido', (data) => {
    io.emit('nfc_lido', data);
  });

  socket.on('disconnect', () => {
    console.log('Cliente desconectado do Websocket:', socket.id);
  });
});

// ==========================================
// INICIALIZAÇÃO DO SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Acesse o portal do autoatendimento em http://localhost:${PORT}`);
});
