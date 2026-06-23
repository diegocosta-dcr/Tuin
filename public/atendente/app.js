/* ============================================================
   Atendimento — TUIN Your Beer (Comanda Digital)
   shared.js JÁ declara as globais: socket e showToast.
   Aqui NÃO redeclaramos const socket nem function showToast.
   ============================================================ */

// ── Estado da página ──
let clientes = [];          // lista de clientes (GET /api/clientes)
let abertasPorCliente = {}; // mapa cliente_id -> {qtd_itens, total, aberta_desde}
let clienteAtivoId = null;  // cliente do modal aberto (null = fechado)

// ── Elementos do DOM ──
const buscaInput    = document.getElementById('buscaInput');
const buscaInfo     = document.getElementById('buscaInfo');
const clientesGrid  = document.getElementById('clientesGrid');

const modalComanda     = document.getElementById('modalComanda');
const comandaNome      = document.getElementById('comandaNome');
const comandaTelefone  = document.getElementById('comandaTelefone');
const comandaCpf       = document.getElementById('comandaCpf');
const comandaTotal     = document.getElementById('comandaTotal');
const comandaItens     = document.getElementById('comandaItens');
const torneirasGrid    = document.getElementById('torneirasGrid');
const comandaHistorico = document.getElementById('comandaHistorico');
const comandaTempo     = document.getElementById('comandaTempo');
const comandaTotalCard = document.getElementById('comandaTotalCard');

// ── Helpers ──
function formatarBRL(valor) {
    const n = Number(valor) || 0;
    return 'R$ ' + n.toFixed(2).replace('.', ',');
}

function escaparHtml(txt) {
    return String(txt ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ════════════════════════════════════════════
//  CARREGAR LISTA DE CLIENTES + COMANDAS ABERTAS
// ════════════════════════════════════════════
async function carregarDadosPagina() {
    try {
        const [resClientes, resAbertas] = await Promise.all([
            fetch('/api/clientes'),
            fetch('/api/comandas-abertas')
        ]);

        if (!resClientes.ok) throw new Error('Erro ao buscar clientes');
        clientes = await resClientes.json();

        const abertas = resAbertas.ok ? await resAbertas.json() : [];
        abertasPorCliente = {};
        abertas.forEach(a => {
            abertasPorCliente[a.cliente_id] = {
                qtd_itens: a.qtd_itens,
                total: a.total,
                aberta_desde: a.aberta_desde
            };
        });

        renderizarClientes();
    } catch (err) {
        console.error(err);
        showToast('Não foi possível carregar os clientes.', 'error');
        clientesGrid.innerHTML = '<div class="grid-vazio">Erro ao carregar clientes.</div>';
    }
}

// ════════════════════════════════════════════
//  RENDERIZAR GRID DE CLIENTES (com filtro)
// ════════════════════════════════════════════
function renderizarClientes() {
    const q = buscaInput.value.toLowerCase().trim();

    const filtrados = clientes.filter(c => {
        // Sem busca: mostra APENAS clientes com comanda em aberto.
        if (!q) return !!abertasPorCliente[c.id];
        // Com busca: mostra qualquer cliente que casar (permite iniciar nova comanda).
        const nomeMatch = (c.nome || '').toLowerCase().includes(q);
        const cpfMatch  = (c.cpf || '').toLowerCase().replace(/\D/g, '').includes(q.replace(/\D/g, '')) && q.replace(/\D/g, '') !== '';
        const cpfTexto  = (c.cpf || '').toLowerCase().includes(q);
        return nomeMatch || cpfMatch || cpfTexto;
    });

    // Ordena: comandas abertas primeiro, depois alfabético
    filtrados.sort((a, b) => {
        const aAberta = abertasPorCliente[a.id] ? 1 : 0;
        const bAberta = abertasPorCliente[b.id] ? 1 : 0;
        if (aAberta !== bAberta) return bAberta - aAberta;
        return (a.nome || '').localeCompare(b.nome || '');
    });

    // Resumo
    const totalAbertas = Object.keys(abertasPorCliente).length;
    buscaInfo.textContent = `${totalAbertas} comanda(s) aberta(s) · ${clientes.length} cliente(s)`;

    if (filtrados.length === 0) {
        clientesGrid.innerHTML = q
            ? '<div class="grid-vazio">Nenhum cliente encontrado.</div>'
            : '<div class="grid-vazio">Nenhuma comanda aberta. Busque um cliente (ou aproxime o cartão) para iniciar.</div>';
        return;
    }

    clientesGrid.innerHTML = '';
    filtrados.forEach(c => {
        const aberta = abertasPorCliente[c.id];
        const temAberto = aberta && Number(aberta.total) > 0;
        const total = aberta ? Number(aberta.total) : 0;

        const nivel = temAberto ? nivelComanda(aberta.aberta_desde) : 'normal';

        const card = document.createElement('div');
        card.className = 'cliente-card' + (temAberto ? ' tem-aberto' : '')
            + (nivel !== 'normal' ? ' comanda-nivel-' + nivel : '');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.dataset.id = c.id;

        const subInfo = c.cpf
            ? `<i class="fa-solid fa-id-card"></i> ${escaparHtml(c.cpf)}`
            : (c.telefone ? `<i class="fa-solid fa-phone"></i> ${escaparHtml(c.telefone)}` : '<span class="cliente-card-sem">Sem CPF</span>');

        const tempoHtml = temAberto
            ? `<span class="tempo-badge ${nivel !== 'normal' ? nivel : ''}">${tempoAberta(aberta.aberta_desde)}</span>`
            : '';

        const valorHtml = temAberto
            ? `<span class="cliente-card-valor">${formatarBRL(total)}</span>
               <span class="cliente-card-status">${aberta.qtd_itens || 0} item(ns) · ${tempoHtml}</span>`
            : `<span class="cliente-card-valor zero">R$ 0,00</span>
               <span class="cliente-card-status livre">sem comanda</span>`;

        card.innerHTML = `
            <div class="cliente-card-top">
                <div class="cliente-avatar"><i class="fa-solid fa-user"></i></div>
                <div class="cliente-card-info">
                    <span class="cliente-card-nome">${escaparHtml(c.nome)}</span>
                    <span class="cliente-card-sub">${subInfo}</span>
                </div>
            </div>
            <div class="cliente-card-bottom">${valorHtml}</div>
        `;

        card.addEventListener('click', () => abrirComanda(c.id));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                abrirComanda(c.id);
            }
        });

        clientesGrid.appendChild(card);
    });
}

