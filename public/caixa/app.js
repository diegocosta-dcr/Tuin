// ============================================================
// TUIN Your Beer — Caixa (lógica da página)
// shared.js já declara: const socket = io(); e function showToast().
// NÃO redeclarar socket nem showToast aqui.
// ============================================================

// Estado do pagamento atualmente aberto no modal
let comandaAtual = null;      // { cliente_id, nome, total }
let metodoSelecionado = 'PIX';

// ── Helpers ──────────────────────────────────────────────

// Formata número para moeda BRL: "R$ 0,00"
function formatarMoeda(valor) {
  const n = Number(valor) || 0;
  return 'R$ ' + n.toFixed(2).replace('.', ',');
}

// Converte string do SQLite (UTC "YYYY-MM-DD HH:MM:SS") para Date
function parseDataUTC(dataStr) {
  if (!dataStr) return null;
  const iso = String(dataStr).replace(' ', 'T') + (String(dataStr).includes('Z') ? '' : 'Z');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

// Formata data para data/hora pt-BR
function formatarDataHora(dataStr) {
  const d = parseDataUTC(dataStr);
  if (!d) return dataStr || '-';
  return d.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// Calcula "há quanto tempo" de forma amigável (ex: "há 2 h 15 min")
function tempoDecorrido(dataStr) {
  const d = parseDataUTC(dataStr);
  if (!d) return '';
  let diff = Math.floor((Date.now() - d.getTime()) / 1000); // segundos
  if (diff < 60) return 'há instantes';
  const min = Math.floor(diff / 60);
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return m > 0 ? `há ${h} h ${m} min` : `há ${h} h`;
  const dias = Math.floor(h / 24);
  return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Ícone por método de pagamento
function iconeMetodo(metodo) {
  if (metodo === 'PIX') return 'fa-qrcode';
  if (metodo === 'Cartao') return 'fa-credit-card';
  if (metodo === 'Dinheiro') return 'fa-money-bill-wave';
  return 'fa-circle-dollar-to-slot';
}

// ── Carregamento de comandas abertas + KPIs ──────────────

async function carregarComandasAbertas() {
  const tbody = document.getElementById('comandasTableBody');
  try {
    const resp = await fetch('/api/comandas-abertas');
    if (!resp.ok) throw new Error('Falha ao carregar comandas abertas');
    const comandas = await resp.json();

    // KPIs
    const totalAberto = comandas.reduce((acc, c) => acc + (Number(c.total) || 0), 0);
    document.getElementById('kpiTotalAberto').innerText = formatarMoeda(totalAberto);
    document.getElementById('kpiQtdAberto').innerText = comandas.length;

    // Tabela
    if (!comandas.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Nenhuma comanda em aberto no momento.</td></tr>';
      return;
    }

    tbody.innerHTML = comandas.map(c => {
      const doc = escapeHtml(c.cpf || '—');
      const tel = c.telefone ? `<small>${escapeHtml(c.telefone)}</small>` : '';
      const nivel = nivelComanda(c.aberta_desde);
      const trClass = nivel !== 'normal' ? ` class="comanda-nivel-${nivel}"` : '';
      const tempoClass = nivel !== 'normal' ? ` ${nivel}` : '';
      return `
        <tr${trClass} data-cliente-id="${c.cliente_id}" data-nome="${escapeHtml(c.nome)}">
          <td><span class="cli-nome">${escapeHtml(c.nome)}</span></td>
          <td class="cli-doc">${doc}${tel}</td>
          <td><span class="badge-itens"><i class="fa-solid fa-mug-hot"></i> ${c.qtd_itens}</span></td>
          <td class="col-tempo">${formatarDataHora(c.aberta_desde)}<br><span class="tempo-badge${tempoClass}">${tempoDecorrido(c.aberta_desde)}</span></td>
          <td class="col-total">${formatarMoeda(c.total)}</td>
          <td class="cell-acao">
            <button type="button" class="btn btn-primary btn-receber" data-cliente-id="${c.cliente_id}" data-nome="${escapeHtml(c.nome)}">
              <i class="fa-solid fa-hand-holding-dollar"></i> Receber
            </button>
          </td>
        </tr>`;
    }).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Erro ao carregar comandas.</td></tr>';
    showToast(err.message, 'error');
  }
}

// ── Histórico de pagamentos ──────────────────────────────

async function carregarHistoricoPagamentos() {
  const tbody = document.getElementById('pagamentosTableBody');
  try {
    const resp = await fetch('/api/pagamentos');
    if (!resp.ok) throw new Error('Falha ao carregar histórico');
    let pagamentos = await resp.json();

    if (!Array.isArray(pagamentos) || !pagamentos.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Nenhum pagamento registrado ainda.</td></tr>';
      return;
    }

    // Mostra os mais recentes primeiro (limita a 30 linhas)
    pagamentos = pagamentos.slice().reverse().slice(0, 30);

    tbody.innerHTML = pagamentos.map(p => `
      <tr>
        <td>${escapeHtml(p.cliente_nome || '—')}</td>
        <td class="col-total">${formatarMoeda(p.valor)}</td>
        <td><span class="badge-metodo"><i class="fa-solid ${iconeMetodo(p.metodo)}"></i> ${escapeHtml(p.metodo || '—')}</span></td>
        <td class="col-tempo">${formatarDataHora(p.criado_em)}</td>
      </tr>`).join('');
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="4" class="table-empty">Erro ao carregar histórico.</td></tr>';
  }
}

// ── Recarrega tudo ───────────────────────────────────────

function recarregarTudo() {
  carregarComandasAbertas();
  carregarHistoricoPagamentos();
}

// ── Modal de pagamento ───────────────────────────────────

async function abrirModalPagamento(clienteId, nome) {
  comandaAtual = { cliente_id: clienteId, nome: nome, total: 0 };
  metodoSelecionado = 'PIX';
  selecionarMetodo('PIX');

  document.getElementById('pagClienteNome').innerText = nome || '-';
  document.getElementById('pagTotalValor').innerText = formatarMoeda(0);
  document.getElementById('pagItensBody').innerHTML =
    '<tr><td colspan="4" class="table-empty">Carregando...</td></tr>';

  document.getElementById('modalPagamento').classList.add('active');

  // Busca os itens em aberto da comanda
  try {
    const resp = await fetch(`/api/comanda/${clienteId}`);
    if (!resp.ok) throw new Error('Falha ao carregar a comanda');
    const data = await resp.json();

    const itens = data.itens || [];
    const total = Number(data.total) || 0;
    comandaAtual.total = total;
    if (data.cliente && data.cliente.nome) {
      document.getElementById('pagClienteNome').innerText = data.cliente.nome;
      comandaAtual.nome = data.cliente.nome;
    }
    document.getElementById('pagTotalValor').innerText = formatarMoeda(total);

    const body = document.getElementById('pagItensBody');
    if (!itens.length) {
      body.innerHTML = '<tr><td colspan="4" class="table-empty">Sem itens em aberto.</td></tr>';
    } else {
      body.innerHTML = itens.map(it => `
        <tr>
          <td>${escapeHtml(it.chopp_nome)}</td>
          <td>Nº ${escapeHtml(it.torneira_numero)}</td>
          <td>${it.tamanho_ml} ml</td>
          <td style="text-align:right;">${formatarMoeda(it.valor)}</td>
        </tr>`).join('');
    }
  } catch (err) {
    document.getElementById('pagItensBody').innerHTML =
      '<tr><td colspan="4" class="table-empty">Erro ao carregar itens.</td></tr>';
    showToast(err.message, 'error');
  }
}

function fecharModalPagamento() {
  document.getElementById('modalPagamento').classList.remove('active');
  comandaAtual = null;
}

function selecionarMetodo(metodo) {
  metodoSelecionado = metodo;
  document.querySelectorAll('.metodo-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.metodo === metodo);
  });
}

// ── Confirmar pagamento ──────────────────────────────────

async function confirmarPagamento() {
  if (!comandaAtual) return;
  const btn = document.getElementById('btnConfirmarPagamento');
  btn.disabled = true;

  try {
    const resp = await fetch('/api/pagamentos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cliente_id: comandaAtual.cliente_id, metodo: metodoSelecionado })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Erro ao registrar pagamento');

    showToast(`Pagamento de ${formatarMoeda(data.valor)} recebido via ${metodoSelecionado}.`, 'success');
    fecharModalPagamento();
    recarregarTudo();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── Configuração Custo 2ª Via ─────────────────────────────

async function carregarConfigSegundaVia() {
  const input = document.getElementById('inputSegundaViaValor');
  if (!input) return;

  try {
    const resp = await fetch('/api/config/valor_segunda_via');
    if (!resp.ok) throw new Error();
    const data = await resp.json();
    if (data && data.valor) {
      input.value = parseFloat(data.valor).toFixed(2);
    }
  } catch (err) {
    console.error('Erro ao carregar custo da 2ª via', err);
  }
}

async function salvarConfigSegundaVia(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('inputSegundaViaValor');
  if (!input) return;

  const valor = parseFloat(input.value);
  if (isNaN(valor) || valor < 0) {
    showToast('Insira um valor válido para a 2ª via.', 'error');
    return;
  }

  try {
    const resp = await fetch('/api/config/valor_segunda_via', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ valor: valor.toFixed(2) })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Erro ao salvar configuração');

    showToast('Custo da 2ª via atualizado!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ── Inicialização ────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  recarregarTudo();
  carregarConfigSegundaVia();

  // Salvar configuração da 2ª via
  const formConfig = document.getElementById('formConfigSegundaVia');
  if (formConfig) formConfig.addEventListener('submit', salvarConfigSegundaVia);

  // Atualizar manualmente
  const btnRec = document.getElementById('btnRecarregarLista');
  if (btnRec) btnRec.addEventListener('click', recarregarTudo);

  // Delegação de clique na tabela de comandas (linha ou botão "Receber")
  document.getElementById('comandasTableBody').addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-receber');
    const linha = e.target.closest('tr[data-cliente-id]');
    const alvo = btn || linha;
    if (!alvo) return;
    const clienteId = alvo.dataset.clienteId;
    const nome = alvo.dataset.nome;
    if (clienteId) abrirModalPagamento(clienteId, nome);
  });

  // Botões de método de pagamento
  document.getElementById('metodoGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.metodo-btn');
    if (btn) selecionarMetodo(btn.dataset.metodo);
  });

  // Fechar / cancelar modal
  document.getElementById('btnFecharModal').addEventListener('click', fecharModalPagamento);
  document.getElementById('btnCancelarPagamento').addEventListener('click', fecharModalPagamento);
  document.getElementById('modalPagamento').addEventListener('click', (e) => {
    if (e.target.id === 'modalPagamento') fecharModalPagamento();
  });

  // Confirmar pagamento
  document.getElementById('btnConfirmarPagamento').addEventListener('click', confirmarPagamento);

  // Tempo real
  socket.on('comandas_atualizado', recarregarTudo);
  socket.on('clientes_atualizado', carregarComandasAbertas);

  // Aproximar cartão NFC: abre direto o pagamento do cliente (igual ao Atendimento)
  socket.on('nfc_lido', async (data) => {
    if (!data || !data.uid) return;
    try {
      const res = await fetch(`/api/cartoes/${data.uid}`);
      if (!res.ok) { showToast('Cartão não cadastrado.', 'error'); return; }
      const cartao = await res.json();
      if (!cartao || !cartao.cliente_id) return;

      // Só abre o pagamento se houver comanda em aberto
      const cRes = await fetch(`/api/comanda/${cartao.cliente_id}`);
      const cData = cRes.ok ? await cRes.json() : null;
      if (cData && Number(cData.total) > 0) {
        showToast(`Cartão de ${cartao.cliente_nome || 'cliente'} — abrindo pagamento.`, 'success');
        abrirModalPagamento(cartao.cliente_id, cartao.cliente_nome);
      } else {
        showToast(`${cartao.cliente_nome || 'Cliente'} não tem comanda em aberto.`, 'info');
      }
    } catch (err) {
      // silencioso
    }
  });
});