// ════════════════════════════════════════════
//  MODAL DA COMANDA
// ════════════════════════════════════════════
async function abrirComanda(clienteId) {
    clienteAtivoId = clienteId;
    modalComanda.classList.add('active');
    // Estado de carregamento
    comandaItens.innerHTML = '<div class="lista-vazia">Carregando comanda...</div>';
    torneirasGrid.innerHTML = '<div class="lista-vazia">Carregando torneiras...</div>';
    comandaTotal.textContent = 'R$ 0,00';

    await Promise.all([
        carregarComanda(clienteId),
        carregarTorneiras()
    ]);
}

function fecharComanda() {
    clienteAtivoId = null;
    modalComanda.classList.remove('active');
}

// Carrega cabeçalho + itens + total da comanda
async function carregarComanda(clienteId) {
    try {
        const res = await fetch(`/api/comanda/${clienteId}`);
        if (!res.ok) throw new Error('Erro ao carregar comanda');
        const data = await res.json();

        const cli = data.cliente || {};
        comandaNome.textContent = cli.nome || 'Cliente';
        comandaTelefone.innerHTML = `<i class="fa-solid fa-phone"></i> ${escaparHtml(cli.telefone || '—')}`;
        comandaCpf.innerHTML = `<i class="fa-solid fa-id-card"></i> ${escaparHtml(cli.cpf || '—')}`;
        comandaTotal.textContent = formatarBRL(data.total);

        // Tempo de comanda aberta + cor (12h amarelo / 48h vermelho)
        const itens = data.itens || [];
        comandaTotalCard.classList.remove('comanda-nivel-atencao', 'comanda-nivel-critico');
        if (itens.length) {
            const desde = itens[itens.length - 1].criado_em; // item mais antigo = abertura
            const nivel = nivelComanda(desde);
            comandaTempo.style.display = '';
            comandaTempo.textContent = 'Aberta ' + tempoAberta(desde);
            comandaTempo.className = 'tempo-badge' + (nivel !== 'normal' ? ' ' + nivel : '');
            if (nivel !== 'normal') comandaTotalCard.classList.add('comanda-nivel-' + nivel);
        } else {
            comandaTempo.style.display = 'none';
        }

        renderizarItens(itens);
        renderizarHistorico(data.historico || []);
    } catch (err) {
        console.error(err);
        showToast('Erro ao carregar a comanda.', 'error');
        comandaItens.innerHTML = '<div class="lista-vazia">Erro ao carregar itens.</div>';
    }
}

function renderizarItens(itens) {
    if (!itens || itens.length === 0) {
        comandaItens.innerHTML = '<div class="lista-vazia">Nenhum item lançado ainda.</div>';
        return;
    }

    comandaItens.innerHTML = '';
    itens.forEach(it => {
        const linha = document.createElement('div');
        linha.className = 'item-linha';
        linha.innerHTML = `
            <div class="item-info">
                <span class="item-nome">${escaparHtml(it.chopp_nome || 'Chopp')}</span>
                <span class="item-detalhe">
                    <i class="fa-solid fa-faucet-drip"></i> Torneira ${escaparHtml(it.torneira_numero ?? '?')}
                    · ${escaparHtml(nomeTamanho(it.tamanho_ml))}
                </span>
            </div>
            <div class="item-acoes">
                <span class="item-valor">${formatarBRL(it.valor)}</span>
                <button class="btn-lixeira" type="button" title="Remover item" data-id="${it.id}">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        linha.querySelector('.btn-lixeira').addEventListener('click', () => removerItem(it.id));
        comandaItens.appendChild(linha);
    });
}

// Renderiza o histórico de chopps já consumidos (pagos)
function renderizarHistorico(historico) {
    if (!historico || historico.length === 0) {
        comandaHistorico.innerHTML = '<div class="lista-vazia">Sem histórico de consumo.</div>';
        return;
    }
    comandaHistorico.innerHTML = '';
    historico.forEach(h => {
        let dataTxt = '';
        try {
            dataTxt = new Date(String(h.criado_em).replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR');
        } catch (e) { dataTxt = ''; }
        const linha = document.createElement('div');
        linha.className = 'item-linha historico-linha';
        linha.innerHTML = `
            <div class="item-info">
                <span class="item-nome">${escaparHtml(h.chopp_nome || 'Chopp')}</span>
                <span class="item-detalhe">
                    <i class="fa-solid fa-calendar-day"></i> ${dataTxt} · ${escaparHtml(nomeTamanho(h.tamanho_ml))}
                </span>
            </div>
            <span class="item-valor" style="color: var(--t2);">${formatarBRL(h.valor)}</span>
        `;
        comandaHistorico.appendChild(linha);
    });
}

// Carrega torneiras ATIVAS com botões de 300/500ml
async function carregarTorneiras() {
    try {
        const res = await fetch('/api/torneiras');
        if (!res.ok) throw new Error('Erro ao carregar torneiras');
        const todas = await res.json();
        const ativas = todas.filter(t => t.status === 'ativa');

        if (ativas.length === 0) {
            torneirasGrid.innerHTML = '<div class="lista-vazia">Nenhuma torneira ativa no momento.</div>';
            return;
        }

        torneirasGrid.innerHTML = '';
        ativas.forEach(t => {
            const p300  = Number(t.preco_copo_300) || 0;
            const p500  = Number(t.preco_copo_500) || 0;
            const p1000 = Number(t.preco_copo_1000) || 0;

            // Botão Growler 1L só aparece quando há preço configurado (> 0).
            const btnGrowler = p1000 > 0
                ? `<button class="btn-copo" type="button" data-ml="1000">
                        <span class="copo-tam">${nomeTamanho(1000)}</span>
                        <span class="copo-preco">${formatarBRL(p1000)}</span>
                    </button>`
                : '';

            const card = document.createElement('div');
            card.className = 'torneira-card';
            card.innerHTML = `
                <div class="torneira-head">
                    <span class="torneira-num">${escaparHtml(t.numero)}</span>
                    <span class="torneira-nome">${escaparHtml(t.chopp_nome || 'Chopp')}</span>
                </div>
                <div class="torneira-botoes">
                    <button class="btn-copo" type="button" data-ml="300" ${p300 > 0 ? '' : 'disabled'}>
                        <span class="copo-tam">Copo 300ml</span>
                        <span class="copo-preco">${formatarBRL(p300)}</span>
                    </button>
                    <button class="btn-copo" type="button" data-ml="500" ${p500 > 0 ? '' : 'disabled'}>
                        <span class="copo-tam">Copo 500ml</span>
                        <span class="copo-preco">${formatarBRL(p500)}</span>
                    </button>
                    ${btnGrowler}
                </div>
            `;
            card.querySelectorAll('.btn-copo').forEach(btn => {
                if (btn.disabled) return;
                btn.addEventListener('click', () => lancarConsumo(t.id, parseInt(btn.dataset.ml, 10), btn));
            });
            torneirasGrid.appendChild(card);
        });
    } catch (err) {
        console.error(err);
        torneirasGrid.innerHTML = '<div class="lista-vazia">Erro ao carregar torneiras.</div>';
    }
}

// Lança um copo na comanda do cliente
async function lancarConsumo(torneiraId, tamanhoMl, btn) {
    if (!clienteAtivoId) return;
    if (btn) btn.disabled = true;

    try {
        const res = await fetch('/api/consumos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cliente_id: clienteAtivoId,
                torneira_id: torneiraId,
                tamanho_ml: tamanhoMl
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao lançar consumo');

        showToast(`${nomeTamanho(tamanhoMl)} lançado (${formatarBRL(data.valor)}).`, 'success');
        await carregarComanda(clienteAtivoId);
        // A lista de fundo é atualizada via socket 'comandas_atualizado'
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// Remove um item lançado por engano (só se em aberto)
async function removerItem(itemId) {
    try {
        const res = await fetch(`/api/consumos/${itemId}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Erro ao remover item');

        showToast('Item removido da comanda.', 'success');
        if (clienteAtivoId) await carregarComanda(clienteAtivoId);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

// ════════════════════════════════════════════
//  TEMPO REAL (Socket.io)
// ════════════════════════════════════════════
socket.on('comandas_atualizado', () => {
    carregarDadosPagina();
    if (clienteAtivoId) carregarComanda(clienteAtivoId);
});

socket.on('clientes_atualizado', () => {
    carregarDadosPagina();
});

socket.on('torneiras_atualizado', () => {
    if (clienteAtivoId) carregarTorneiras();
});

// NFC opcional: ao aproximar cartão, abre a comanda do cliente correspondente
socket.on('nfc_lido', async (data) => {
    if (!data || !data.uid) return;
    try {
        const res = await fetch(`/api/cartoes/${data.uid}`);
        if (!res.ok) return; // cartão não cadastrado: ignora silenciosamente
        const cartao = await res.json();
        if (cartao && cartao.cliente_id) {
            showToast(`Cartão de ${cartao.cliente_nome || 'cliente'} aproximado.`, 'success');
            abrirComanda(cartao.cliente_id);
        }
    } catch (err) {
        // silencioso: NFC é um plus
    }
});

// ════════════════════════════════════════════
//  INICIALIZAÇÃO
// ════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    carregarDadosPagina();

    buscaInput.addEventListener('input', renderizarClientes);

    document.getElementById('btnFecharComanda').addEventListener('click', fecharComanda);
    document.getElementById('btnFecharComandaRodape').addEventListener('click', fecharComanda);

    // Fechar clicando fora do container
    modalComanda.addEventListener('click', (e) => {
        if (e.target === modalComanda) fecharComanda();
    });

    // Fechar com ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalComanda.classList.contains('active')) fecharComanda();
    });
});
